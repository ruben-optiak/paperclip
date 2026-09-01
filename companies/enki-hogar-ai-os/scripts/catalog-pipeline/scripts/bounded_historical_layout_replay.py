#!/usr/bin/env python3
"""Replay one real Woo header/identity shape with fully sanitized row values.

The source export is surveyed in memory. Only aggregate counts, its checksum and
a fingerprint of an ephemeral sanitized reconciliation leave the process.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from enki_catalog_pipeline.safety import validate_data_workspace
from enki_catalog_pipeline.woo_reconciliation import ReconciliationError, deduplicate_headers, reconcile_woo


class ReplayError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def positive_int(value: str) -> int | None:
    value = value.strip()
    return int(value) if value.isdigit() and int(value) > 0 else None


def role(product_type: str, parent_id: int | None) -> str:
    product_type = product_type.strip().lower()
    if product_type == "simple" and parent_id is None:
        return "simple"
    if product_type == "variable" and parent_id is None:
        return "parent"
    if product_type in {"variable", "variation"} and parent_id is not None:
        return "variation"
    return "unknown"


def exact_index(headers: list[str], name: str) -> int:
    matches = [index for index, value in enumerate(headers) if value == name]
    if len(matches) != 1:
        raise ReplayError(f"required unique header is missing or duplicated: {name}")
    return matches[0]


def binding(columns, index: int) -> dict[str, Any]:
    return columns[index].contract()


def survey(path: Path) -> tuple[list[str], dict[str, Any]]:
    if path.suffix.lower() != ".csv" or not path.is_file() or path.is_symlink():
        raise ReplayError("Woo source must be one regular CSV file")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, strict=True)
        try:
            headers = next(reader)
        except StopIteration as error:
            raise ReplayError("Woo source is empty") from error
        rows = list(reader)
    id_index = exact_index(headers, "ID")
    type_index = exact_index(headers, "Product Type")
    parent_index = exact_index(headers, "Parent Product ID")
    sku_index = exact_index(headers, "Sku")
    ids = [row[id_index].strip() for row in rows if len(row) == len(headers)]
    skus = [row[sku_index].strip() for row in rows if len(row) == len(headers)]
    id_set = set(ids)
    roles = []
    orphans = 0
    for row in rows:
        if len(row) != len(headers):
            continue
        parent_id = positive_int(row[parent_index])
        row_role = role(row[type_index], parent_id)
        roles.append(row_role)
        if row_role == "variation" and str(parent_id) not in id_set:
            orphans += 1
    duplicates = Counter(headers)
    summary = {
        "sha256": sha256_file(path),
        "rows": len(rows),
        "columns": len(headers),
        "widthAnomalies": sum(1 for row in rows if len(row) != len(headers)),
        "duplicateHeaderGroups": sum(1 for count in duplicates.values() if count > 1),
        "duplicateIds": len(ids) - len(set(ids)),
        "duplicateSkus": len(skus) - len(set(skus)),
        "rowKinds": {key: Counter(roles).get(key, 0) for key in ("simple", "parent", "variation", "unknown")},
        "orphanVariations": orphans,
    }
    if summary["widthAnomalies"] or summary["duplicateIds"] or summary["duplicateSkus"] or summary["rowKinds"]["unknown"] or summary["orphanVariations"]:
        raise ReplayError("historical source identity survey failed closed")
    return headers, summary


def sanitized_rows(headers: list[str]) -> list[list[str]]:
    columns = deduplicate_headers(headers)
    by_name = {column.deduplicated_header: column.index for column in columns}
    required = ["ID", "Parent Product ID", "Sku", "Regular Price", "Attribute Value (pa_acabado)", "Product Type", "Title", "Title__2", "Featured", "Featured__2"]
    if any(name not in by_name for name in required):
        raise ReplayError("historical layout lacks one reviewed positional replay header")

    def row(values: dict[str, str]) -> list[str]:
        result = [""] * len(headers)
        for name, value in values.items():
            result[by_name[name]] = value
        return result

    return [
        row({"ID": "100", "Parent Product ID": "0", "Sku": "BUA-DEMO-PARENT", "Product Type": "variable", "Title": "Espejo Demo Buades", "Title__2": "Título de adjunto", "Featured": "old-main.webp", "Featured__2": "old-gallery.webp"}),
        row({"ID": "101", "Parent Product ID": "100", "Sku": "BUA-DEMO-CR", "Product Type": "variable", "Regular Price": "120.00", "Attribute Value (pa_acabado)": "Cromo"}),
        row({"ID": "200", "Parent Product ID": "0", "Sku": "OUTSIDE-1", "Product Type": "simple", "Regular Price": "55.00", "Title": "Producto fuera de alcance"}),
    ]


def artifact_fingerprint(run_directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in run_directory.rglob("*") if item.is_file()):
        digest.update(path.relative_to(run_directory).as_posix().encode("utf-8"))
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def execute(source: Path, fixture_root: Path) -> dict[str, Any]:
    headers, source_summary = survey(source)
    columns = deduplicate_headers(headers)
    index = {column.deduplicated_header: column.index for column in columns}
    with tempfile.TemporaryDirectory(prefix="enki-eai021-replay-") as temporary:
        root = Path(temporary)
        input_root = root / "input"
        output_root = root / "output"
        input_root.mkdir()
        output_root.mkdir()
        profile = json.loads((fixture_root / "profile.json").read_text(encoding="utf-8"))
        candidates = [json.loads(line) for line in (fixture_root / "candidates.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        candidates = [item for item in candidates if item["field"]["name"] != "seo_title"]
        profile["profileKey"] = "buades-historical-layout-replay-v1"
        profile["runKey"] = "catalog-run-buades-historical-layout-replay"
        profile["provenance"]["sourceIssue"] = "EAI-021-historical-layout-replay"
        profile["scope"]["targets"] = [item for item in profile["scope"]["targets"] if item["fieldName"] != "seo_title"]
        for candidate in candidates:
            candidate["runKey"] = profile["runKey"]

        profile["identity"]["productId"] = binding(columns, index["ID"])
        profile["identity"]["productType"] = binding(columns, index["Product Type"])
        profile["identity"]["parentProductId"] = binding(columns, index["Parent Product ID"])
        profile["identity"]["sku"] = binding(columns, index["Sku"])
        target_columns = {
            "variation-price-gross": "Regular Price",
            "parent-featured-image": "Featured",
            "variation-finish": "Attribute Value (pa_acabado)",
            "parent-product-title": "Title",
        }
        for target in profile["scope"]["targets"]:
            selected = target_columns[target["targetKey"]]
            target["wooColumn"] = binding(columns, index[selected])

        woo_path = input_root / "woo-historical-layout-sanitized.csv"
        with woo_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(headers)
            writer.writerows(sanitized_rows(headers))
        woo_source = next(item for item in profile["sources"] if item["sourceKey"] == profile["wooSnapshotSourceKey"])
        woo_source["sha256"] = sha256_file(woo_path)
        woo_source["rowCount"] = 3

        (input_root / "profile.json").write_text(json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        (input_root / "candidates.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n" for item in candidates), encoding="utf-8")
        workspace = validate_data_workspace(
            input_root,
            output_root,
            {"profile": ("profile.json", {".json"}), "candidates": ("candidates.jsonl", {".jsonl"}), "woo": (woo_path.name, {".csv"})},
        )
        result = reconcile_woo(workspace, run_id="bounded-historical-layout-replay")
        run = output_root / result["runDirectory"]
        report = json.loads((run / "artifacts" / "reconciliation-report.json").read_text(encoding="utf-8"))
        return {
            "schema": "enki-bounded-historical-layout-replay-receipt/v1",
            "executedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "sourceSnapshot": source_summary,
            "sanitizedReplay": {
                "rows": 3,
                "inScopeEntities": report["identity"]["inScopeEntities"],
                "outsideScopeRows": report["identity"]["outsideScopeRows"],
                "candidateFields": report["results"]["candidateFields"],
                "matches": report["results"]["matches"],
                "changes": report["results"]["changes"],
                "criticalChanges": report["results"]["criticalChanges"],
                "artifactFingerprintSha256": artifact_fingerprint(run),
            },
            "authority": {
                "sourceValuesRetained": False,
                "artifactsPersisted": False,
                "isCurrentCommercialTruth": False,
                "isExternalMutationAuthority": False,
                "canGenerateWooImport": False,
            },
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a bounded, ephemeral and sanitized replay of one historical Woo layout.")
    parser.add_argument("--woo-export", type=Path, required=True)
    parser.add_argument("--fixture-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = execute(args.woo_export.resolve(strict=True), args.fixture_root.resolve(strict=True))
    except (OSError, UnicodeError, csv.Error, json.JSONDecodeError, ReplayError, ReconciliationError, ValueError):
        print(json.dumps({"valid": False, "error": "bounded historical layout replay failed closed"}, sort_keys=True))
        return 1
    print(json.dumps({"valid": True, **receipt}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
