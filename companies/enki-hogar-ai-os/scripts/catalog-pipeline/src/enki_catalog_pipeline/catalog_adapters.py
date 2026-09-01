"""Load, lock and execute versioned catalogue brand adapters."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from . import ADAPTER_CORE_VERSION
from .brand_adapters import IMPLEMENTATIONS
from .extraction_core import ExtractionError


class AdapterError(ValueError):
    """The adapter registry, scope or definition is invalid."""


@dataclass(frozen=True)
class LoadedAdapter:
    document: dict[str, Any]
    definition_sha256: str


@dataclass(frozen=True)
class AdapterCatalog:
    registry: dict[str, Any]
    adapters: tuple[LoadedAdapter, ...]


def default_registry_path() -> Path:
    return Path(__file__).resolve().parents[2] / "adapters" / "registry.json"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_adapter_catalog(registry_path: Path | str | None = None) -> AdapterCatalog:
    selected_path = Path(registry_path) if registry_path is not None else default_registry_path()
    raw_registry = _read_bytes(selected_path, "adapter registry")
    registry = _json(raw_registry, "adapter registry")
    if registry.get("schema") != "enki-catalog-adapter-registry/v1" or registry.get("version") != "1.0.0":
        raise AdapterError("Unsupported adapter registry contract.")
    if registry.get("coreVersion") != ADAPTER_CORE_VERSION:
        raise AdapterError("Adapter registry coreVersion does not match the runtime.")
    entries = registry.get("adapters")
    if not isinstance(entries, list) or len(entries) != 4:
        raise AdapterError("Adapter registry must contain exactly four reviewed adapters.")

    root = selected_path.resolve().parent
    loaded: list[LoadedAdapter] = []
    seen_keys: set[str] = set()
    seen_brands: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise AdapterError("Adapter registry entries must be objects.")
        adapter_key = entry.get("adapterKey")
        brand_slug = entry.get("brandSlug")
        if not isinstance(adapter_key, str) or adapter_key in seen_keys:
            raise AdapterError("Adapter registry keys must be unique strings.")
        if not isinstance(brand_slug, str) or brand_slug in seen_brands:
            raise AdapterError("Adapter registry must define one adapter per brand.")
        definition_path = _resolve_portable(root, entry.get("path"))
        raw_definition = _read_bytes(definition_path, f"adapter {adapter_key}")
        digest = sha256_bytes(raw_definition)
        if digest != entry.get("sha256"):
            raise AdapterError(f"Adapter definition hash drift: {adapter_key}.")
        document = _json(raw_definition, f"adapter {adapter_key}")
        _validate_definition(document, entry)
        loaded.append(LoadedAdapter(document=document, definition_sha256=digest))
        seen_keys.add(adapter_key)
        seen_brands.add(brand_slug)

    catalog = AdapterCatalog(registry=registry, adapters=tuple(loaded))
    _validate_core_promotions(catalog)
    _validate_fixture_ownership(catalog)
    return catalog


def adapter_for_fixture(catalog: AdapterCatalog, fixture_key: str) -> LoadedAdapter:
    matches = [
        adapter
        for adapter in catalog.adapters
        if any(binding.get("fixtureKey") == fixture_key for binding in adapter.document.get("fixtureBindings", []))
    ]
    if len(matches) != 1:
        raise AdapterError(f"Fixture {fixture_key} must belong to exactly one adapter.")
    return matches[0]


def evaluate_with_adapter(
    adapter: LoadedAdapter,
    fixture: dict[str, Any],
    *,
    fixture_sha256: str,
) -> dict[str, Any]:
    definition = adapter.document
    fixture_key = fixture.get("fixtureKey")
    binding = next(
        (item for item in definition["fixtureBindings"] if item.get("fixtureKey") == fixture_key),
        None,
    )
    if binding is None:
        raise AdapterError(f"Adapter {definition['adapterKey']} does not own fixture {fixture_key}.")
    if binding["sha256"] != fixture_sha256:
        raise AdapterError(f"Fixture hash drift for adapter {definition['adapterKey']}.")
    if fixture.get("schema") != "enki-catalog-regression-fixture/v1":
        raise AdapterError("Adapter regression accepts only the sanitized fixture contract.")
    if fixture.get("brand", {}).get("slug") != definition["brandSlug"]:
        raise AdapterError(f"Brand scope mismatch for adapter {definition['adapterKey']}.")
    provenance = fixture.get("provenance", {})
    if provenance.get("sourceSnapshotDate") != binding["sourceSnapshotDate"]:
        raise AdapterError(f"Snapshot scope mismatch for adapter {definition['adapterKey']}.")
    if provenance.get("sourcePage") != binding["sourcePage"]:
        raise AdapterError(f"Page scope mismatch for adapter {definition['adapterKey']}.")
    if sorted(fixture.get("features", [])) != sorted(binding["features"]):
        raise AdapterError(f"Feature scope mismatch for adapter {definition['adapterKey']}.")

    scope = definition["scope"]
    if fixture_key not in scope["fixtureKeys"] or binding["sourceSnapshotDate"] not in scope["sourceSnapshotDates"] or binding["sourcePage"] not in scope["sourcePages"]:
        raise AdapterError(f"Fixture falls outside declared scope for adapter {definition['adapterKey']}.")

    rule = next((item for item in definition["rules"] if item.get("ruleKey") == binding["ruleKey"]), None)
    if rule is None:
        raise AdapterError(f"Missing bound rule for adapter {definition['adapterKey']}.")
    implementation = IMPLEMENTATIONS.get(definition["implementation"])
    if implementation is None:
        raise AdapterError(f"Unknown implementation for adapter {definition['adapterKey']}.")
    try:
        extracted = implementation(fixture, rule)
    except ExtractionError:
        raise

    return {
        "schema": "enki-catalog-adapter-result/v1",
        "coreVersion": ADAPTER_CORE_VERSION,
        "adapter": {
            "adapterKey": definition["adapterKey"],
            "brandSlug": definition["brandSlug"],
            "version": definition["version"],
            "definitionSha256": adapter.definition_sha256,
        },
        "fixture": {
            "fixtureKey": fixture_key,
            "sha256": fixture_sha256,
            "sourceSnapshotDate": binding["sourceSnapshotDate"],
            "sourcePage": binding["sourcePage"],
            "features": list(binding["features"]),
        },
        "rule": {
            "ruleKey": rule["ruleKey"],
            "version": rule["version"],
            "strategy": rule["strategy"],
            "strategyOwner": rule["strategyOwner"],
            "outputField": dict(rule["outputField"]),
        },
        "pairs": extracted["pairs"],
        "diagnostics": extracted["diagnostics"],
        "metrics": extracted["metrics"],
        "authority": {
            "isObservation": True,
            "isLiveCommercialTruth": False,
            "isExternalMutationAuthority": False,
            "canGenerateWooImport": False,
            "outputMode": "local_regression_observation_only",
        },
    }


def _validate_definition(document: dict[str, Any], entry: dict[str, Any]) -> None:
    if document.get("schema") != "enki-catalog-adapter/v1" or document.get("version") != "1.0.0":
        raise AdapterError(f"Unsupported adapter definition: {entry.get('adapterKey')}.")
    if document.get("adapterKey") != entry.get("adapterKey") or document.get("brandSlug") != entry.get("brandSlug"):
        raise AdapterError(f"Adapter registry identity drift: {entry.get('adapterKey')}.")
    if document.get("implementation") != entry.get("implementation") or document.get("implementation") not in IMPLEMENTATIONS:
        raise AdapterError(f"Adapter implementation drift: {entry.get('adapterKey')}.")
    scope = document.get("scope")
    if not isinstance(scope, dict) or scope.get("unknownSnapshots") != "deny" or scope.get("unknownPages") != "deny":
        raise AdapterError(f"Adapter must be closed to unknown scope: {entry.get('adapterKey')}.")
    authority = document.get("authority")
    if authority != {
        "isLiveCommercialTruth": False,
        "isExternalMutationAuthority": False,
        "canGenerateWooImport": False,
        "outputMode": "local_observation_only",
    }:
        raise AdapterError(f"Adapter authority drift: {entry.get('adapterKey')}.")
    rules = document.get("rules")
    bindings = document.get("fixtureBindings")
    if not isinstance(rules, list) or not rules or not isinstance(bindings, list) or not bindings:
        raise AdapterError(f"Adapter requires rules and fixture bindings: {entry.get('adapterKey')}.")
    rule_keys = {rule.get("ruleKey") for rule in rules}
    if len(rule_keys) != len(rules) or None in rule_keys:
        raise AdapterError(f"Adapter rule keys must be unique: {entry.get('adapterKey')}.")
    if any(binding.get("ruleKey") not in rule_keys for binding in bindings):
        raise AdapterError(f"Adapter binding references an unknown rule: {entry.get('adapterKey')}.")
    if sorted(scope.get("fixtureKeys", [])) != sorted(binding.get("fixtureKey") for binding in bindings):
        raise AdapterError(f"Adapter scope and fixture bindings drift: {entry.get('adapterKey')}.")
    gate = document.get("qualityGate", {})
    if gate.get("minimumFixturePassRate") != 1 or gate.get("minimumSubjectCoverage") != 1 or gate.get("maximumPairErrorRate") != 0:
        raise AdapterError(f"Adapter quality gate must require exact regression: {entry.get('adapterKey')}.")
    if gate.get("expectedFixtureCount") != len(bindings) or gate.get("expectedPairCount") != sum(item.get("expectedPairCount", -1) for item in bindings):
        raise AdapterError(f"Adapter declared metrics do not match its bindings: {entry.get('adapterKey')}.")


def _validate_core_promotions(catalog: AdapterCatalog) -> None:
    promotions = catalog.registry.get("corePromotions")
    if not isinstance(promotions, list) or not promotions:
        raise AdapterError("Adapter registry requires reviewed core promotions.")
    binding_brands: dict[str, str] = {}
    for adapter in catalog.adapters:
        for binding in adapter.document["fixtureBindings"]:
            binding_brands[binding["fixtureKey"]] = adapter.document["brandSlug"]

    promoted = set()
    for promotion in promotions:
        strategy = promotion.get("strategy")
        brands = set(promotion.get("evidenceBrands", []))
        fixtures = set(promotion.get("evidenceFixtureKeys", []))
        observed_brands = {binding_brands.get(key) for key in fixtures}
        if len(brands) < 2 or observed_brands != brands or None in observed_brands:
            raise AdapterError(f"Core strategy {strategy} lacks exact multi-brand evidence.")
        promoted.add(strategy)

    for adapter in catalog.adapters:
        for rule in adapter.document["rules"]:
            if rule["strategyOwner"] == "core" and rule["strategy"] not in promoted:
                raise AdapterError(f"Unreviewed strategy was promoted to core: {rule['strategy']}.")
            if rule["strategyOwner"] == "adapter" and rule["strategy"] in promoted:
                raise AdapterError(f"Adapter-local strategy incorrectly appears as a core promotion: {rule['strategy']}.")


def _validate_fixture_ownership(catalog: AdapterCatalog) -> None:
    owners: dict[str, str] = {}
    for adapter in catalog.adapters:
        for binding in adapter.document["fixtureBindings"]:
            fixture_key = binding["fixtureKey"]
            if fixture_key in owners:
                raise AdapterError(f"Fixture {fixture_key} has multiple adapter owners.")
            owners[fixture_key] = adapter.document["adapterKey"]


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


def _resolve_portable(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise AdapterError("Adapter definition path must be portable and relative.")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise AdapterError("Adapter definition path must remain inside the registry directory.")
    resolved = (root / Path(*pure.parts)).resolve()
    if resolved.parent != root:
        raise AdapterError("Adapter definitions must be direct children of the registry directory.")
    return resolved
