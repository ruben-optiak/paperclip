"""Independent adapter runner against the immutable EAI-019 oracle."""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from typing import Any

from . import PIPELINE_VERSION
from .catalog_adapters import (
    AdapterCatalog,
    AdapterError,
    adapter_for_fixture,
    evaluate_with_adapter,
    load_adapter_catalog,
    sha256_bytes,
)


def run_adapter_regression(
    manifest_path: Path | str,
    *,
    registry_path: Path | str | None = None,
) -> dict[str, Any]:
    selected_manifest = Path(manifest_path)
    manifest = _load_json(selected_manifest, "oracle manifest")
    if manifest.get("schema") != "enki-catalog-regression-suite/v1" or manifest.get("version") != "1.0.0":
        raise AdapterError("Unsupported catalogue regression oracle.")
    catalog = load_adapter_catalog(registry_path)
    fixture_entries = manifest.get("fixtures")
    if not isinstance(fixture_entries, list) or not fixture_entries:
        raise AdapterError("Oracle manifest has no fixtures.")

    declared_fixture_keys = {
        binding["fixtureKey"]
        for adapter in catalog.adapters
        for binding in adapter.document["fixtureBindings"]
    }
    oracle_fixture_keys = {entry.get("fixtureKey") for entry in fixture_entries}
    if declared_fixture_keys != oracle_fixture_keys:
        raise AdapterError("Adapter fixture scope must exactly cover the immutable oracle.")

    root = selected_manifest.resolve().parent
    fixture_results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for entry in fixture_entries:
        fixture_key = entry.get("fixtureKey")
        fixture_path = _resolve_within(root, entry.get("path"))
        raw_fixture = _read_bytes(fixture_path, f"fixture {fixture_key}")
        fixture_sha256 = sha256_bytes(raw_fixture)
        if fixture_sha256 != entry.get("sha256"):
            raise AdapterError(f"Oracle fixture hash drift: {fixture_key}.")
        fixture = _json(raw_fixture, f"fixture {fixture_key}")
        if fixture.get("fixtureKey") != fixture_key or fixture.get("brand", {}).get("slug") != entry.get("brandSlug"):
            raise AdapterError(f"Oracle fixture identity drift: {fixture_key}.")

        adapter = adapter_for_fixture(catalog, str(fixture_key))
        result = evaluate_with_adapter(adapter, fixture, fixture_sha256=fixture_sha256)
        comparison = _compare_to_oracle(result["pairs"], fixture.get("expected", {}).get("pairs", []))
        binding = next(item for item in adapter.document["fixtureBindings"] if item["fixtureKey"] == fixture_key)
        if binding["expectedPairCount"] != comparison["expectedPairCount"]:
            errors.append({
                "code": "declared_pair_count_drift",
                "fixtureKey": str(fixture_key),
                "message": "Adapter-declared pair count differs from the immutable oracle.",
            })
        if not comparison["exactMatch"]:
            errors.append({
                "code": "pairing_mismatch",
                "fixtureKey": str(fixture_key),
                "message": "Adapter output differs from the immutable oracle.",
            })
        fixture_results.append({**result, "oracleMetrics": comparison})

    adapter_metrics = _adapter_metrics(catalog, fixture_results, errors)
    total_subjects = sum(item["metrics"]["subjectCount"] for item in fixture_results)
    total_paired_subjects = sum(item["metrics"]["pairedSubjectCount"] for item in fixture_results)
    total_expected_pairs = sum(item["oracleMetrics"]["expectedPairCount"] for item in fixture_results)
    total_pair_errors = sum(item["oracleMetrics"]["pairErrorCount"] for item in fixture_results)
    passed_fixtures = sum(1 for item in fixture_results if item["oracleMetrics"]["exactMatch"])

    summary = {
        "adapters": len(adapter_metrics),
        "fixtures": len(fixture_results),
        "expectedPairs": total_expected_pairs,
        "producedPairs": sum(item["metrics"]["pairCount"] for item in fixture_results),
        "subjectCoverage": round(total_paired_subjects / total_subjects, 6) if total_subjects else 0.0,
        "pairErrorCount": total_pair_errors,
        "pairErrorRate": round(total_pair_errors / total_expected_pairs, 6) if total_expected_pairs else 0.0,
        "fixturePassRate": round(passed_fixtures / len(fixture_results), 6),
    }
    valid = not errors and all(item["passed"] for item in adapter_metrics)
    return {
        "schema": "enki-catalog-adapter-regression/v1",
        "runtimeVersion": PIPELINE_VERSION,
        "oracle": {
            "schema": manifest["schema"],
            "version": manifest["version"],
            "provenance": manifest["provenance"]["kind"],
        },
        "valid": valid,
        "errors": errors,
        "summary": summary,
        "adapters": adapter_metrics,
        "fixtures": fixture_results,
        "authority": {
            "isLiveCommercialTruth": False,
            "isExternalMutationAuthority": False,
            "canGenerateWooImport": False,
            "outputMode": "test_metrics_only",
        },
    }


