from __future__ import annotations

import copy
import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline import ADAPTER_CORE_VERSION, PIPELINE_VERSION
from enki_catalog_pipeline.adapter_regression import run_adapter_regression
from enki_catalog_pipeline.catalog_adapters import (
    AdapterError,
    adapter_for_fixture,
    evaluate_with_adapter,
    load_adapter_catalog,
)
from enki_catalog_pipeline.cli import main
from enki_catalog_pipeline.extraction_core import ExtractionError


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = RUNTIME_ROOT / "adapters" / "registry.json"
ORACLE_ROOT = PACKAGE_ROOT / "skills" / "enki-catalog-qa" / "fixtures" / "catalog-regression" / "v1"
MANIFEST_PATH = ORACLE_ROOT / "manifest.json"


def json_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def fixture_path(key: str) -> Path:
    manifest = json_file(MANIFEST_PATH)
    entry = next(item for item in manifest["fixtures"] if item["fixtureKey"] == key)
    return ORACLE_ROOT / entry["path"]


def fixture(key: str) -> tuple[dict, str]:
    path = fixture_path(key)
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


class AdapterRegistryTests(unittest.TestCase):
    def test_registry_loads_exactly_four_hashed_snapshot_adapters(self) -> None:
        catalog = load_adapter_catalog()
        self.assertEqual(PIPELINE_VERSION, "0.3.0")
        self.assertEqual(ADAPTER_CORE_VERSION, "0.2.0")
        self.assertEqual(len(catalog.adapters), 4)
        self.assertEqual(
            {item.document["brandSlug"] for item in catalog.adapters},
            {"buades", "enki-espejos", "mundilite", "chicandbath"},
        )
        for adapter in catalog.adapters:
            self.assertEqual(adapter.document["version"], "1.0.0")
            self.assertEqual(len(adapter.definition_sha256), 64)
            self.assertEqual(adapter.document["scope"]["unknownSnapshots"], "deny")
            self.assertEqual(adapter.document["scope"]["unknownPages"], "deny")

    def test_only_multibrand_row_strategy_is_promoted_to_core(self) -> None:
        catalog = load_adapter_catalog()
        promotions = catalog.registry["corePromotions"]
        self.assertEqual([item["strategy"] for item in promotions], ["row_left_to_right"])
        self.assertEqual(set(promotions[0]["evidenceBrands"]), {"buades", "enki-espejos", "mundilite"})
        chic = next(item.document for item in catalog.adapters if item.document["brandSlug"] == "chicandbath")
        self.assertEqual(chic["rules"][0]["strategy"], "matrix_by_headers")
        self.assertEqual(chic["rules"][0]["strategyOwner"], "adapter")
        core_source = (RUNTIME_ROOT / "src" / "enki_catalog_pipeline" / "extraction_core.py").read_text(encoding="utf-8")
        self.assertNotIn("matrix_by_headers", core_source)
        self.assertNotIn("chicandbath", core_source.lower())

    def test_every_adapter_declares_exact_coverage_and_zero_error_gate(self) -> None:
        catalog = load_adapter_catalog()
        declared_pairs = 0
        declared_fixtures = 0
        for adapter in catalog.adapters:
            gate = adapter.document["qualityGate"]
            self.assertEqual(gate["minimumFixturePassRate"], 1)
            self.assertEqual(gate["minimumSubjectCoverage"], 1)
            self.assertEqual(gate["maximumPairErrorRate"], 0)
            declared_pairs += gate["expectedPairCount"]
            declared_fixtures += gate["expectedFixtureCount"]
        self.assertEqual(declared_pairs, 21)
        self.assertEqual(declared_fixtures, 6)

    def test_definition_hash_drift_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "adapters"
            shutil.copytree(RUNTIME_ROOT / "adapters", copied)
            definition = copied / "buades-2026-04-11.v1.json"
            definition.write_text(definition.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            with self.assertRaisesRegex(AdapterError, "hash drift"):
                load_adapter_catalog(copied / "registry.json")

    def test_unknown_definition_path_is_confined_to_registry_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "adapters"
            shutil.copytree(RUNTIME_ROOT / "adapters", copied)
            registry = json_file(copied / "registry.json")
            registry["adapters"][0]["path"] = "../outside.json"
            (copied / "registry.json").write_text(json.dumps(registry), encoding="utf-8")
            with self.assertRaisesRegex(AdapterError, "portable|inside"):
                load_adapter_catalog(copied / "registry.json")


class AdapterExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = load_adapter_catalog()

    def evaluate(self, key: str, document: dict | None = None) -> dict:
        original, digest = fixture(key)
        selected = document if document is not None else original
        adapter = adapter_for_fixture(self.catalog, key)
        return evaluate_with_adapter(adapter, selected, fixture_sha256=digest)

    def test_all_adapters_match_immutable_oracle_with_exact_metrics(self) -> None:
        report = run_adapter_regression(MANIFEST_PATH)
        self.assertTrue(report["valid"], report["errors"])
        self.assertEqual(
            report["summary"],
            {
                "adapters": 4,
                "fixtures": 6,
                "expectedPairs": 21,
                "producedPairs": 21,
                "subjectCoverage": 1.0,
                "pairErrorCount": 0,
                "pairErrorRate": 0.0,
                "fixturePassRate": 1.0,
            },
        )
        self.assertTrue(all(item["passed"] for item in report["adapters"]))

    def test_adapter_metrics_are_exact_per_brand(self) -> None:
        report = run_adapter_regression(MANIFEST_PATH)
        metrics = {item["brandSlug"]: item for item in report["adapters"]}
        self.assertEqual(
            {brand: (item["fixtureCount"], item["expectedPairCount"], item["producedPairCount"]) for brand, item in metrics.items()},
            {
                "buades": (2, 6, 6),
                "enki-espejos": (2, 7, 7),
                "mundilite": (1, 4, 4),
                "chicandbath": (1, 4, 4),
            },
        )
        self.assertTrue(all(item["subjectCoverage"] == 1 for item in metrics.values()))
        self.assertTrue(all(item["pairErrorRate"] == 0 for item in metrics.values()))

    def test_extraction_does_not_read_oracle_expected_or_fixture_pairing(self) -> None:
        document, _ = fixture("buades-table-multi-price")
        baseline = self.evaluate("buades-table-multi-price", copy.deepcopy(document))
        document["expected"] = {"pairs": []}
        document["pairing"] = {"strategy": "deliberately_ignored"}
        changed = self.evaluate("buades-table-multi-price", document)
        self.assertEqual(changed["pairs"], baseline["pairs"])
        self.assertEqual(changed["metrics"], baseline["metrics"])

    def test_results_are_deterministic_and_have_no_write_authority(self) -> None:
        first = self.evaluate("chicandbath-configurator-matrix")
        second = self.evaluate("chicandbath-configurator-matrix")
        self.assertEqual(first, second)
        self.assertFalse(first["authority"]["isLiveCommercialTruth"])
        self.assertFalse(first["authority"]["isExternalMutationAuthority"])
        self.assertFalse(first["authority"]["canGenerateWooImport"])
        self.assertEqual(first["rule"]["strategyOwner"], "adapter")

    def test_shared_next_price_semantics_remain_visible_in_metrics(self) -> None:
        result = self.evaluate("buades-table-multi-price")
        self.assertEqual(result["metrics"]["subjectCount"], 3)
        self.assertEqual(result["metrics"]["valueCount"], 2)
        self.assertEqual(result["metrics"]["pairCount"], 3)
        self.assertEqual(result["metrics"]["pairedValueCount"], 2)

    def test_mundilite_parent_reference_is_not_given_a_finish_price(self) -> None:
        result = self.evaluate("mundilite-finish-matrix")
        self.assertEqual(result["metrics"]["subjectCount"], 4)
        self.assertTrue(all(pair["subjectElementKey"].startswith("mun-finish-") for pair in result["pairs"]))
        self.assertFalse(any(pair["subjectElementKey"] == "mun-parent-ref" for pair in result["pairs"]))

    def test_unknown_brand_snapshot_page_and_features_are_denied(self) -> None:
        for mutation, message in [
            (lambda item: item["brand"].update(slug="other-brand"), "Brand scope"),
            (lambda item: item["provenance"].update(sourceSnapshotDate="2026-09-01"), "Snapshot scope"),
            (lambda item: item["provenance"].update(sourcePage=999), "Page scope"),
            (lambda item: item.update(features=["detail"]), "Feature scope"),
        ]:
            with self.subTest(message=message):
                document, _ = fixture("enki-espejos-grid")
                mutation(document)
                with self.assertRaisesRegex(AdapterError, message):
                    self.evaluate("enki-espejos-grid", document)

    def test_invalid_geometry_and_missing_subject_entity_are_denied(self) -> None:
        document, _ = fixture("buades-detail-card")
        document["elements"][1]["box"]["x1"] = document["elements"][1]["box"]["x0"]
        with self.assertRaisesRegex(ExtractionError, "positive area"):
            self.evaluate("buades-detail-card", document)

        document, _ = fixture("buades-detail-card")
        document["elements"][1]["entity"] = None
        with self.assertRaisesRegex(ExtractionError, "typed QA entity"):
            self.evaluate("buades-detail-card", document)

    def test_unpaired_row_is_reported_without_inventing_a_value(self) -> None:
        document, _ = fixture("buades-table-multi-price")
        price = next(item for item in document["elements"] if item["elementKey"] == "bds-price-c")
        price["box"] = {"x0": 10, "y0": 400, "x1": 60, "y1": 420}
        result = self.evaluate("buades-table-multi-price", document)
        self.assertEqual(result["metrics"]["subjectCoverage"], 0.666667)
        self.assertEqual(result["metrics"]["unpairedSubjectCount"], 1)
        self.assertEqual(result["metrics"]["diagnosticCount"], 1)
        self.assertFalse(any(pair["subjectElementKey"] == "bds-ref-c" for pair in result["pairs"]))

    def test_chicandbath_requires_both_row_subject_and_upper_width_header(self) -> None:
        document, _ = fixture("chicandbath-configurator-matrix")
        header = next(item for item in document["elements"] if item["elementKey"] == "chic-width-60")
        header["box"] = {"x0": 1120, "y0": 300, "x1": 1150, "y1": 320}
        result = self.evaluate("chicandbath-configurator-matrix", document)
        self.assertEqual(result["metrics"]["pairCount"], 2)
        self.assertEqual(result["metrics"]["unusedValueCount"], 2)
        self.assertEqual(result["metrics"]["diagnosticCount"], 2)

    def test_oracle_hash_drift_is_rejected_before_execution(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "v1"
            shutil.copytree(ORACLE_ROOT, copied)
            target = copied / "cases" / "buades-detail-card.json"
            target.write_text(target.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            with self.assertRaisesRegex(AdapterError, "Oracle fixture hash drift"):
                run_adapter_regression(copied / "manifest.json")

    def test_cli_lists_and_verifies_adapters(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            status = main(["adapter-list"])
        self.assertEqual(status, 0)
        self.assertEqual(len(json.loads(output.getvalue())["adapters"]), 4)

        output = io.StringIO()
        with redirect_stdout(output):
            status = main(["adapter-regression", "--manifest", str(MANIFEST_PATH)])
        self.assertEqual(status, 0)
        self.assertTrue(json.loads(output.getvalue())["valid"])


if __name__ == "__main__":
    unittest.main()
