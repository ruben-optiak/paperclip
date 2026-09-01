from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from . import PIPELINE_VERSION
from .safety import DataWorkspace, validate_run_id


KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
FIELD_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
RELATIVE_PATH_PATTERN = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$")
ENTITY_KINDS = {"simple", "parent", "variation"}
FIELD_GROUPS = {
    "identity", "classification", "commercial", "dimensions", "technical",
    "compatibility", "finish", "configuration", "content", "lifecycle", "other",
}
RISK_LEVELS = {"green", "yellow", "orange", "red"}
CSV_SOURCE_KINDS = {"woo_export_csv", "manual_rules_csv", "normalized_csv", "comparison_csv", "review_csv"}
SOURCE_KINDS = CSV_SOURCE_KINDS | {"official_pdf", "manufacturer_web", "manufacturer_file", "other"}
SOURCE_ROLES = {"official_source", "commercial_snapshot", "manufacturer_media", "manual_rules", "secondary"}
SOURCE_AUTHORITIES = {"official_technical", "current_commercial_snapshot", "supporting_media", "operator_rule", "derived", "secondary_unverified"}


class ReconciliationError(RuntimeError):
    """Raised when Woo reconciliation cannot preserve its safety invariants."""


@dataclass(frozen=True)
class CsvColumn:
    index: int
    original_header: str
    deduplicated_header: str

    def contract(self) -> dict[str, Any]:
        return {
            "columnIndex": self.index,
            "columnIndexBase": 0,
            "originalHeader": self.original_header,
            "deduplicatedHeader": self.deduplicated_header,
        }


@dataclass(frozen=True)
class CsvRow:
    row_number: int
    values: tuple[str, ...]
    sha256: str


@dataclass(frozen=True)
class WooSnapshot:
    path: Path
    logical_path: str
    sha256: str
    columns: tuple[CsvColumn, ...]
    rows: tuple[CsvRow, ...]


def _json_bytes(value: Any, *, pretty: bool = False) -> bytes:
    if pretty:
        encoded = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
    else:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return (encoded + "\n").encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReconciliationError(f"{label} must be valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ReconciliationError(f"{label} must contain one JSON object")
    return value


def _read_jsonl(path: Path, label: str) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise ReconciliationError(f"{label} must be valid UTF-8 JSONL") from error
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            document = json.loads(line)
        except json.JSONDecodeError as error:
            raise ReconciliationError(f"{label} line {line_number} is not valid JSON") from error
        if not isinstance(document, dict):
            raise ReconciliationError(f"{label} line {line_number} must contain an object")
        documents.append(document)
    if not documents:
        raise ReconciliationError(f"{label} must contain at least one evidence record")
    return documents


def deduplicate_headers(headers: list[str]) -> tuple[CsvColumn, ...]:
    occurrences: dict[str, int] = {}
    used: set[str] = set()
    columns: list[CsvColumn] = []
    for index, original in enumerate(headers):
        occurrences[original] = occurrences.get(original, 0) + 1
        base = original if original else "__blank"
        occurrence = occurrences[original]
        candidate = base if occurrence == 1 else f"{base}__{occurrence}"
        if candidate in used:
            candidate = f"{candidate}__pos{index}"
        used.add(candidate)
        columns.append(CsvColumn(index, original, candidate))
    return tuple(columns)


def load_woo_snapshot(path: Path, logical_path: str) -> WooSnapshot:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle, strict=True)
            try:
                headers = next(reader)
            except StopIteration as error:
                raise ReconciliationError("Woo export is empty") from error
            if not headers:
                raise ReconciliationError("Woo export has no columns")
            columns = deduplicate_headers(headers)
            rows: list[CsvRow] = []
            for row_number, values in enumerate(reader, start=2):
                if len(values) != len(columns):
                    raise ReconciliationError(
                        f"Woo row {row_number} has {len(values)} cells; expected exactly {len(columns)}"
                    )
                exact_values = tuple(values)
                row_digest = _sha256_bytes(_json_bytes(list(exact_values)))
                rows.append(CsvRow(row_number, exact_values, row_digest))
    except (OSError, UnicodeError, csv.Error) as error:
        if isinstance(error, ReconciliationError):
            raise
        raise ReconciliationError("Woo export must be readable UTF-8 CSV") from error
    return WooSnapshot(
        path=path,
        logical_path=logical_path,
        sha256=_sha256_file(path),
        columns=columns,
        rows=tuple(rows),
    )


def _binding_key(binding: dict[str, Any]) -> tuple[int, str, str]:
    return (
        binding.get("columnIndex"),
        binding.get("originalHeader"),
        binding.get("deduplicatedHeader"),
    )


def _column_for_binding(snapshot: WooSnapshot, binding: dict[str, Any], label: str) -> CsvColumn:
    index = binding.get("columnIndex")
    if binding.get("columnIndexBase") != 0 or not isinstance(index, int) or not 0 <= index < len(snapshot.columns):
        raise ReconciliationError(f"{label} has an invalid zero-based column index")
    column = snapshot.columns[index]
    if _binding_key(binding) != (
        column.index,
        column.original_header,
        column.deduplicated_header,
    ):
        raise ReconciliationError(f"{label} does not match the exact Woo header at position {index}")
    return column


def _positive_int(value: str) -> int | None:
    normalized = value.strip()
    if not normalized:
        return None
    if not re.fullmatch(r"[0-9]+", normalized):
        return None
    parsed = int(normalized)
    return parsed if parsed > 0 else None


def _parent_id(value: str) -> tuple[int | None, bool]:
    normalized = value.strip()
    if normalized in {"", "0"}:
        return None, True
    parsed = _positive_int(normalized)
    return parsed, parsed is not None


def _row_role(product_type: str, parent_id: int | None) -> str:
    normalized = product_type.strip().lower()
    if normalized == "simple" and parent_id is None:
        return "simple"
    if normalized == "variable" and parent_id is None:
        return "parent"
    if normalized in {"variable", "variation"} and parent_id is not None:
        return "variation"
    return "unknown"