def _adapter_metrics(
    catalog: AdapterCatalog,
    fixture_results: list[dict[str, Any]],
    errors: list[dict[str, str]],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for loaded in catalog.adapters:
        definition = loaded.document
        results = [item for item in fixture_results if item["adapter"]["adapterKey"] == definition["adapterKey"]]
        subject_count = sum(item["metrics"]["subjectCount"] for item in results)
        paired_subject_count = sum(item["metrics"]["pairedSubjectCount"] for item in results)
        expected_pairs = sum(item["oracleMetrics"]["expectedPairCount"] for item in results)
        produced_pairs = sum(item["metrics"]["pairCount"] for item in results)
        pair_errors = sum(item["oracleMetrics"]["pairErrorCount"] for item in results)
        passed_fixtures = sum(1 for item in results if item["oracleMetrics"]["exactMatch"])
        fixture_pass_rate = passed_fixtures / len(results) if results else 0.0
        subject_coverage = paired_subject_count / subject_count if subject_count else 0.0
        pair_error_rate = pair_errors / expected_pairs if expected_pairs else 0.0
        gate = definition["qualityGate"]
        passed = (
            len(results) == gate["expectedFixtureCount"]
            and expected_pairs == gate["expectedPairCount"]
            and fixture_pass_rate >= gate["minimumFixturePassRate"]
            and subject_coverage >= gate["minimumSubjectCoverage"]
            and pair_error_rate <= gate["maximumPairErrorRate"]
        )
        if not passed:
            errors.append({
                "code": "adapter_quality_gate_failed",
                "fixtureKey": definition["adapterKey"],
                "message": "Adapter coverage or error metrics missed its declared quality gate.",
            })
        output.append(
            {
                "adapterKey": definition["adapterKey"],
                "brandSlug": definition["brandSlug"],
                "version": definition["version"],
                "definitionSha256": loaded.definition_sha256,
                "fixtureCount": len(results),
                "expectedPairCount": expected_pairs,
                "producedPairCount": produced_pairs,
                "subjectCoverage": round(subject_coverage, 6),
                "pairErrorCount": pair_errors,
                "pairErrorRate": round(pair_error_rate, 6),
                "fixturePassRate": round(fixture_pass_rate, 6),
                "qualityGate": dict(gate),
                "passed": passed,
            }
        )
    return output


def _compare_to_oracle(actual_pairs: list[dict[str, Any]], expected_pairs: Any) -> dict[str, Any]:
    if not isinstance(expected_pairs, list):
        raise AdapterError("Oracle expected pairs must be an array.")
    actual = {str(pair.get("pairKey")): pair for pair in actual_pairs}
    expected = {str(pair.get("pairKey")): pair for pair in expected_pairs}
    if len(actual) != len(actual_pairs) or len(expected) != len(expected_pairs):
        raise AdapterError("Pair keys must be unique in adapter output and oracle.")
    missing = sorted(set(expected) - set(actual))
    unexpected = sorted(set(actual) - set(expected))
    mismatched = sorted(key for key in set(actual) & set(expected) if actual[key] != expected[key])
    error_count = len(missing) + len(unexpected) + len(mismatched)
    expected_count = len(expected_pairs)
    return {
        "expectedPairCount": expected_count,
        "producedPairCount": len(actual_pairs),
        "missingPairKeys": missing,
        "unexpectedPairKeys": unexpected,
        "mismatchedPairKeys": mismatched,
        "pairErrorCount": error_count,
        "pairErrorRate": round(error_count / expected_count, 6) if expected_count else 0.0,
        "exactMatch": error_count == 0,
    }


def _load_json(path: Path, label: str) -> dict[str, Any]:
    return _json(_read_bytes(path, label), label)


def _read_bytes(path: Path, label: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise AdapterError(f"Could not read {label}.") from error


def _json(raw: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AdapterError(f"{label} must be valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise AdapterError(f"{label} must be a JSON object.")
    return value


def _resolve_within(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise AdapterError("Oracle fixture path must be portable and relative.")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise AdapterError("Oracle fixture path escapes its suite.")
    resolved = (root / Path(*pure.parts)).resolve()
    if root != resolved and root not in resolved.parents:
        raise AdapterError("Oracle fixture path escapes its suite.")
    return resolved
