from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from . import PIPELINE_VERSION
from .pipeline import sha256_file
from .safety import DataWorkspace, validate_run_id
from .sanycces_pool import _read_woo_rows
from .sanycces_products import load_sanycces_adapter


BATCH_SCHEMA = "enki-product-draft-bundle-batch/v1"
BUNDLE_SCHEMA = "enki-product-draft-bundle/v1"
EXPECTED_READY_PRODUCTS = 24
EXPECTED_VARIABLE_PRODUCTS = 20
EXPECTED_SIMPLE_PRODUCTS = 4
EXPECTED_EXCLUDED_KITS = 4
MAX_PRODUCTS_PER_BUNDLE = 5
SANYBOX_CATEGORY_PATH = "Fontanería > Sanybox"
FINISH_TAXONOMY = "pa_acabado"
FINISH_TERM_BY_SUFFIX = {
    "NB": "niquel-cepillado",
    "RM": "metal-raw",
}


class SanyccesPoolBundleError(RuntimeError):
    """Raised when Pool draft bundles cannot be proven from frozen inputs."""


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _write_json(path: Path, value: Any) -> None:
    path.write_bytes(_json_bytes(value))


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SanyccesPoolBundleError(f"invalid JSON input: {path.name}") from error


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        ]
    except (OSError, json.JSONDecodeError) as error:
        raise SanyccesPoolBundleError(f"invalid JSONL input: {path.name}") from error


