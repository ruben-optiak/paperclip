#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.pipeline import sha256_file  # noqa: E402
from enki_catalog_pipeline.sanycces_pool_media import (  # noqa: E402
    _revise_customer_copy,
    _stable_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Revise reviewed Pool bundle names and SEO intent without regenerating media."
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--created-at", required=True)
    return parser.parse_args()


def replace_alt_name(product: dict, old_name: str) -> None:
    new_name = product["name"]
    if new_name == old_name:
        return
    for image in product["images"]:
        image["alt"] = image["alt"].replace(old_name, new_name)


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists():
        raise RuntimeError(f"refusing to overwrite output: {output}")
    if not source.is_dir():
        raise RuntimeError(f"source batch does not exist: {source}")

    shutil.copytree(source, output)
    stale_preflight = output / "preflight-report.json"
    if stale_preflight.exists():
        stale_preflight.unlink()

    manifest_path = output / "batch-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    changed: list[dict[str, str]] = []

    for row in manifest["bundles"]:
        bundle_path = output / row["path"]
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        bundle["createdAt"] = args.created_at
        for product in bundle["products"]:
            old_name = product["name"]
            old_slug = product["slug"]
            old_keyword = product["seo"]["focusKeyword"]
            approved_description = product["descriptionHtml"]
            approved_short_description = product["shortDescriptionHtml"]
            _revise_customer_copy(product)
            product["descriptionHtml"] = approved_description
            product["shortDescriptionHtml"] = approved_short_description
            replace_alt_name(product, old_name)
            if (old_name, old_slug, old_keyword) != (
                product["name"],
                product["slug"],
                product["seo"]["focusKeyword"],
            ):
                changed.append({
                    "productKey": product["productKey"],
                    "oldName": old_name,
                    "newName": product["name"],
                    "oldSlug": old_slug,
                    "newSlug": product["slug"],
                    "oldFocusKeyword": old_keyword,
                    "newFocusKeyword": product["seo"]["focusKeyword"],
                })
        bundle_path.write_bytes(_stable_json(bundle))
        row["sha256"] = sha256_file(bundle_path)
        row["validation"] = "pending_local_preflight"

    manifest["runId"] = output.name
    manifest["createdAt"] = args.created_at
    manifest_path.write_bytes(_stable_json(manifest))

    readme_path = output / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    readme += (
        "\n## Revisión de intención de búsqueda\n\n"
        "Los nombres siguen la estructura natural `producto – Sanycces – Pool`; "
        "las variantes 006/066 se expresan como `ducha de mano` o `barra integrada`, "
        "y los cuerpos de encastre hacen visible la denominación `Sanybox Inox`. "
        "Las descripciones larga y corta aprobadas se conservan byte por byte. "
        "La revisión no regenera medios ni concede autoridad de escritura externa.\n"
    )
    readme_path.write_text(readme, encoding="utf-8")

    print(json.dumps({
        "output": str(output),
        "changedProducts": len(changed),
        "changes": changed,
        "descriptionFieldsChanged": 0,
        "externalWrites": 0,
    }, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