def _snapshot_indexes(
    snapshot: WooSnapshot,
    identity: dict[str, Any],
) -> tuple[dict[int, CsvRow], dict[str, CsvRow], dict[int, str], list[dict[str, Any]]]:
    id_column = _column_for_binding(snapshot, identity["productId"], "identity.productId")
    type_column = _column_for_binding(snapshot, identity["productType"], "identity.productType")
    parent_column = _column_for_binding(snapshot, identity["parentProductId"], "identity.parentProductId")
    sku_column = _column_for_binding(snapshot, identity["sku"], "identity.sku")
    by_id: dict[int, CsvRow] = {}
    by_sku: dict[str, CsvRow] = {}
    roles: dict[int, str] = {}
    issues: list[dict[str, Any]] = []

    for row in snapshot.rows:
        product_id = _positive_int(row.values[id_column.index])
        if product_id is None:
            issues.append({"kind": "invalid_product_id", "rowNumber": row.row_number, "rowSha256": row.sha256})
            continue
        if product_id in by_id:
            issues.append({"kind": "duplicate_product_id", "rowNumber": row.row_number, "rowSha256": row.sha256})
        else:
            by_id[product_id] = row
        sku = row.values[sku_column.index].strip()
        if sku:
            if sku in by_sku:
                issues.append({"kind": "duplicate_sku", "rowNumber": row.row_number, "rowSha256": row.sha256})
            else:
                by_sku[sku] = row
        parent_id, valid_parent = _parent_id(row.values[parent_column.index])
        if not valid_parent:
            issues.append({"kind": "invalid_parent_product_id", "rowNumber": row.row_number, "rowSha256": row.sha256})
        role = _row_role(row.values[type_column.index], parent_id)
        roles[product_id] = role
        if role == "unknown":
            issues.append({"kind": "unknown_row_role", "rowNumber": row.row_number, "rowSha256": row.sha256})

    for product_id, row in by_id.items():
        if roles.get(product_id) != "variation":
            continue
        parent_id, _ = _parent_id(row.values[parent_column.index])
        if parent_id not in by_id or roles.get(parent_id) != "parent":
            issues.append({"kind": "orphan_variation", "rowNumber": row.row_number, "rowSha256": row.sha256})
    return by_id, by_sku, roles, issues


