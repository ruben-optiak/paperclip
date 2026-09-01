from __future__ import annotations

import copy
import csv
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.cli import main  # noqa: E402
from enki_catalog_pipeline.safety import validate_data_workspace  # noqa: E402
from enki_catalog_pipeline.woo_reconciliation import (  # noqa: E402
    ReconciliationError,
    audit_woo,
    load_woo_snapshot,
    reconcile_woo,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = PACKAGE_ROOT / "skills" / "enki-catalog-qa" / "fixtures" / "catalog-reconciliation" / "v1"


class WooReconciliationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.input_root = self.root / "input"
        self.output_root = self.root / "output"
        shutil.copytree(FIXTURE_ROOT, self.input_root)
        self.output_root.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def workspace(self, output: Path | None = None):
        return validate_data_workspace(
            self.input_root,
            output or self.output_root,
            {
                "profile": ("profile.json", {".json"}),
                "candidates": ("candidates.jsonl", {".jsonl"}),
                "woo": ("woo-before.csv", {".csv"}),
            },
        )

    def reconcile(self, run_id: str = "fixture-run", output: Path | None = None) -> tuple[dict, Path]:
        result = reconcile_woo(self.workspace(output), run_id=run_id)
        return result, (output or self.output_root) / run_id

    def prepare_audit_input(self, run_directory: Path) -> None:
        shutil.copy2(run_directory / "artifacts" / "catalog-change-set.json", self.input_root / "change-set.json")

    def audit_workspace(self, output: Path | None = None, after: str = "woo-after-expected.csv"):
        return validate_data_workspace(
            self.input_root,
            output or self.output_root,
            {
                "profile": ("profile.json", {".json"}),
                "change-set": ("change-set.json", {".json"}),
                "before-woo": ("woo-before.csv", {".csv"}),
                "after-woo": (after, {".csv"}),
            },
        )

    def test_positional_reader_preserves_duplicate_headers_and_exact_width(self) -> None:
        snapshot = load_woo_snapshot(self.input_root / "woo-before.csv", "woo-before.csv")
        self.assertEqual(len(snapshot.columns), 14)
        self.assertEqual(snapshot.columns[4].deduplicated_header, "Title")
        self.assertEqual(snapshot.columns[5].deduplicated_header, "Title__2")
        self.assertEqual(snapshot.columns[6].deduplicated_header, "Regular Price")
        self.assertEqual(snapshot.columns[7].deduplicated_header, "Regular Price__2")
        self.assertEqual(snapshot.columns[8].deduplicated_header, "Images")
        self.assertEqual(snapshot.columns[9].deduplicated_header, "Images__2")

        malformed = self.input_root / "malformed.csv"
        malformed.write_text("A,B\n1\n", encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "exactly 2"):
            load_woo_snapshot(malformed, "malformed.csv")

    def test_reconciliation_separates_parent_variation_and_page_surfaces(self) -> None:
        result, run = self.reconcile()
        self.assertEqual(
            result,
            {
                "valid": True,
                "runKey": "catalog-run-buades-reconciliation-fixture",
                "runDirectory": "fixture-run",
                "matches": 2,
                "changes": 3,
                "outsideScopeRows": 1,
                "externalWritesBlocked": True,
                "canGenerateWooImport": False,
            },
        )
        report = json.loads((run / "artifacts" / "reconciliation-report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["results"], {"candidateFields": 5, "matches": 2, "changes": 3, "criticalChanges": 1})
        self.assertEqual(report["identity"]["rowKinds"], {"simple": 1, "parent": 1, "variation": 1, "unknown": 0})
        self.assertEqual(len(report["positionalLayout"]["duplicateHeaders"]), 3)

        change_set = json.loads((run / "artifacts" / "catalog-change-set.json").read_text(encoding="utf-8"))
        changes = {item["changeKey"]: item for item in change_set["changes"]}
        self.assertEqual(changes["change-variation-price-gross"]["target"]["entityKind"], "variation")
        self.assertEqual(changes["change-variation-price-gross"]["target"]["surface"], "sku")
        self.assertEqual(changes["change-variation-price-gross"]["current"]["normalizedValue"], 120)
        self.assertEqual(changes["change-variation-price-gross"]["candidate"]["normalizedValue"], 121)
        self.assertEqual(changes["change-variation-price-gross"]["comparison"]["fiscalBasis"], "gross_including_vat")
        self.assertEqual(changes["change-parent-seo-title"]["target"]["surface"], "product_page")
        self.assertEqual(changes["change-parent-featured-image"]["target"]["surface"], "product_page")
        self.assertNotIn("change-parent-product-title", changes)
        self.assertNotIn("change-variation-finish", changes)

    def test_current_evidence_uses_first_duplicate_not_attachment_or_secondary_price(self) -> None:
        _, run = self.reconcile()
        records = [json.loads(line) for line in (run / "artifacts" / "catalog-field-evidence.jsonl").read_text(encoding="utf-8").splitlines()]
        current = {item["evidenceKey"]: item for item in records if item["evidenceKey"].startswith("woo-current-")}
        title = current["woo-current-parent-product-title"]
        price = current["woo-current-variation-price-gross"]
        self.assertEqual(title["field"]["rawValue"], "Espejo Demo Buades")
        self.assertEqual(title["location"]["columnIndex"], 4)
        self.assertEqual(title["location"]["deduplicatedHeader"], "Title")
        self.assertEqual(price["field"]["rawValue"], "120.00")
        self.assertEqual(price["location"]["columnIndex"], 6)
        self.assertEqual(price["location"]["deduplicatedHeader"], "Regular Price")

    def test_outputs_are_byte_deterministic_local_only_and_immutable(self) -> None:
        second_output = self.root / "second-output"
        second_output.mkdir()
        _, first = self.reconcile(run_id="same-run")
        _, second = self.reconcile(run_id="same-run", output=second_output)
        first_files = sorted(path.relative_to(first) for path in first.rglob("*") if path.is_file())
        second_files = sorted(path.relative_to(second) for path in second.rglob("*") if path.is_file())
        self.assertEqual(first_files, second_files)
        for relative in first_files:
            self.assertEqual((first / relative).read_bytes(), (second / relative).read_bytes(), relative)
            self.assertNotIn(str(self.root).encode(), (first / relative).read_bytes())
        change_set = json.loads((first / "artifacts" / "catalog-change-set.json").read_text(encoding="utf-8"))
        self.assertTrue(change_set["execution"]["externalWritesBlocked"])
        self.assertEqual(change_set["execution"]["publicationAuthority"], "none")
        self.assertFalse(any(path.name.endswith("import.csv") for path in first.rglob("*")))
        with self.assertRaisesRegex(ReconciliationError, "overwrite"):
            reconcile_woo(self.workspace(), run_id="same-run")

    def test_generated_run_evidence_and_change_set_pass_the_v1_semantic_validator(self) -> None:
        _, run = self.reconcile()
        semantic = self.root / "semantic"
        semantic.mkdir()
        evidence_paths = []
        for index, line in enumerate((run / "artifacts" / "catalog-field-evidence.jsonl").read_text(encoding="utf-8").splitlines()):
            path = semantic / f"evidence-{index}.json"
            path.write_text(json.dumps(json.loads(line), ensure_ascii=False) + "\n", encoding="utf-8")
            evidence_paths.extend(["--evidence", str(path)])
        validator = PACKAGE_ROOT / "skills" / "enki-catalog-qa" / "scripts" / "validate_catalog_contracts.mjs"
        result = subprocess.run(
            [
                "node", str(validator),
                "--run", str(run / "catalog-run.json"),
                *evidence_paths,
                "--change-set", str(run / "artifacts" / "catalog-change-set.json"),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertEqual(json.loads(result.stdout), {"valid": True, "errors": []})

    def test_post_import_simulation_accepts_only_the_three_expected_cells(self) -> None:
        _, run = self.reconcile()
        self.prepare_audit_input(run)
        result = audit_woo(self.audit_workspace(), audit_id="expected-audit")
        self.assertEqual(result["valid"], True)
        self.assertEqual(result["expectedChanges"], 3)
        self.assertEqual(result["verifiedChanges"], 3)
        self.assertEqual(result["unexpectedChanges"], 0)
        self.assertEqual(result["identityDrift"], 0)
        audit = json.loads((self.output_root / "expected-audit" / "audit-report.json").read_text(encoding="utf-8"))
        self.assertTrue(audit["passed"])
        self.assertEqual(audit["mode"], "sanitized_simulation")
        self.assertEqual(audit["unexpectedChanges"], [])
        self.assertFalse(audit["authority"]["containsRawOutOfScopeValues"])

        change_set_path = self.input_root / "change-set.json"
        change_set = json.loads(change_set_path.read_text(encoding="utf-8"))
        change_set["changes"][1]["target"]["surface"] = "sku"
        change_set_path.write_text(json.dumps(change_set), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "outside the exact profile"):
            audit_woo(self.audit_workspace(), audit_id="tampered-target-audit")

    def test_post_import_simulation_detects_parent_and_out_of_scope_drift_without_raw_values(self) -> None:
        _, run = self.reconcile()
        self.prepare_audit_input(run)
        result = audit_woo(self.audit_workspace(after="woo-after-drift.csv"), audit_id="drift-audit")
        self.assertFalse(result["valid"])
        self.assertEqual(result["verifiedChanges"], 3)
        self.assertGreaterEqual(result["unexpectedChanges"], 2)
        self.assertGreaterEqual(result["identityDrift"], 1)
        raw = (self.output_root / "drift-audit" / "audit-report.json").read_text(encoding="utf-8")
        audit = json.loads(raw)
        self.assertIn("after_orphan_variation", audit["blockers"])
        self.assertTrue(any(item["kind"] == "parent_relation_changed" for item in audit["identityDrift"]))
        self.assertNotIn("OUTSIDE-1", raw)
        self.assertNotIn("BUA-DEMO-CR", raw)
        self.assertNotIn("Outside SEO", raw)

    def test_reconciling_the_expected_post_export_is_idempotent(self) -> None:
        profile_path = self.input_root / "profile.json"
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        after_path = self.input_root / "woo-after-expected.csv"
        import hashlib

        profile["sources"][2]["sha256"] = hashlib.sha256(after_path.read_bytes()).hexdigest()
        profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        workspace = validate_data_workspace(
            self.input_root,
            self.output_root,
            {
                "profile": ("profile.json", {".json"}),
                "candidates": ("candidates.jsonl", {".jsonl"}),
                "woo": ("woo-after-expected.csv", {".csv"}),
            },
        )
        result = reconcile_woo(workspace, run_id="idempotent-run")
        self.assertEqual(result["matches"], 5)
        self.assertEqual(result["changes"], 0)
        change_set = json.loads((self.output_root / "idempotent-run" / "artifacts" / "catalog-change-set.json").read_text(encoding="utf-8"))
        self.assertEqual(change_set["changes"], [])
        self.assertEqual(change_set["summary"]["total"], 0)

    def test_header_binding_sha_duplicate_sku_or_orphan_variation_fail_closed(self) -> None:
        profile_path = self.input_root / "profile.json"
        original_profile = json.loads(profile_path.read_text(encoding="utf-8"))

        profile = copy.deepcopy(original_profile)
        profile["scope"]["targets"][0]["wooColumn"]["columnIndex"] = 7
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "exact Woo header"):
            reconcile_woo(self.workspace(), run_id="bad-header")

        profile = copy.deepcopy(original_profile)
        profile["sources"][2]["sha256"] = "0" * 64
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "SHA-256"):
            reconcile_woo(self.workspace(), run_id="bad-sha")

        profile_path.write_text(json.dumps(original_profile), encoding="utf-8")
        with (self.input_root / "woo-before.csv").open(encoding="utf-8", newline="") as handle:
            rows = list(csv.reader(handle))
        rows[3][3] = rows[2][3]
        with (self.input_root / "duplicate.csv").open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle, lineterminator="\n").writerows(rows)
        profile = copy.deepcopy(original_profile)
        import hashlib

        profile["sources"][2]["sha256"] = hashlib.sha256((self.input_root / "duplicate.csv").read_bytes()).hexdigest()
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        workspace = validate_data_workspace(
            self.input_root,
            self.output_root,
            {"profile": ("profile.json", {".json"}), "candidates": ("candidates.jsonl", {".jsonl"}), "woo": ("duplicate.csv", {".csv"})},
        )
        with self.assertRaisesRegex(ReconciliationError, "duplicate_sku"):
            reconcile_woo(workspace, run_id="duplicate-sku")

        rows[3][3] = "OUTSIDE-1"
        rows[2][2] = "999"
        with (self.input_root / "orphan.csv").open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle, lineterminator="\n").writerows(rows)
        profile["sources"][2]["sha256"] = hashlib.sha256((self.input_root / "orphan.csv").read_bytes()).hexdigest()
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        workspace = validate_data_workspace(
            self.input_root,
            self.output_root,
            {"profile": ("profile.json", {".json"}), "candidates": ("candidates.jsonl", {".jsonl"}), "woo": ("orphan.csv", {".csv"})},
        )
        with self.assertRaisesRegex(ReconciliationError, "orphan_variation"):
            reconcile_woo(workspace, run_id="orphan")

        with (FIXTURE_ROOT / "woo-before.csv").open(encoding="utf-8", newline="") as handle:
            invalid_parent_rows = list(csv.reader(handle))
        invalid_parent_rows[2][2] = "not-a-parent"
        invalid_parent = self.input_root / "invalid-parent.csv"
        with invalid_parent.open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle, lineterminator="\n").writerows(invalid_parent_rows)
        profile = copy.deepcopy(original_profile)
        profile["sources"][2]["sha256"] = hashlib.sha256(invalid_parent.read_bytes()).hexdigest()
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        workspace = validate_data_workspace(
            self.input_root,
            self.output_root,
            {"profile": ("profile.json", {".json"}), "candidates": ("candidates.jsonl", {".jsonl"}), "woo": ("invalid-parent.csv", {".csv"})},
        )
        with self.assertRaisesRegex(ReconciliationError, "invalid_parent_product_id"):
            reconcile_woo(workspace, run_id="invalid-parent")

    def test_variation_page_fields_and_unaligned_price_candidates_are_denied(self) -> None:
        profile_path = self.input_root / "profile.json"
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        profile["scope"]["targets"][1]["entityKey"] = "buades-demo-variation-cromo"
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "product-page"):
            reconcile_woo(self.workspace(), run_id="variation-page")

        shutil.copy2(FIXTURE_ROOT / "profile.json", profile_path)
        candidates = [json.loads(line) for line in (self.input_root / "candidates.jsonl").read_text(encoding="utf-8").splitlines()]
        candidates[0]["field"]["transformations"] = candidates[0]["field"]["transformations"][:1]
        (self.input_root / "candidates.jsonl").write_text(
            "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in candidates), encoding="utf-8"
        )
        with self.assertRaisesRegex(ReconciliationError, "fiscal-basis"):
            reconcile_woo(self.workspace(), run_id="unaligned-price")

        shutil.copy2(FIXTURE_ROOT / "candidates.jsonl", self.input_root / "candidates.jsonl")
        profile = json.loads((FIXTURE_ROOT / "profile.json").read_text(encoding="utf-8"))
        profile["audit"]["ignoredColumns"] = [{
            "columnIndex": 13,
            "columnIndexBase": 0,
            "originalHeader": "Stock",
            "deduplicatedHeader": "Stock",
        }]
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "compare every"):
            reconcile_woo(self.workspace(), run_id="ignored-stock")

        profile = json.loads((FIXTURE_ROOT / "profile.json").read_text(encoding="utf-8"))
        profile["scope"]["targets"][1]["wooColumn"] = profile["scope"]["targets"][2]["wooColumn"]
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "same entity cell"):
            reconcile_woo(self.workspace(), run_id="duplicate-cell")

    def test_operational_audit_refuses_a_pending_change_set(self) -> None:
        _, run = self.reconcile()
        self.prepare_audit_input(run)
        profile = json.loads((self.input_root / "profile.json").read_text(encoding="utf-8"))
        profile["provenance"]["kind"] = "operational"
        (self.input_root / "profile.json").write_text(json.dumps(profile), encoding="utf-8")
        with self.assertRaisesRegex(ReconciliationError, "Board-approved"):
            audit_woo(self.audit_workspace(), audit_id="operational-pending")

    def test_bounded_historical_layout_replay_is_ephemeral_and_sanitized(self) -> None:
        source = self.root / "historical-layout.csv"
        rows = [
            [
                "ID", "Title", "Parent Product ID", "Sku", "Regular Price",
                "Attribute Value (pa_acabado)", "Product Type", "Title", "Featured", "Featured",
            ],
            ["100", "Historical parent", "0", "HIST-PARENT", "", "", "variable", "Attachment", "one.webp", "two.webp"],
            ["101", "", "100", "HIST-VARIATION", "120.00", "Cromo", "variable", "", "", ""],
            ["200", "Outside", "0", "HIST-OUTSIDE", "55.00", "Negro", "simple", "", "", ""],
        ]
        with source.open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle, lineterminator="\n").writerows(rows)
        replay_script = PACKAGE_ROOT / "scripts" / "catalog-pipeline" / "scripts" / "bounded_historical_layout_replay.py"
        result = subprocess.run(
            [sys.executable, str(replay_script), "--woo-export", str(source), "--fixture-root", str(FIXTURE_ROOT)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        receipt = json.loads(result.stdout)
        self.assertTrue(receipt["valid"])
        self.assertEqual(receipt["sourceSnapshot"]["rows"], 3)
        self.assertEqual(receipt["sourceSnapshot"]["columns"], 10)
        self.assertEqual(receipt["sanitizedReplay"]["candidateFields"], 4)
        self.assertEqual(receipt["sanitizedReplay"]["changes"], 2)
        self.assertFalse(receipt["authority"]["sourceValuesRetained"])
        self.assertFalse(receipt["authority"]["artifactsPersisted"])
        self.assertFalse(receipt["authority"]["isCurrentCommercialTruth"])
        self.assertFalse(receipt["authority"]["canGenerateWooImport"])

        missing = self.root / "private-host-layout.csv"
        failed = subprocess.run(
            [sys.executable, str(replay_script), "--woo-export", str(missing), "--fixture-root", str(FIXTURE_ROOT)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(failed.returncode, 1)
        self.assertEqual(json.loads(failed.stdout), {"valid": False, "error": "bounded historical layout replay failed closed"})
        self.assertNotIn(str(self.root), failed.stdout + failed.stderr)

    def test_cli_emits_only_portable_summary_and_returns_nonzero_for_drift(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = main(
                [
                    "woo-reconcile",
                    "--input-root", str(self.input_root),
                    "--output-root", str(self.output_root),
                    "--profile", "profile.json",
                    "--candidates", "candidates.jsonl",
                    "--woo", "woo-before.csv",
                    "--run-id", "cli-run",
                ]
            )
        self.assertEqual(exit_code, 0, stderr.getvalue())
        self.assertNotIn(str(self.root), stdout.getvalue())
        run = self.output_root / "cli-run"
        self.prepare_audit_input(run)

        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = main(
                [
                    "woo-audit",
                    "--input-root", str(self.input_root),
                    "--output-root", str(self.output_root),
                    "--profile", "profile.json",
                    "--change-set", "change-set.json",
                    "--before-woo", "woo-before.csv",
                    "--after-woo", "woo-after-drift.csv",
                    "--audit-id", "cli-drift-audit",
                ]
            )
        self.assertEqual(exit_code, 1, stderr.getvalue())
        self.assertFalse(json.loads(stdout.getvalue())["valid"])


if __name__ == "__main__":
    unittest.main()
