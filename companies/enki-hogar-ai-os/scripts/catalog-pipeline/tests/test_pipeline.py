from __future__ import annotations

import csv
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.cli import main  # noqa: E402
from enki_catalog_pipeline.pipeline import PipelineError, prepare_catalog  # noqa: E402
from enki_catalog_pipeline.safety import SafetyError, validate_workspace  # noqa: E402


def create_pdf(path: Path) -> None:
    streams = (
        b"BT /F1 10 Tf 8 120 Td (REF ABC123) Tj 0 -24 Td (Technical product details) Tj ET",
        b"BT /F1 10 Tf 8 48 Td (REF XYZ789) Tj ET",
    )
    objects = (
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(streams[0])).encode("ascii") + b" >>\nstream\n" + streams[0] + b"\nendstream",
        b"<< /Length " + str(len(streams[1])).encode("ascii") + b" >>\nstream\n" + streams[1] + b"\nendstream",
    )
    contents = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_number, body in enumerate(objects, start=1):
        offsets.append(len(contents))
        contents.extend(f"{object_number} 0 obj\n".encode("ascii"))
        contents.extend(body)
        contents.extend(b"\nendobj\n")
    xref_offset = len(contents)
    contents.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    contents.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        contents.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    contents.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    path.write_bytes(contents)


class CatalogPipelineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.input_root = self.root / "input"
        self.output_root = self.root / "output"
        self.input_root.mkdir()
        self.output_root.mkdir()
        self.pdf = self.input_root / "catalog.pdf"
        create_pdf(self.pdf)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def workspace(self, output_root: Path | None = None):
        return validate_workspace(self.input_root, output_root or self.output_root, "catalog.pdf")

    def test_prepare_creates_portable_page_and_block_inventory(self) -> None:
        metadata = prepare_catalog(
            self.workspace(),
            source_slug="fixture-brand",
            category="mirrors",
            run_id="fixture-2026-09-01",
        )
        run = self.output_root / "fixture-2026-09-01"
        self.assertEqual(metadata["counts"]["pages"], 2)
        self.assertEqual(metadata["rendering"], {"backend": "pdfium", "dpi": 300})
        self.assertEqual(metadata["extraction"], {"backend": "pdfplumber", "granularity": "word"})
        self.assertEqual(metadata, json.loads((run / "runtime_metadata.json").read_text(encoding="utf-8")))

        with (run / "pages_manifest.csv").open(encoding="utf-8", newline="") as handle:
            pages = list(csv.DictReader(handle))
        self.assertEqual([row["image_path"] for row in pages], ["pages/page-0001.png", "pages/page-0002.png"])
        self.assertEqual({row["source_path"] for row in pages}, {"catalog.pdf"})
        self.assertTrue(all(len(row["source_sha256"]) == 64 for row in pages))

        with Image.open(run / pages[0]["image_path"]) as first_image:
            self.assertEqual(first_image.size, (300, 600))
        with (run / "block_inventory.csv").open(encoding="utf-8", newline="") as handle:
            blocks = list(csv.DictReader(handle))
        self.assertGreaterEqual(len(blocks), 2)
        self.assertTrue(all(float(row["x1"]) >= float(row["x0"]) for row in blocks))

        absolute_root = str(self.root)
        for artifact in (run / "pages_manifest.csv", run / "page_inventory.csv", run / "block_inventory.csv", run / "runtime_metadata.json"):
            self.assertNotIn(absolute_root, artifact.read_text(encoding="utf-8"))

    def test_same_source_produces_byte_identical_artifacts(self) -> None:
        other_output = self.root / "other-output"
        other_output.mkdir()
        for output in (self.output_root, other_output):
            prepare_catalog(
                self.workspace(output),
                source_slug="fixture-brand",
                category="mirrors",
                run_id="deterministic-run",
            )
        first = self.output_root / "deterministic-run"
        second = other_output / "deterministic-run"
        for relative in (
            "pages_manifest.csv",
            "page_inventory.csv",
            "block_inventory.csv",
            "runtime_metadata.json",
            "pages/page-0001.png",
            "pages/page-0002.png",
        ):
            self.assertEqual((first / relative).read_bytes(), (second / relative).read_bytes(), relative)

    def test_existing_run_is_never_overwritten(self) -> None:
        prepare_catalog(self.workspace(), source_slug="fixture-brand", category="", run_id="immutable-run")
        marker = self.output_root / "immutable-run" / "marker.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaises(PipelineError):
            prepare_catalog(self.workspace(), source_slug="fixture-brand", category="", run_id="immutable-run")
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_git_worktree_roots_are_rejected(self) -> None:
        git_root = self.root / "versioned"
        git_root.mkdir()
        (git_root / ".git").mkdir()
        output = git_root / "results"
        output.mkdir()
        with self.assertRaisesRegex(SafetyError, "outside a Git worktree"):
            validate_workspace(self.input_root, output, "catalog.pdf")

    def test_nested_git_metadata_is_rejected(self) -> None:
        nested = self.input_root / "copied-repository"
        nested.mkdir()
        (nested / ".git").mkdir()
        with self.assertRaisesRegex(SafetyError, "nested Git metadata"):
            self.workspace()

    def test_credential_like_files_and_symlinks_are_rejected(self) -> None:
        credential = self.input_root / "auth_catalog.json"
        credential.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(SafetyError, "credential-like"):
            self.workspace()
        credential.unlink()

        link = self.input_root / "linked.pdf"
        try:
            link.symlink_to(self.pdf)
        except OSError:
            self.skipTest("symlinks are unavailable")
        with self.assertRaisesRegex(SafetyError, "symlinks"):
            self.workspace()

    def test_source_path_must_stay_below_input_root(self) -> None:
        with self.assertRaisesRegex(SafetyError, "stay below"):
            validate_workspace(self.input_root, self.output_root, "../catalog.pdf")

    def test_preflight_cli_prints_no_host_paths_and_writes_nothing(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = main(
                [
                    "preflight",
                    "--input-root",
                    str(self.input_root),
                    "--output-root",
                    str(self.output_root),
                    "--pdf",
                    "catalog.pdf",
                ]
            )
        self.assertEqual(exit_code, 0, stderr.getvalue())
        result = json.loads(stdout.getvalue())
        self.assertTrue(result["safe"])
        self.assertEqual(result["source"]["path"], "catalog.pdf")
        self.assertNotIn(str(self.root), stdout.getvalue())
        self.assertEqual(list(self.output_root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