def _profile_sources(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for source in profile.get("sources", []):
        key = source.get("sourceKey")
        if not isinstance(key, str) or key in indexed:
            raise ReconciliationError("profile sources require unique sourceKey values")
        indexed[key] = source
    return indexed


def _profile_entities(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    seen_skus: set[str] = set()
    for entity in profile.get("scope", {}).get("entities", []):
        key = entity.get("entityKey")
        sku = entity.get("sku")
        if not isinstance(key, str) or key in indexed or not isinstance(sku, str) or not sku or sku in seen_skus:
            raise ReconciliationError("profile entities require unique non-empty entityKey and SKU values")
        indexed[key] = entity
        seen_skus.add(sku)
    return indexed


def _profile_targets(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for target in profile.get("scope", {}).get("targets", []):
        key = target.get("targetKey")
        if not isinstance(key, str) or key in indexed:
            raise ReconciliationError("profile targets require unique targetKey values")
        indexed[key] = target
    return indexed


def validate_profile(profile: dict[str, Any], snapshot: WooSnapshot, profile_sha256: str) -> None:
    if profile.get("schema") != "enki-catalog-reconciliation-profile/v1" or profile.get("version") != "1.0.0":
        raise ReconciliationError("unsupported reconciliation profile")
    if profile.get("timezone") != "Europe/Madrid":
        raise ReconciliationError("reconciliation profile timezone must be Europe/Madrid")
    if profile.get("provenance", {}).get("kind") not in {"operational", "sanitized_fixture"}:
        raise ReconciliationError("reconciliation profile provenance must be operational or sanitized_fixture")
    authority = profile.get("authority", {})
    if authority != {
        "isLiveCommercialTruth": False,
        "isExternalMutationAuthority": False,
        "canGenerateWooImport": False,
        "outputMode": "local_change_set_only",
    }:
        raise ReconciliationError("reconciliation profile cannot grant live or import authority")
    sources = _profile_sources(profile)
    if len(sources) < 2:
        raise ReconciliationError("profile requires at least two independent locked sources")
    csv_layout_contract = {
        "headerRow": 1,
        "columnIdentity": "zero_based_position_plus_original_and_deduplicated_header",
        "duplicateHeadersPreserved": True,
    }
    for source_key, source in sources.items():
        if not KEY_PATTERN.fullmatch(source_key):
            raise ReconciliationError("profile sourceKey is not portable")
        if (
            not isinstance(source.get("title"), str)
            or not source["title"]
            or source.get("role") not in SOURCE_ROLES
            or source.get("kind") not in SOURCE_KINDS
            or source.get("authority") not in SOURCE_AUTHORITIES
            or source.get("coverage") not in {"complete", "partial", "unknown"}
            or source.get("freshness") not in {"current_for_run", "historical", "unknown"}
            or not isinstance(source.get("snapshotAt"), str)
            or not RELATIVE_PATH_PATTERN.fullmatch(source.get("path", ""))
            or not re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", ""))
            or source.get("immutable") is not True
        ):
            raise ReconciliationError(f"profile source contract is incomplete or unsafe: {source_key}")
        if source.get("kind") in CSV_SOURCE_KINDS:
            row_count = source.get("rowCount")
            if (
                source.get("csvLayout") != csv_layout_contract
                or isinstance(row_count, bool)
                or not isinstance(row_count, int)
                or row_count < 0
            ):
                raise ReconciliationError(f"CSV source lacks its exact positional layout: {source_key}")
        elif source.get("csvLayout") is not None:
            raise ReconciliationError(f"non-CSV source cannot declare a CSV layout: {source_key}")
    woo_key = profile.get("wooSnapshotSourceKey")
    woo_source = sources.get(woo_key)
    if not woo_source:
        raise ReconciliationError("profile must reference one Woo snapshot source")
    if (
        woo_source.get("kind") != "woo_export_csv"
        or woo_source.get("role") != "commercial_snapshot"
        or woo_source.get("authority") != "current_commercial_snapshot"
        or woo_source.get("coverage") != "complete"
        or woo_source.get("freshness") != "current_for_run"
        or woo_source.get("immutable") is not True
    ):
        raise ReconciliationError("Woo snapshot must be immutable, complete, current and commercially authoritative")
    if woo_source.get("sha256") != snapshot.sha256:
        raise ReconciliationError("Woo snapshot SHA-256 does not match the locked profile")
    if woo_source.get("rowCount") != len(snapshot.rows):
        raise ReconciliationError("Woo snapshot row count does not match the locked profile")
    csv_layout = woo_source.get("csvLayout", {})
    if csv_layout != csv_layout_contract:
        raise ReconciliationError("Woo source must lock the positional duplicate-header layout")
    if not re.fullmatch(r"[0-9a-f]{64}", profile_sha256):
        raise ReconciliationError("profile checksum is invalid")

    entities = _profile_entities(profile)
    targets = _profile_targets(profile)
    if not entities or not targets:
        raise ReconciliationError("profile scope must contain entities and exact field targets")
    identity = profile.get("identity", {})
    if (
        identity.get("roleRules") != "simple_no_parent_variable_parent_no_parent_variation_with_parent"
        or identity.get("pageOwnerRule") != "simple_self_parent_self_variation_parent"
    ):
        raise ReconciliationError("profile identity and page-owner rules must remain exact")
    identity_columns = [
        _column_for_binding(snapshot, identity.get(key, {}), f"identity.{key}")
        for key in ("productId", "productType", "parentProductId", "sku")
    ]
    if len({column.index for column in identity_columns}) != len(identity_columns):
        raise ReconciliationError("identity bindings must use four different Woo columns")
    if profile.get("audit") != {"ignoredColumns": [], "unexpectedChanges": "fail"}:
        raise ReconciliationError("post-import audit must compare every non-expected cell")
    for entity_key, entity in entities.items():
        if not KEY_PATTERN.fullmatch(entity_key) or entity.get("expectedKind") not in ENTITY_KINDS:
            raise ReconciliationError("profile entity identity or kind is invalid")
    seen_target_cells: set[tuple[str, int]] = set()
    for target in targets.values():
        entity = entities.get(target.get("entityKey"))
        if not entity:
            raise ReconciliationError("every target must reference one in-scope entity")
        if (
            target.get("surface") not in {"sku", "product_page"}
            or target.get("fieldGroup") not in FIELD_GROUPS
            or not FIELD_NAME_PATTERN.fullmatch(target.get("fieldName", ""))
            or not isinstance(target.get("critical"), bool)
            or target.get("riskLevel") not in RISK_LEVELS
        ):
            raise ReconciliationError(f"target contract is incomplete or unsafe: {target.get('targetKey')}")
        column = _column_for_binding(snapshot, target.get("wooColumn", {}), f"target {target.get('targetKey')}")
        cell_key = (target["entityKey"], column.index)
        if cell_key in seen_target_cells:
            raise ReconciliationError("profile targets cannot address the same entity cell twice")
        seen_target_cells.add(cell_key)
        if target.get("surface") == "product_page" and entity.get("expectedKind") not in {"simple", "parent"}:
            raise ReconciliationError("product-page fields may target only simple products or parents")
        normalization = target.get("normalization", {})
        if normalization.get("kind") not in {"money", "text", "csv_first"}:
            raise ReconciliationError("target normalization kind is unsupported")
        if normalization.get("kind") == "money":
            if normalization.get("unit") != "EUR" or normalization.get("fiscalBasis") not in {
                "gross_including_vat",
                "net_excluding_vat",
            }:
                raise ReconciliationError("money targets require explicit EUR and a comparable fiscal basis")
        elif normalization.get("fiscalBasis") != "not_applicable":
            raise ReconciliationError("non-money targets must use fiscalBasis not_applicable")


def _map_scope(
    snapshot: WooSnapshot,
    profile: dict[str, Any],
    *,
    strict_integrity: bool,
) -> tuple[dict[str, tuple[CsvRow, int, str]], dict[int, CsvRow], dict[int, str], list[dict[str, Any]]]:
    identity = profile["identity"]
    by_id, by_sku, roles, issues = _snapshot_indexes(snapshot, identity)
    if strict_integrity and issues:
        kinds = ", ".join(sorted({item["kind"] for item in issues}))
        raise ReconciliationError(f"Woo snapshot identity integrity failed: {kinds}")
    id_column = _column_for_binding(snapshot, identity["productId"], "identity.productId")
    mapped: dict[str, tuple[CsvRow, int, str]] = {}
    for entity_key, entity in _profile_entities(profile).items():
        row = by_sku.get(entity["sku"])
        if row is None:
            raise ReconciliationError(f"in-scope SKU is missing from Woo snapshot: {entity_key}")
        product_id = _positive_int(row.values[id_column.index])
        role = roles.get(product_id or -1, "unknown")
        if role != entity["expectedKind"]:
            raise ReconciliationError(f"in-scope entity kind mismatch: {entity_key}")
        mapped[entity_key] = (row, product_id or -1, role)
    return mapped, by_id, roles, issues


def _decimal_value(raw: str) -> int | float:
    if not re.fullmatch(r"-?[0-9]+(?:\.[0-9]{1,2})?", raw.strip()):
        raise ReconciliationError("money value is not an unambiguous decimal-dot amount")
    try:
        value = Decimal(raw.strip()).quantize(Decimal("0.01"))
    except InvalidOperation as error:
        raise ReconciliationError("money value cannot be represented exactly") from error
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def _normalize_woo(raw: str, normalization: dict[str, Any]) -> tuple[Any, list[dict[str, str]]]:
    kind = normalization["kind"]
    if kind == "money":
        return _decimal_value(raw), [
            {
                "name": "woo-decimal-dot",
                "version": "1.0.0",
                "note": f"Woo value parsed as EUR with fiscal basis {normalization['fiscalBasis']}.",
            }
        ]
    if kind == "csv_first":
        return raw.split(",", 1)[0].strip(), [
            {
                "name": "woo-csv-first-item",
                "version": "1.0.0",
                "note": "First positional media item selected; the gallery column remains independent.",
            }
        ]
    if kind == "text":
        return " ".join(raw.split()), []
    raise ReconciliationError(f"unsupported normalization kind: {kind}")


def _evidence_source(source: dict[str, Any]) -> dict[str, Any]:
    return {
        key: source[key]
        for key in ("sourceKey", "kind", "authority", "snapshotAt", "coverage", "freshness", "path", "sha256")
    }


def _entity_document(
    entity_key: str,
    entity: dict[str, Any],
    row: CsvRow,
    product_id: int,
    profile: dict[str, Any],
    by_id: dict[int, CsvRow],
    snapshot: WooSnapshot,
) -> dict[str, Any]:
    parent_column = _column_for_binding(snapshot, profile["identity"]["parentProductId"], "identity.parentProductId")
    sku_column = _column_for_binding(snapshot, profile["identity"]["sku"], "identity.sku")
    parent_id, _ = _parent_id(row.values[parent_column.index])
    parent_sku = by_id[parent_id].values[sku_column.index].strip() if parent_id in by_id else None
    kind = entity["expectedKind"]
    return {
        "entityKey": entity_key,
        "kind": kind,
        "manufacturerRef": entity.get("manufacturerRef"),
        "canonicalSku": entity["sku"],
        "brandSlug": profile["brand"]["slug"],
        "wooIdentity": {
            "productId": parent_id if kind == "variation" else product_id,
            "variationId": product_id if kind == "variation" else None,
            "sku": entity["sku"],
            "parentSku": parent_sku,
            "ean": None,
            "slug": None,
        },
    }


def _current_evidence(
    profile: dict[str, Any],
    source: dict[str, Any],
    target: dict[str, Any],
    entity: dict[str, Any],
    row: CsvRow,
    product_id: int,
    by_id: dict[int, CsvRow],
    snapshot: WooSnapshot,
) -> dict[str, Any]:
    column = _column_for_binding(snapshot, target["wooColumn"], f"target {target['targetKey']}")
    raw = row.values[column.index]
    normalized, transformations = _normalize_woo(raw, target["normalization"])
    evidence_key = f"woo-current-{target['targetKey']}"
    return {
        "schema": "enki-catalog-field-evidence/v1",
        "evidenceKey": evidence_key,
        "runKey": profile["runKey"],
        "revision": {"revisionId": f"{evidence_key}.r1", "revisionNumber": 1, "supersedesRevisionId": None},
        "observedAt": source["snapshotAt"],
        "timezone": "Europe/Madrid",
        "provenance": profile["provenance"]["kind"],
        "entity": _entity_document(target["entityKey"], entity, row, product_id, profile, by_id, snapshot),
        "field": {
            "group": target["fieldGroup"],
            "name": target["fieldName"],
            "critical": target["critical"],
            "rawValue": raw,
            "normalizedValue": normalized,
            "unit": target["normalization"]["unit"],
            "transformations": transformations,
        },
        "source": _evidence_source(source),
        "location": {
            "kind": "csv_cell",
            "filePath": source["path"],
            "fileSha256": source["sha256"],
            "rowNumber": row.row_number,
            "rowSha256": row.sha256,
            **column.contract(),
        },
        "extraction": {
            "method": "csv_position",
            "component": "woo-positional-reader",
            "componentVersion": PIPELINE_VERSION,
            "ruleKey": None,
            "ruleVersion": None,
        },
        "confidence": {
            "score": 1,
            "level": "high",
            "reasons": ["Exact cell from the locked complete Woo export and positional header."],
        },
        "decision": {
            "state": "observed",
            "actorType": "none",
            "actorRef": None,
            "decidedAt": None,
            "note": "Observed commercial state; not an approval.",
            "isExternalMutationAuthority": False,
        },
        "lineage": {"derivedFromEvidenceKeys": [], "supersedesEvidenceKey": None, "legacyRows": []},
        "authority": {
            "isObservation": True,
            "isCurrentCommercialTruth": True,
            "isExternalMutationAuthority": False,
        },
    }


def _validate_candidates(
    candidates: list[dict[str, Any]],
    profile: dict[str, Any],
    targets: dict[str, dict[str, Any]],
    entities: dict[str, dict[str, Any]],
    sources: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    woo_key = profile["wooSnapshotSourceKey"]
    by_target: dict[str, dict[str, Any]] = {}
    target_lookup = {
        (target["entityKey"], target["fieldGroup"], target["fieldName"]): key
        for key, target in targets.items()
    }
    for candidate in candidates:
        if candidate.get("schema") != "enki-catalog-field-evidence/v1":
            raise ReconciliationError("candidate input contains an unsupported evidence contract")
        lookup = (
            candidate.get("entity", {}).get("entityKey"),
            candidate.get("field", {}).get("group"),
            candidate.get("field", {}).get("name"),
        )
        target_key = target_lookup.get(lookup)
        if not target_key or target_key in by_target:
            raise ReconciliationError("candidate evidence must map one-to-one to exact profile targets")
        target = targets[target_key]
        entity = entities[target["entityKey"]]
        if (
            candidate.get("runKey") != profile["runKey"]
            or candidate.get("provenance") != profile["provenance"]["kind"]
            or candidate.get("entity", {}).get("kind") != entity["expectedKind"]
            or candidate.get("entity", {}).get("canonicalSku") != entity["sku"]
            or candidate.get("entity", {}).get("brandSlug") != profile["brand"]["slug"]
        ):
            raise ReconciliationError(f"candidate identity or run scope mismatch: {target_key}")
        source_key = candidate.get("source", {}).get("sourceKey")
        source = sources.get(source_key)
        if source_key == woo_key or not source or _evidence_source(source) != candidate.get("source"):
            raise ReconciliationError(f"candidate source is not an independent locked source: {target_key}")
        if candidate.get("authority") != {
            "isObservation": True,
            "isCurrentCommercialTruth": False,
            "isExternalMutationAuthority": False,
        }:
            raise ReconciliationError(f"candidate authority is unsafe: {target_key}")
        if candidate.get("decision", {}).get("state") not in {"candidate", "approved"}:
            raise ReconciliationError(f"candidate decision state is not reviewable: {target_key}")
        if candidate.get("field", {}).get("critical") != target["critical"]:
            raise ReconciliationError(f"candidate criticality differs from the profile: {target_key}")
        normalization = target["normalization"]
        if candidate.get("field", {}).get("unit") != normalization["unit"]:
            raise ReconciliationError(f"candidate unit differs from the profile: {target_key}")
        if normalization["kind"] == "money":
            required = f"fiscal-basis-{normalization['fiscalBasis'].replace('_', '-')}"
            transformations = candidate.get("field", {}).get("transformations", [])
            if not any(item.get("name") == required for item in transformations):
                raise ReconciliationError(f"candidate lacks an explicit fiscal-basis transformation: {target_key}")
            value = candidate.get("field", {}).get("normalizedValue")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ReconciliationError(f"candidate money value is not numeric: {target_key}")
        elif not isinstance(candidate.get("field", {}).get("normalizedValue"), str):
            raise ReconciliationError(f"candidate text/media value is not a string: {target_key}")
        by_target[target_key] = candidate
    missing = sorted(set(targets) - set(by_target))
    if missing:
        raise ReconciliationError(f"candidate evidence is missing exact targets: {', '.join(missing)}")
    return by_target


def _same_value(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return Decimal(str(left)) == Decimal(str(right))
    return left == right


def _change_document(
    profile: dict[str, Any],
    target: dict[str, Any],
    current: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    risk = target["riskLevel"]
    critical = target["critical"]
    fiscal_basis = target["normalization"]["fiscalBasis"]
    return {
        "changeKey": f"change-{target['targetKey']}",
        "operation": "set_field",
        "target": {
            "entityKey": target["entityKey"],
            "entityKind": current["entity"]["kind"],
            "surface": target["surface"],
            "fieldGroup": target["fieldGroup"],
            "fieldName": target["fieldName"],
            "wooColumn": target["wooColumn"],
        },
        "current": {
            "present": True,
            "rawValue": current["field"]["rawValue"],
            "normalizedValue": current["field"]["normalizedValue"],
            "evidenceKeys": [current["evidenceKey"]],
        },
        "candidate": {
            "present": True,
            "rawValue": candidate["field"]["rawValue"],
            "normalizedValue": candidate["field"]["normalizedValue"],
            "evidenceKeys": [candidate["evidenceKey"]],
        },
        "comparison": {
            "status": "mismatch",
            "reason": "The independently evidenced normalized candidate differs from the exact Woo cell.",
            "fiscalBasis": fiscal_basis,
        },
        "confidence": candidate["confidence"],
        "risk": {
            "level": risk,
            "criticalField": critical,
            "reasons": ["The field remains pending human review and any later Woo import is operator-only."],
        },
        "decision": {
            "state": "needs_review",
            "actorType": "none",
            "actorRef": None,
            "decidedAt": None,
            "note": "Generated as a local review draft; no external action is authorized.",
            "isExternalMutationAuthority": False,
        },
        "exportEligibility": {"eligible": False, "blockers": ["board_approval_required"]},
        "lineage": {"supersedesChangeKey": None, "legacyRows": []},
    }


def _change_summary(changes: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(changes),
        "proposed": 0,
        "needsReview": len(changes),
        "approvedForLocalExport": 0,
        "rejected": 0,
        "blockedSourceConflict": 0,
        "superseded": 0,
        "eligibleForLocalExport": 0,
        "criticalBlocked": sum(1 for item in changes if item["risk"]["criticalField"]),
    }


def _write(path: Path, value: Any, *, jsonl: bool = False) -> None:
    if jsonl:
        payload = b"".join(_json_bytes(item) for item in value)
    else:
        payload = _json_bytes(value, pretty=True)
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    path.write_bytes(payload)


def _artifact(path: Path, run_directory: Path, key: str, kind: str, rows: int | None) -> dict[str, Any]:
    return {
        "artifactKey": key,
        "kind": kind,
        "path": path.relative_to(run_directory).as_posix(),
        "sha256": _sha256_file(path),
        "rows": rows,
        "bytes": path.stat().st_size,
    }


def _duplicates(snapshot: WooSnapshot) -> list[dict[str, Any]]:
    grouped: dict[str, list[CsvColumn]] = {}
    for column in snapshot.columns:
        grouped.setdefault(column.original_header, []).append(column)
    return [
        {
            "originalHeader": header,
            "columnIndexes": [item.index for item in columns],
            "deduplicatedHeaders": [item.deduplicated_header for item in columns],
        }
        for header, columns in grouped.items()
        if len(columns) > 1
    ]


def reconcile_woo(workspace: DataWorkspace, *, run_id: str) -> dict[str, Any]:
    run_id = validate_run_id(run_id)
    profile_path = workspace.files["profile"]
    candidates_path = workspace.files["candidates"]
    woo_path = workspace.files["woo"]
    profile = _read_json(profile_path, "profile")
    candidates = _read_jsonl(candidates_path, "candidates")
    snapshot = load_woo_snapshot(woo_path, workspace.relative_files["woo"])
    profile_sha256 = _sha256_file(profile_path)
    validate_profile(profile, snapshot, profile_sha256)
    sources = _profile_sources(profile)
    entities = _profile_entities(profile)
    targets = _profile_targets(profile)
    candidate_by_target = _validate_candidates(candidates, profile, targets, entities, sources)
    mapped, by_id, roles, _ = _map_scope(snapshot, profile, strict_integrity=True)
    woo_source = sources[profile["wooSnapshotSourceKey"]]

    evidence: list[dict[str, Any]] = []
    changes: list[dict[str, Any]] = []
    matches = 0
    for target_key, target in targets.items():
        row, product_id, _ = mapped[target["entityKey"]]
        current = _current_evidence(
            profile,
            woo_source,
            target,
            entities[target["entityKey"]],
            row,
            product_id,
            by_id,
            snapshot,
        )
        candidate = candidate_by_target[target_key]
        evidence.extend([current, candidate])
        if _same_value(current["field"]["normalizedValue"], candidate["field"]["normalizedValue"]):
            matches += 1
        else:
            changes.append(_change_document(profile, target, current, candidate))

    change_set_key = f"changes-{profile['runKey']}"
    referenced_evidence = sorted(
        evidence_key
        for change in changes
        for side in ("current", "candidate")
        for evidence_key in change[side]["evidenceKeys"]
    )
    change_set = {
        "schema": "enki-catalog-change-set/v1",
        "changeSetKey": change_set_key,
        "runKey": profile["runKey"],
        "revision": {"revisionId": f"{change_set_key}.r1", "revisionNumber": 1, "supersedesRevisionId": None},
        "brand": profile["brand"],
        "createdAt": profile["createdAt"],
        "timezone": "Europe/Madrid",
        "provenance": profile["provenance"]["kind"],
        "scope": {
            "entityKinds": sorted({entity["expectedKind"] for entity in entities.values()}),
            "fieldGroups": sorted({target["fieldGroup"] for target in targets.values()}),
            "includeEntityKeys": sorted(entities),
            "excludeEntityKeys": [],
            "wooSnapshotSourceKey": profile["wooSnapshotSourceKey"],
        },
        "execution": {
            "mode": "local_draft",
            "externalWritesBlocked": True,
            "publicationAuthority": "none",
            "requiresFreshPostImportExport": True,
        },
        "changes": changes,
        "summary": _change_summary(changes),
        "lineage": {
            "sourceEvidenceKeys": referenced_evidence,
            "supersedesChangeSetKey": None,
            "migrationRefs": [],
        },
        "decision": {
            "state": "pending",
            "actorType": "none",
            "actorRef": None,
            "decidedAt": None,
            "note": "No change is approved and no Woo import has been generated.",
            "isExternalMutationAuthority": False,
        },
    }

    in_scope_rows = {item[0].row_number for item in mapped.values()}
    kind_counts = {kind: sum(1 for value in roles.values() if value == kind) for kind in ("simple", "parent", "variation", "unknown")}
    report = {
        "schema": "enki-catalog-reconciliation-report/v1",
        "reportKey": f"report-{profile['runKey']}",
        "profileKey": profile["profileKey"],
        "runKey": profile["runKey"],
        "createdAt": profile["createdAt"],
        "timezone": "Europe/Madrid",
        "provenance": profile["provenance"]["kind"],
        "inputs": {
            "profileSha256": profile_sha256,
            "candidateEvidenceSha256": _sha256_file(candidates_path),
            "wooSnapshotSha256": snapshot.sha256,
            "wooRows": len(snapshot.rows),
            "wooColumns": len(snapshot.columns),
        },
        "positionalLayout": {"duplicateHeaders": _duplicates(snapshot)},
        "identity": {
            "inScopeEntities": len(mapped),
            "outsideScopeRows": len(snapshot.rows) - len(in_scope_rows),
            "rowKinds": kind_counts,
            "pageOwnerRule": "simple_self_parent_self_variation_parent",
        },
        "results": {
            "candidateFields": len(targets),
            "matches": matches,
            "changes": len(changes),
            "criticalChanges": sum(1 for change in changes if change["risk"]["criticalField"]),
        },
        "outputs": {
            "fieldEvidence": "artifacts/catalog-field-evidence.jsonl",
            "changeSet": "artifacts/catalog-change-set.json",
            "catalogRun": "catalog-run.json",
        },
        "authority": {
            "isLiveCommercialTruth": False,
            "isExternalMutationAuthority": False,
            "canGenerateWooImport": False,
            "outputMode": "local_change_set_only",
        },
    }

    run_directory = workspace.output_root / run_id
    try:
        run_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise ReconciliationError("refusing to overwrite an existing reconciliation run") from error
    try:
        profile_output = run_directory / "rules" / "reconciliation-profile.json"
        evidence_output = run_directory / "artifacts" / "catalog-field-evidence.jsonl"
        change_output = run_directory / "artifacts" / "catalog-change-set.json"
        report_output = run_directory / "artifacts" / "reconciliation-report.json"
        _write(profile_output, profile)
        _write(evidence_output, evidence, jsonl=True)
        _write(change_output, change_set)
        _write(report_output, report)
        artifacts = [
            _artifact(evidence_output, run_directory, "field-evidence-jsonl", "field_evidence", len(evidence)),
            _artifact(change_output, run_directory, "change-set-json", "change_set", len(changes)),
            _artifact(report_output, run_directory, "reconciliation-report-json", "report", None),
        ]
        catalog_run = {
            "schema": "enki-catalog-run/v1",
            "runKey": profile["runKey"],
            "revision": {"revisionId": f"{profile['runKey']}.r1", "revisionNumber": 1, "supersedesRevisionId": None},
            "status": "qa_pending",
            "brand": profile["brand"],
            "domain": profile["domain"],
            "createdAt": profile["createdAt"],
            "timezone": "Europe/Madrid",
            "provenance": {
                "kind": profile["provenance"]["kind"],
                "authority": "catalogue_processing_record_not_live_commercial_truth",
                "sourceIssue": profile["provenance"]["sourceIssue"],
            },
            "sources": profile["sources"],
            "runtime": {
                "name": "enki-catalog-pipeline",
                "version": PIPELINE_VERSION,
                "python": "3.12",
                "renderer": "not_applicable",
                "extractor": "woo-positional-csv",
                "imageDigest": None,
                "networkMode": "none",
            },
            "rulesets": [
                {
                    "rulesetKey": profile["profileKey"],
                    "name": "Locked Woo positional reconciliation profile",
                    "version": profile["version"],
                    "path": "rules/reconciliation-profile.json",
                    "sha256": _sha256_file(profile_output),
                    "authority": "versioned_operator_rule_not_source_truth",
                }
            ],
            "artifacts": artifacts,
            "stages": {
                "sources": {"status": "complete", "completedAt": profile["createdAt"], "artifactKeys": []},
                "normalization": {"status": "complete", "completedAt": profile["createdAt"], "artifactKeys": ["field-evidence-jsonl"]},
                "comparison": {"status": "complete", "completedAt": profile["createdAt"], "artifactKeys": ["change-set-json", "reconciliation-report-json"]},
                "qa": {"status": "partial", "completedAt": profile["createdAt"], "artifactKeys": ["change-set-json"]},
                "approval": {"status": "pending", "completedAt": None, "artifactKeys": []},
                "export": {"status": "pending", "completedAt": None, "artifactKeys": []},
            },
            "quality": {
                "entitiesObserved": len({item["entity"]["entityKey"] for item in evidence}),
                "fieldsObserved": len(evidence),
                "fieldsCompared": len(changes),
                "criticalFieldsBlocked": change_set["summary"]["criticalBlocked"],
                "warnings": ["Local comparison only; no Woo import or external mutation is authorized."],
                "unknowns": [],
            },
            "execution": {
                "externalWritesBlocked": True,
                "outputMode": "local_drafts_only",
                "wooCommerceAuthority": "fresh_complete_export_is_current_commercial_snapshot",
            },
            "lineage": {"parentRunKey": None, "supersedesRunKey": None, "migrationRefs": []},
            "decision": {
                "state": "pending",
                "actorType": "none",
                "actorRef": None,
                "decidedAt": None,
                "note": "Board review is required before any local export can be prepared.",
                "isExternalMutationAuthority": False,
            },
        }
        _write(run_directory / "catalog-run.json", catalog_run)
        return {
            "valid": True,
            "runKey": profile["runKey"],
            "runDirectory": run_id,
            "matches": matches,
            "changes": len(changes),
            "outsideScopeRows": report["identity"]["outsideScopeRows"],
            "externalWritesBlocked": True,
            "canGenerateWooImport": False,
        }
    except Exception:
        shutil.rmtree(run_directory, ignore_errors=True)
        raise


def _row_identity_hash(product_id: int) -> str:
    return _sha256_bytes(f"woo-product-id:{product_id}".encode("utf-8"))


def _value_hash(value: str) -> str:
    return _sha256_bytes(value.encode("utf-8"))


def audit_woo(workspace: DataWorkspace, *, audit_id: str) -> dict[str, Any]:
    audit_id = validate_run_id(audit_id)
    profile = _read_json(workspace.files["profile"], "profile")
    change_set = _read_json(workspace.files["change-set"], "change set")
    before = load_woo_snapshot(workspace.files["before-woo"], workspace.relative_files["before-woo"])
    after = load_woo_snapshot(workspace.files["after-woo"], workspace.relative_files["after-woo"])
    profile_sha256 = _sha256_file(workspace.files["profile"])
    validate_profile(profile, before, profile_sha256)
    mapped, before_by_id, _, before_issues = _map_scope(before, profile, strict_integrity=True)
    after_by_id, _, _, after_issues = _snapshot_indexes(after, profile["identity"])
    targets = _profile_targets(profile)
    entities = _profile_entities(profile)
    blockers: list[str] = []
    unexpected: list[dict[str, Any]] = []
    identity_drift: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    verified = 0

    if change_set.get("schema") != "enki-catalog-change-set/v1" or change_set.get("runKey") != profile["runKey"]:
        raise ReconciliationError("audit change set does not belong to the locked profile run")
    if change_set.get("execution") != {
        "mode": "local_draft",
        "externalWritesBlocked": True,
        "publicationAuthority": "none",
        "requiresFreshPostImportExport": True,
    }:
        raise ReconciliationError("audit change set has unsafe execution authority")
    sanitized = profile["provenance"]["kind"] == "sanitized_fixture"
    set_decision = change_set.get("decision", {})
    all_changes = change_set.get("changes", [])
    if not isinstance(all_changes, list) or set_decision.get("isExternalMutationAuthority") is not False:
        raise ReconciliationError("audit change set contract is incomplete or unsafe")
    if sanitized:
        if set_decision.get("state") != "pending":
            raise ReconciliationError("a sanitized audit accepts only the untouched pending fixture change set")
        for change in all_changes:
            if (
                change.get("decision", {}).get("state") != "needs_review"
                or change.get("decision", {}).get("isExternalMutationAuthority") is not False
                or change.get("exportEligibility", {}).get("eligible") is not False
            ):
                raise ReconciliationError("a sanitized audit cannot simulate an approved or externally authoritative change")
        expected_changes = all_changes
    else:
        if (
            set_decision.get("state") not in {"partially_approved_for_local_export", "approved_for_local_export"}
            or set_decision.get("actorType") != "board"
            or not isinstance(set_decision.get("actorRef"), str)
            or not set_decision["actorRef"]
            or not isinstance(set_decision.get("decidedAt"), str)
            or not set_decision["decidedAt"]
        ):
            raise ReconciliationError("an operational post-import audit requires the exact Board-approved local change set")
        expected_changes = []
        for change in all_changes:
            decision = change.get("decision", {})
            eligibility = change.get("exportEligibility", {})
            if decision.get("isExternalMutationAuthority") is not False:
                raise ReconciliationError("an audit change cannot grant external mutation authority")
            if decision.get("state") == "approved_for_local_export":
                if (
                    decision.get("actorType") != "board"
                    or not isinstance(decision.get("actorRef"), str)
                    or not decision["actorRef"]
                    or not isinstance(decision.get("decidedAt"), str)
                    or not decision["decidedAt"]
                    or eligibility != {"eligible": True, "blockers": []}
                ):
                    raise ReconciliationError("an approved audit change requires an exact Board decision and local-export eligibility")
                expected_changes.append(change)
        if not expected_changes:
            raise ReconciliationError("an operational post-import audit requires at least one approved local change")
        if set_decision["state"] == "approved_for_local_export" and len(expected_changes) != len(all_changes):
            raise ReconciliationError("a fully approved change set cannot contain an unapproved change")

    if len(before.columns) != len(after.columns) or [item.original_header for item in before.columns] != [item.original_header for item in after.columns]:
        blockers.append("header_layout_drift")
    if before_issues:
        blockers.append("before_snapshot_identity_invalid")
    if after_issues:
        blockers.extend(sorted({f"after_{item['kind']}" for item in after_issues}))

    id_column = _column_for_binding(before, profile["identity"]["productId"], "identity.productId")
    parent_column = _column_for_binding(before, profile["identity"]["parentProductId"], "identity.parentProductId")
    sku_column = _column_for_binding(before, profile["identity"]["sku"], "identity.sku")
    expected_by_cell: dict[tuple[int, int], tuple[dict[str, Any], dict[str, Any]]] = {}
    seen_change_keys: set[str] = set()
    target_by_identity = {
        (target["entityKey"], target["fieldGroup"], target["fieldName"]): target
        for target in targets.values()
    }
    for change in expected_changes:
        change_key = change.get("changeKey")
        if not isinstance(change_key, str) or change_key in seen_change_keys or change.get("operation") != "set_field":
            raise ReconciliationError("audit changes require unique keys and set_field operations")
        seen_change_keys.add(change_key)
        identity = (
            change.get("target", {}).get("entityKey"),
            change.get("target", {}).get("fieldGroup"),
            change.get("target", {}).get("fieldName"),
        )
        target = target_by_identity.get(identity)
        entity = entities.get(identity[0])
        exact_target = None if not target or not entity else {
            "entityKey": target["entityKey"],
            "entityKind": entity["expectedKind"],
            "surface": target["surface"],
            "fieldGroup": target["fieldGroup"],
            "fieldName": target["fieldName"],
            "wooColumn": target["wooColumn"],
        }
        if not target or change.get("target") != exact_target:
            raise ReconciliationError("audit change target is outside the exact profile")
        row, product_id, _ = mapped[target["entityKey"]]
        column = _column_for_binding(before, target["wooColumn"], f"target {target['targetKey']}")
        cell_key = (product_id, column.index)
        if cell_key in expected_by_cell:
            raise ReconciliationError("audit change set addresses the same Woo cell more than once")
        current_normalized, _ = _normalize_woo(row.values[column.index], target["normalization"])
        if not _same_value(current_normalized, change.get("current", {}).get("normalizedValue")):
            raise ReconciliationError("audit before snapshot does not match the change-set current state")
        candidate_value = change.get("candidate", {}).get("normalizedValue")
        if target["normalization"]["kind"] == "money":
            if isinstance(candidate_value, bool) or not isinstance(candidate_value, (int, float)):
                raise ReconciliationError("audit money candidate is not numeric")
        elif not isinstance(candidate_value, str):
            raise ReconciliationError("audit text/media candidate is not a string")
        expected_by_cell[cell_key] = (change, target)

    before_ids = set(before_by_id)
    after_ids = set(after_by_id)
    for product_id in sorted(before_ids - after_ids):
        identity_drift.append({"kind": "row_removed", "rowIdentitySha256": _row_identity_hash(product_id), "entityKey": None})
    for product_id in sorted(after_ids - before_ids):
        identity_drift.append({"kind": "row_added", "rowIdentitySha256": _row_identity_hash(product_id), "entityKey": None})

    changed_expected_cells: set[tuple[int, int]] = set()
    if not blockers or blockers == [item for item in blockers if item.startswith("after_")]:
        for product_id in sorted(before_ids & after_ids):
            before_row = before_by_id[product_id]
            after_row = after_by_id[product_id]
            entity_key = next((key for key, (_, mapped_id, _) in mapped.items() if mapped_id == product_id), None)
            if before_row.values[parent_column.index] != after_row.values[parent_column.index]:
                identity_drift.append({"kind": "parent_relation_changed", "rowIdentitySha256": _row_identity_hash(product_id), "entityKey": entity_key})
            if before_row.values[sku_column.index] != after_row.values[sku_column.index]:
                identity_drift.append({"kind": "sku_changed", "rowIdentitySha256": _row_identity_hash(product_id), "entityKey": entity_key})
            for column in before.columns:
                if before_row.values[column.index] == after_row.values[column.index]:
                    continue
                cell_key = (product_id, column.index)
                expected = expected_by_cell.get(cell_key)
                if expected:
                    change, target = expected
                    after_normalized, _ = _normalize_woo(after_row.values[column.index], target["normalization"])
                    if _same_value(after_normalized, change["candidate"]["normalizedValue"]):
                        verified += 1
                        changed_expected_cells.add(cell_key)
                        continue
                unexpected.append(
                    {
                        "rowIdentitySha256": _row_identity_hash(product_id),
                        "entityKey": entity_key,
                        "column": column.contract(),
                        "beforeValueSha256": _value_hash(before_row.values[column.index]),
                        "afterValueSha256": _value_hash(after_row.values[column.index]),
                    }
                )

    for cell_key, (change, target) in expected_by_cell.items():
        if cell_key in changed_expected_cells:
            continue
        product_id, column_index = cell_key
        after_row = after_by_id.get(product_id)
        actual_hash = None if after_row is None else _value_hash(after_row.values[column_index])
        missing.append(
            {
                "changeKey": change["changeKey"],
                "targetKey": target["targetKey"],
                "rowIdentitySha256": _row_identity_hash(product_id),
                "afterValueSha256": actual_hash,
            }
        )

    blockers = sorted(set(blockers))
    passed = not blockers and not unexpected and not identity_drift and not missing and verified == len(expected_by_cell)
    report = {
        "schema": "enki-catalog-post-import-audit/v1",
        "auditKey": f"audit-{profile['runKey']}",
        "profileKey": profile["profileKey"],
        "runKey": profile["runKey"],
        "createdAt": profile["createdAt"],
        "timezone": "Europe/Madrid",
        "provenance": profile["provenance"]["kind"],
        "mode": "sanitized_simulation" if sanitized else "operational_post_import_observation",
        "inputs": {
            "profileSha256": profile_sha256,
            "changeSetSha256": _sha256_file(workspace.files["change-set"]),
            "beforeWooSha256": before.sha256,
            "afterWooSha256": after.sha256,
        },
        "expectedChanges": len(expected_by_cell),
        "verifiedChanges": verified,
        "missingExpectedChanges": missing,
        "unexpectedChanges": unexpected,
        "identityDrift": identity_drift,
        "blockers": blockers,
        "passed": passed,
        "authority": {
            "isObservation": True,
            "isExternalMutationAuthority": False,
            "canGenerateWooImport": False,
            "containsRawOutOfScopeValues": False,
        },
    }
    output_directory = workspace.output_root / audit_id
    try:
        output_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise ReconciliationError("refusing to overwrite an existing audit") from error
    try:
        _write(output_directory / "audit-report.json", report)
    except Exception:
        shutil.rmtree(output_directory, ignore_errors=True)
        raise
    return {
        "valid": passed,
        "auditDirectory": audit_id,
        "expectedChanges": len(expected_by_cell),
        "verifiedChanges": verified,
        "unexpectedChanges": len(unexpected),
        "identityDrift": len(identity_drift),
        "externalWritesBlocked": True,
    }