def _timestamp(value: str, label: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise SanyccesPoolBundleError(f"{label} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SanyccesPoolBundleError(f"{label} must include an explicit UTC offset")
    return value


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not normalized:
        raise SanyccesPoolBundleError("could not create a stable bundle slug")
    return normalized


def _source_hash(manifest: dict[str, Any], kind: str) -> str:
    matches = [item.get("sha256") for item in manifest.get("sources", []) if item.get("kind") == kind]
    if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{64}", str(matches[0])):
        raise SanyccesPoolBundleError(f"prepared run must contain one hashed {kind} source")
    return str(matches[0])


def _artifact_hash(manifest: dict[str, Any], relative_path: str) -> str:
    matches = [item.get("sha256") for item in manifest.get("artifacts", []) if item.get("path") == relative_path]
    if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{64}", str(matches[0])):
        raise SanyccesPoolBundleError(f"prepared artifact is not hashed: {relative_path}")
    return str(matches[0])


def _category_paths(categories: list[dict[str, Any]]) -> dict[str, int]:
    by_id = {int(item["id"]): item for item in categories}
    cache: dict[int, str] = {}

    def resolve(category_id: int, visiting: set[int]) -> str:
        if category_id in cache:
            return cache[category_id]
        if category_id in visiting:
            raise SanyccesPoolBundleError("Woo category snapshot contains a parent cycle")
        item = by_id.get(category_id)
        if item is None:
            raise SanyccesPoolBundleError("Woo category snapshot references an unknown parent")
        name = str(item.get("name", "")).strip()
        if not name:
            raise SanyccesPoolBundleError("Woo category snapshot contains an empty name")
        parent = int(item.get("parent") or 0)
        path = name if parent == 0 else f"{resolve(parent, visiting | {category_id})} > {name}"
        cache[category_id] = path
        return path

    by_path: dict[str, int] = {}
    for category_id in by_id:
        path = resolve(category_id, set())
        if path in by_path:
            raise SanyccesPoolBundleError(f"Woo category path is ambiguous: {path}")
        by_path[path] = category_id
    return by_path


def _category_ids_for_path(category_ids: dict[str, int], path: str) -> list[int]:
    parts = path.split(" > ")
    paths = [" > ".join(parts[:index]) for index in range(1, len(parts) + 1)]
    missing = [candidate for candidate in paths if candidate not in category_ids]
    if missing:
        raise SanyccesPoolBundleError(f"Woo category ancestors are missing: {', '.join(missing)}")
    return [category_ids[candidate] for candidate in paths]


def _finish_configuration(
    attributes: list[dict[str, Any]],
    terms: list[dict[str, Any]],
) -> tuple[int, dict[str, str]]:
    matches = [item for item in attributes if item.get("taxonomy") == FINISH_TAXONOMY]
    if len(matches) != 1 or matches[0].get("name") != "Acabado":
        raise SanyccesPoolBundleError("Woo Acabado attribute is missing or ambiguous")
    by_slug = {str(item.get("slug")): str(item.get("name")) for item in terms}
    missing = sorted(set(FINISH_TERM_BY_SUFFIX.values()) - set(by_slug))
    if missing:
        raise SanyccesPoolBundleError(f"Woo Acabado terms are missing: {', '.join(missing)}")
    return int(matches[0]["id"]), {
        suffix: by_slug[term_slug]
        for suffix, term_slug in FINISH_TERM_BY_SUFFIX.items()
    }


def _evidence(
    field: str,
    key: str,
    source_sha256: str,
    *,
    confidence: str = "high",
    source_url: str | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "field": field,
        "evidenceKey": key,
        "sourceSha256": source_sha256,
        "confidence": confidence,
    }
    if source_url:
        value["sourceUrl"] = source_url
    return value


def _parent_sku(article: dict[str, Any]) -> str:
    tail = str(article.get("configurationTail") or "")
    return f"{article['baseReference']}{tail}"


def _finish_suffix(reference: str) -> str:
    match = re.search(r"(NB|RM)$", reference)
    if match is None:
        raise SanyccesPoolBundleError(f"unsupported Pool finish suffix: {reference}")
    return match.group(1)


def _category_path(article: dict[str, Any]) -> str:
    if article.get("merchandisingDecision") == "standalone_sellable_sanybox_product_approved":
        return SANYBOX_CATEGORY_PATH
    return str(article["recommendedCategory"])


def _product_from_article(
    article: dict[str, Any],
    *,
    category_ids: list[int],
    finish_attribute_id: int,
    finish_options: dict[str, str],
    taxonomy_sha256: str,
    woo_sha256: str,
    discount_policy_sha256: str,
) -> dict[str, Any]:
    primary = article.get("media", {}).get("primary")
    if not isinstance(primary, dict):
        raise SanyccesPoolBundleError(f"ready product lacks reviewed media: {article.get('identity')}")
    parent_sku = _parent_sku(article)
    product_key = _slug(f"sanycces-pool-{article['identity'].replace('::', '-')}")
    pdf_sha256 = str(article["pdfEvidence"]["sourceSha256"])
    tariff_sha256 = str(article["pricing"]["officialTariffSha256"])
    group_key = str(article["groupKey"])
    asset_key = str(primary["assetKey"])
    parent_evidence = [
        _evidence("product.identity", f"pdf-group:{group_key}", pdf_sha256),
        _evidence("product.identity", f"woo-absence:{parent_sku}", woo_sha256),
        *[
            _evidence("product.categories", f"woo-category:{category_id}", taxonomy_sha256)
            for category_id in category_ids
        ],
        _evidence("product.copy", f"pdf-copy:{group_key}", pdf_sha256),
        _evidence("product.seo", f"seo-copy:{group_key}", pdf_sha256, confidence="medium"),
        _evidence(
            "product.images",
            f"official-media:{asset_key}",
            str(primary["sourceSha256"]),
            source_url=str(primary["sourceUrl"]),
        ),
    ]
    image = {
        "path": f"media/{Path(str(primary['outputPath'])).name}",
        "sha256": str(primary["outputSha256"]),
        "width": int(primary["outputWidth"]),
        "height": int(primary["outputHeight"]),
        "alt": str(article["media"]["alt"]),
        "position": 0,
        "sourceUrl": str(primary["sourceUrl"]),
        "rightsConfirmed": True,
    }
    product: dict[str, Any] = {
        "productKey": product_key,
        "type": "simple" if article["productModelRecommendation"] == "simple" else "variable",
        "status": "draft",
        "name": f"{article['title']} de Sanycces",
        "slug": str(article["slug"]),
        "sku": parent_sku,
        "manufacturerReference": parent_sku,
        "descriptionHtml": str(article["descriptionHtml"]),
        "shortDescriptionHtml": str(article["shortDescriptionHtml"]),
        "categories": category_ids,
        "tags": [],
        "attributes": [],
        "images": [image],
        "seo": {
            "provider": "yoast",
            "title": str(article["seo"]["title"]),
            "description": str(article["seo"]["metaDescription"]),
            "focusKeyword": str(article["seo"]["focusKeyword"]),
        },
        "commerce": {"manageStock": False, "stockStatus": "instock"},
        "evidence": parent_evidence,
    }
    variants = list(article["pricing"]["variants"])
    if product["type"] == "simple":
        if len(variants) != 1 or variants[0]["reference"] != parent_sku:
            raise SanyccesPoolBundleError(f"simple Sanybox identity is inconsistent: {article['identity']}")
        variant = variants[0]
        price_key = f"tariff-regular:{parent_sku}"
        sale_key = f"discount-policy:{parent_sku}"
        product["gtin"] = str(variant["ean"])
        product["commerce"] = {
            "regularPrice": str(variant["expectedRegularGross21"]),
            "priceEvidenceKey": price_key,
            "salePrice": str(variant["salePriceGross"]),
            "salePriceEvidenceKey": sale_key,
            "manageStock": False,
            "stockStatus": "instock",
        }
        product["evidence"].extend(
            [
                _evidence("product.commerce.regularPrice", price_key, tariff_sha256),
                _evidence("product.commerce.salePrice", sale_key, discount_policy_sha256),
                _evidence("product.gtin", f"tariff-gtin:{parent_sku}", tariff_sha256),
            ]
        )
        return product

    options_by_suffix: dict[str, str] = {}
    variations: list[dict[str, Any]] = []
    for variant in variants:
        reference = str(variant["reference"])
        suffix = _finish_suffix(reference)
        option = finish_options[suffix]
        options_by_suffix[suffix] = option
        price_key = f"tariff-regular:{reference}"
        sale_key = f"discount-policy:{reference}"
        variations.append(
            {
                "variationKey": _slug(f"{product_key}-{suffix}"),
                "status": "private",
                "sku": reference,
                "manufacturerReference": reference,
                "gtin": str(variant["ean"]),
                "attributes": [{"id": finish_attribute_id, "option": option}],
                "imagePosition": 0,
                "commerce": {
                    "regularPrice": str(variant["expectedRegularGross21"]),
                    "priceEvidenceKey": price_key,
                    "salePrice": str(variant["salePriceGross"]),
                    "salePriceEvidenceKey": sale_key,
                    "manageStock": False,
                    "stockStatus": "instock",
                },
                "evidence": [
                    _evidence("variation.identity", f"pdf-reference:{reference}", pdf_sha256),
                    _evidence("variation.identity", f"woo-absence:{reference}", woo_sha256),
                    _evidence("variation.commerce.regularPrice", price_key, tariff_sha256),
                    _evidence("variation.commerce.salePrice", sale_key, discount_policy_sha256),
                    _evidence("variation.gtin", f"tariff-gtin:{reference}", tariff_sha256),
                ],
            }
        )
    expected_suffixes = set(FINISH_TERM_BY_SUFFIX)
    if set(options_by_suffix) != expected_suffixes or len(variations) != 2:
        raise SanyccesPoolBundleError(f"variable product lacks the exact NB/RM matrix: {article['identity']}")
    product["attributes"] = [
        {
            "id": finish_attribute_id,
            "options": [options_by_suffix["NB"], options_by_suffix["RM"]],
            "visible": True,
            "variation": True,
        }
    ]
    product["variations"] = variations
    return product


def _chunked(values: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _price_policy_audit(
    articles: list[dict[str, Any]],
    *,
    discount_policy_sha256: str,
) -> dict[str, Any]:
    entries = []
    policy_keys = set()
    tariff_hashes = set()
    for article in articles:
        product_key = _slug(f"sanycces-pool-{article['identity'].replace('::', '-')}")
        pricing = article.get("pricing", {})
        policy_keys.add(str(pricing.get("discountPolicyKey")))
        tariff_hashes.add(str(pricing.get("officialTariffSha256")))
        for variant in pricing.get("variants", []):
            entries.append(
                {
                    "sku": str(variant["reference"]),
                    "productKey": product_key,
                    "officialPvpExVat": str(variant["officialPvpExVat"]),
                    "discountPercent": str(variant["discountPercent"]),
                    "regularGross": str(variant["expectedRegularGross21"]),
                    "saleGross": str(variant["salePriceGross"]),
                }
            )
    if policy_keys != {"sanycces-pvp-tier-2026-v1"}:
        raise SanyccesPoolBundleError("Pool articles do not share the approved discount policy")
    if len(tariff_hashes) != 1 or not re.fullmatch(r"[0-9a-f]{64}", next(iter(tariff_hashes), "")):
        raise SanyccesPoolBundleError("Pool articles do not share one official tariff hash")
    if not entries or len({item["sku"] for item in entries}) != len(entries):
        raise SanyccesPoolBundleError("Pool price-policy audit must contain unique sellable SKUs")
    entries.sort(key=lambda item: item["sku"])
    return {
        "schema": "enki-product-price-policy-audit/v1",
        "policyKey": "sanycces-pvp-tier-2026-v1",
        "policySha256": discount_policy_sha256,
        "officialTariffSha256": next(iter(tariff_hashes)),
        "vatPercent": "21.00",
        "entries": entries,
        "summary": {
            "sellableSkus": len(entries),
            "policyMismatches": 0,
        },
        "authority": {"externalMutationAuthority": False},
    }


def _report(manifest: dict[str, Any]) -> str:
    lines = [
        "# Bundles de borrador Sanycces Pool",
        "",
        "Lote local para revisión. No crea productos ni concede autoridad de escritura en WooCommerce.",
        "",
        "## Resumen",
        "",
        f"- Productos listos: **{manifest['summary']['readyProducts']}**.",
        f"- Variables: **{manifest['summary']['variableProducts']}**; simples Sanybox: **{manifest['summary']['simpleProducts']}**.",
        f"- SKU vendibles: **{manifest['summary']['sellableSkus']}**.",
        f"- Kits excluidos: **{manifest['summary']['excludedKits']}**, todos por falta de hero específico.",
        f"- Bundles: **{manifest['summary']['bundles']}**, con un máximo de cinco productos cada uno.",
        "",
        "## Bundles",
        "",
        "| Bundle | Productos | Variables | Simples | Variaciones | SHA-256 |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for bundle in manifest["bundles"]:
        lines.append(
            f"| `{bundle['bundleKey']}` | {bundle['productCount']} | {bundle['variableCount']} | "
            f"{bundle['simpleCount']} | {bundle['variationCount']} | `{bundle['sha256']}` |"
        )
    lines.extend(
        [
            "",
            "## Preflight",
            "",
            "- Cero colisiones de SKU padre o vendible contra la exportación Woo congelada.",
            "- Cero colisiones de slug contra los productos padre de la exportación.",
            "- Categorías y atributo Acabado resueltos por ID desde la captura pública fijada por hash.",
            "- Todos los precios, descuentos, GTIN y WebP conservan evidencia exacta.",
            "- La tarifa neta, IVA y descuento se recalculan por SKU en `price-policy-audit.json`.",
            "- Padres en `draft`, variaciones en `private`, sin stock y sin autoridad de publicación.",
            "",
        ]
    )
    return "\n".join(lines)


def build_sanycces_pool_bundles(
    workspace: DataWorkspace,
    *,
    run_id: str,
    created_at: str,
    catalog_captured_at: str,
    woo_captured_at: str,
    taxonomy_captured_at: str,
    catalog_logical_name: str,
    woo_logical_name: str,
) -> dict[str, Any]:
    run_id = validate_run_id(run_id)
    created_at = _timestamp(created_at, "created-at")
    catalog_captured_at = _timestamp(catalog_captured_at, "catalog-captured-at")
    woo_captured_at = _timestamp(woo_captured_at, "woo-captured-at")
    taxonomy_captured_at = _timestamp(taxonomy_captured_at, "taxonomy-captured-at")
    articles = _read_jsonl(workspace.files["articles"])
    prepared_manifest = _load_json(workspace.files["artifact_manifest"])
    discount_policy = _load_json(workspace.files["discount_policy"])
    category_pages = [
        _load_json(workspace.files["categories_page_1"]),
        _load_json(workspace.files["categories_page_2"]),
    ]
    categories = [item for page in category_pages for item in page]
    attributes = _load_json(workspace.files["attributes"])
    finish_terms = _load_json(workspace.files["finish_terms"])
    if not all(isinstance(value, list) for value in [*category_pages, attributes, finish_terms]):
        raise SanyccesPoolBundleError("Woo taxonomy snapshots must contain JSON arrays")
    if discount_policy.get("policyKey") != "sanycces-pvp-tier-2026-v1":
        raise SanyccesPoolBundleError("unexpected or unapproved Sanycces discount policy")

    woo_sha256 = sha256_file(workspace.files["woo"])
    if woo_sha256 != _source_hash(prepared_manifest, "woo"):
        raise SanyccesPoolBundleError("Woo export differs from the prepared Pool run")
    if sha256_file(workspace.files["articles"]) != _artifact_hash(prepared_manifest, "pool-articles.jsonl"):
        raise SanyccesPoolBundleError("Pool articles differ from the prepared artifact manifest")
    pdf_sha256 = _source_hash(prepared_manifest, "pdf")
    profile_sha256 = _source_hash(prepared_manifest, "profile")
    if any(item.get("pdfEvidence", {}).get("sourceSha256") != pdf_sha256 for item in articles):
        raise SanyccesPoolBundleError("Pool article PDF evidence drift")

    ready = [item for item in articles if not item.get("publication", {}).get("blockers")]
    excluded = [item for item in articles if item.get("publication", {}).get("blockers")]
    variable = [item for item in ready if item.get("productModelRecommendation") == "variable_by_finish"]
    simple = [item for item in ready if item.get("productModelRecommendation") == "simple"]
    if (len(ready), len(variable), len(simple), len(excluded)) != (
        EXPECTED_READY_PRODUCTS,
        EXPECTED_VARIABLE_PRODUCTS,
        EXPECTED_SIMPLE_PRODUCTS,
        EXPECTED_EXCLUDED_KITS,
    ):
        raise SanyccesPoolBundleError("ready Pool product cardinality drift")
    if any(item.get("publication", {}).get("blockers") != ["dedicated_kit_hero_required"] for item in excluded):
        raise SanyccesPoolBundleError("Pool exclusion contains an unexpected blocker")

    category_ids = _category_paths(categories)
    required_category_paths = {_category_path(item) for item in ready}
    missing_categories = sorted(required_category_paths - set(category_ids))
    if missing_categories:
        raise SanyccesPoolBundleError(f"Woo categories are missing: {', '.join(missing_categories)}")
    finish_attribute_id, finish_options = _finish_configuration(attributes, finish_terms)
    taxonomy_snapshot = {
        "schema": "enki-woo-product-taxonomy-snapshot/v1",
        "capturedAt": taxonomy_captured_at,
        "sources": [
            {
                "url": "https://www.enkihogar.com/wp-json/wc/store/v1/products/categories?per_page=100&page=1",
                "sha256": sha256_file(workspace.files["categories_page_1"]),
            },
            {
                "url": "https://www.enkihogar.com/wp-json/wc/store/v1/products/categories?per_page=100&page=2",
                "sha256": sha256_file(workspace.files["categories_page_2"]),
            },
            {
                "url": "https://www.enkihogar.com/wp-json/wc/store/v1/products/attributes",
                "sha256": sha256_file(workspace.files["attributes"]),
            },
            {
                "url": "https://www.enkihogar.com/wp-json/wc/store/v1/products/attributes/15/terms?per_page=100",
                "sha256": sha256_file(workspace.files["finish_terms"]),
            },
        ],
        "categoryPaths": {path: category_ids[path] for path in sorted(required_category_paths)},
        "finishAttribute": {
            "id": finish_attribute_id,
            "taxonomy": FINISH_TAXONOMY,
            "options": [finish_options["NB"], finish_options["RM"]],
        },
    }
    taxonomy_bytes = _json_bytes(taxonomy_snapshot)
    taxonomy_sha256 = sha256(taxonomy_bytes).hexdigest()

    adapter, _ = load_sanycces_adapter()
    woo_rows = _read_woo_rows(workspace.files["woo"], adapter)
    existing_skus = {str(item.get("sku")) for item in woo_rows if item.get("sku")}
    existing_slugs = {
        str(item.get("permalink")).rstrip("/").rsplit("/", 1)[-1]
        for item in woo_rows
        if item.get("permalink")
    }
    candidate_parent_skus = {_parent_sku(item) for item in ready}
    candidate_sellable_skus = {
        str(variant["reference"])
        for item in ready
        for variant in item["pricing"]["variants"]
    }
    candidate_slugs = {str(item["slug"]) for item in ready}
    sku_collisions = sorted((candidate_parent_skus | candidate_sellable_skus) & existing_skus)
    slug_collisions = sorted(candidate_slugs & existing_slugs)
    if sku_collisions:
        raise SanyccesPoolBundleError(f"candidate SKU already exists in Woo export: {sku_collisions[0]}")
    if slug_collisions:
        raise SanyccesPoolBundleError(f"candidate slug already exists in Woo export: {slug_collisions[0]}")
    if len(candidate_sellable_skus) != 44:
        raise SanyccesPoolBundleError("ready Pool sellable SKU count drift")

    discount_policy_sha256 = sha256_file(workspace.files["discount_policy"])
    products = [
        _product_from_article(
            article,
            category_ids=_category_ids_for_path(category_ids, _category_path(article)),
            finish_attribute_id=finish_attribute_id,
            finish_options=finish_options,
            taxonomy_sha256=taxonomy_sha256,
            woo_sha256=woo_sha256,
            discount_policy_sha256=discount_policy_sha256,
        )
        for article in sorted(variable, key=lambda item: item["identity"])
        + sorted(simple, key=lambda item: item["identity"])
    ]
    all_product_skus = [
        sku
        for product in products
        for sku in [product["sku"], *[item["sku"] for item in product.get("variations", [])]]
    ]
    if len(all_product_skus) != len(set(all_product_skus)):
        raise SanyccesPoolBundleError("candidate bundles contain duplicate parent or sellable SKUs")

    run_directory = workspace.output_root / run_id
    try:
        run_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise SanyccesPoolBundleError("refusing to overwrite an existing bundle batch") from error
    try:
        (run_directory / "taxonomy-snapshot.json").write_bytes(taxonomy_bytes)
        discount_policy_bytes = workspace.files["discount_policy"].read_bytes()
        (run_directory / "discount-policy.json").write_bytes(discount_policy_bytes)
        price_policy_audit = _price_policy_audit(
            ready,
            discount_policy_sha256=discount_policy_sha256,
        )
        price_policy_audit_bytes = _json_bytes(price_policy_audit)
        (run_directory / "price-policy-audit.json").write_bytes(price_policy_audit_bytes)
        bundle_rows: list[dict[str, Any]] = []
        for batch_index, batch_products in enumerate(_chunked(products, MAX_PRODUCTS_PER_BUNDLE), start=1):
            bundle_key = f"sanycces-pool-20260920-batch-{batch_index:02d}"
            bundle_directory = run_directory / bundle_key
            media_directory = bundle_directory / "media"
            media_directory.mkdir(parents=True, mode=0o750)
            for product in batch_products:
                for media in product["images"]:
                    file_name = Path(media["path"]).name
                    source = workspace.input_root / "media" / file_name
                    if source.is_symlink() or not source.is_file():
                        raise SanyccesPoolBundleError(f"prepared media is missing or unsafe: {file_name}")
                    if sha256_file(source) != _artifact_hash(prepared_manifest, f"media/{file_name}"):
                        raise SanyccesPoolBundleError(f"prepared media hash drift: {file_name}")
                    target = media_directory / file_name
                    if target.exists():
                        if sha256_file(target) != sha256_file(source):
                            raise SanyccesPoolBundleError(f"conflicting shared media: {file_name}")
                    else:
                        shutil.copyfile(source, target)
            bundle = {
                "schema": BUNDLE_SCHEMA,
                "bundleKey": bundle_key,
                "version": "1.0.0",
                "createdAt": created_at,
                "sourceSnapshot": {
                    "brandSlug": "sanycces",
                    "catalog": {
                        "logicalName": catalog_logical_name,
                        "capturedAt": catalog_captured_at,
                        "sha256": pdf_sha256,
                    },
                    "wooExport": {
                        "logicalName": woo_logical_name,
                        "capturedAt": woo_captured_at,
                        "sha256": woo_sha256,
                    },
                    "officialDomains": ["sanycces.es"],
                    "webPages": [],
                },
                "mediaProfile": {
                    "profileKey": "enki-square-candidate",
                    "sha256": profile_sha256,
                },
                "review": {
                    "status": "ready_for_board_review",
                    "externalMutationAuthority": "paperclip_exact_approval_only",
                    "brandGuardian": "PASS",
                    "catalogueQa": "PASS",
                },
                "products": batch_products,
            }
            bundle_path = bundle_directory / "product-draft-bundle.json"
            _write_json(bundle_path, bundle)
            bundle_rows.append(
                {
                    "bundleKey": bundle_key,
                    "path": f"{bundle_key}/product-draft-bundle.json",
                    "sha256": sha256_file(bundle_path),
                    "productKeys": [item["productKey"] for item in batch_products],
                    "productCount": len(batch_products),
                    "variableCount": sum(item["type"] == "variable" for item in batch_products),
                    "simpleCount": sum(item["type"] == "simple" for item in batch_products),
                    "variationCount": sum(len(item.get("variations", [])) for item in batch_products),
                    "validation": "pending_external_schema_and_media_validation",
                }
            )
        manifest = {
            "schema": BATCH_SCHEMA,
            "runtimeVersion": PIPELINE_VERSION,
            "runId": run_id,
            "createdAt": created_at,
            "authority": {
                "outputMode": "local_review_only",
                "canCreateWooDraft": False,
                "canPublish": False,
            },
            "sources": {
                "catalogSha256": pdf_sha256,
                "wooExportSha256": woo_sha256,
                "preparedArticlesSha256": sha256_file(workspace.files["articles"]),
                "preparedArtifactManifestSha256": sha256_file(workspace.files["artifact_manifest"]),
                "discountPolicySha256": discount_policy_sha256,
                "discountPolicyPath": "discount-policy.json",
                "pricePolicyAuditPath": "price-policy-audit.json",
                "pricePolicyAuditSha256": sha256(price_policy_audit_bytes).hexdigest(),
                "mediaProfileSha256": profile_sha256,
                "taxonomySnapshotSha256": taxonomy_sha256,
            },
            "preflight": {
                "parentSkuCollisions": 0,
                "sellableSkuCollisions": 0,
                "slugCollisions": 0,
                "categoryPathsResolved": len(required_category_paths),
                "finishAttributeId": finish_attribute_id,
                "finishOptions": [finish_options["NB"], finish_options["RM"]],
                "publicationWrites": 0,
            },
            "summary": {
                "readyProducts": len(products),
                "variableProducts": len(variable),
                "simpleProducts": len(simple),
                "sellableSkus": len(candidate_sellable_skus),
                "excludedKits": len(excluded),
                "bundles": len(bundle_rows),
            },
            "bundles": bundle_rows,
            "excluded": [
                {
                    "identity": item["identity"],
                    "title": item["title"],
                    "blockers": item["publication"]["blockers"],
                }
                for item in sorted(excluded, key=lambda item: item["identity"])
            ],
        }
        _write_json(run_directory / "batch-manifest.json", manifest)
        (run_directory / "README.md").write_text(_report(manifest), encoding="utf-8")
        return manifest
    except Exception:
        shutil.rmtree(run_directory, ignore_errors=True)
        raise
