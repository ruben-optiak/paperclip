from __future__ import annotations

import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.product_media import (  # noqa: E402
    ProductMediaError,
    load_primary_image_policy,
    prepare_product_media,
    render_primary_product_image_candidate,
)
from enki_catalog_pipeline.cli import main  # noqa: E402
from enki_catalog_pipeline.safety import validate_data_workspace  # noqa: E402


PROFILE = {
    "schema": "enki-product-media-profile/v1",
    "profileKey": "fixture-square",
    "version": "1.0.0",
    "source": {
        "allowedMimeTypes": ["image/jpeg", "image/png", "image/webp"],
        "minimumWidth": 800,
        "minimumHeight": 800,
        "rightsConfirmationRequired": True,
    },
    "output": {
        "format": "webp",
        "width": 1000,
        "height": 1000,
        "fit": "contain",
        "background": "#FFFFFF",
        "quality": 82,
        "method": 6,
        "allowUpscale": False,
        "stripMetadata": True,
    },
}

PRIMARY_IMAGE_POLICY = {
    "schema": "enki-primary-product-image-policy/v1",
    "policyKey": "fixture-primary-image",
    "version": "1.0.0",
    "output": {
        "format": "webp",
        "width": 1000,
        "height": 1000,
        "background": "#FFFFFF",
        "quality": 92,
        "method": 6,
        "stripMetadata": True,
    },
    "contentDetection": {
        "whiteThreshold": 10,
        "paddingRatio": 0.06,
        "targetContentFill": 0.78,
    },
    "sourceClasses": {
        "official": {"maxUpscale": 2.0},
        "pdf-derived": {"maxUpscale": 1.75},
    },
}


class ProductMediaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.input_root = self.root / "input"
        self.output_root = self.root / "output"
        self.input_root.mkdir()
        self.output_root.mkdir()
        self.profile = self.input_root / "profile.json"
        self.profile.write_text(json.dumps(PROFILE), encoding="utf-8")
        self.source = self.input_root / "source.jpg"
        image = Image.new("RGB", (900, 800), (20, 80, 160))
        exif = Image.Exif()
        exif[0x010E] = "metadata must disappear"
        image.save(self.source, format="JPEG", quality=95, exif=exif)
        image.close()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def workspace(self, output_root: Path | None = None):
        return validate_data_workspace(
            self.input_root,
            output_root or self.output_root,
            {"source": ("source.jpg", {".jpg"}), "profile": ("profile.json", {".json"})},
        )

    def prepare(self, output_root: Path, run_id: str = "media-run"):
        return prepare_product_media(
            self.workspace(output_root),
            run_id=run_id,
            asset_key="fixture-product-01",
            alt_text="Vista principal del producto fixture",
            source_url="https://manufacturer.example.invalid/media/source.jpg",
            rights_confirmed=True,
        )

    def test_prepares_square_webp_without_upscaling_and_strips_metadata(self) -> None:
        result = self.prepare(self.output_root)
        target = self.output_root / "media-run" / result["output"]["path"]
        self.assertEqual(result["schema"], "enki-product-media-result/v1")
        self.assertEqual(result["runtimeVersion"], "0.5.0")
        self.assertEqual(result["output"]["width"], 1000)
        self.assertEqual(result["output"]["height"], 1000)
        self.assertEqual(result["output"]["contentWidth"], 900)
        self.assertEqual(result["output"]["contentHeight"], 800)
        self.assertFalse(result["output"]["upscaled"])
        with Image.open(target) as prepared:
            self.assertEqual(prepared.format, "WEBP")
            self.assertEqual(prepared.size, (1000, 1000))
            self.assertEqual(dict(prepared.getexif()), {})
            self.assertEqual(prepared.getpixel((0, 0))[:3], (255, 255, 255))

    def test_same_source_and_profile_produce_identical_webp(self) -> None:
        other_output = self.root / "other-output"
        other_output.mkdir()
        first = self.prepare(self.output_root, "first")
        second = self.prepare(other_output, "second")
        self.assertEqual(first["output"]["sha256"], second["output"]["sha256"])
        self.assertEqual(
            (self.output_root / "first" / first["output"]["path"]).read_bytes(),
            (other_output / "second" / second["output"]["path"]).read_bytes(),
        )

    def test_requires_rights_and_never_leaves_partial_output(self) -> None:
        with self.assertRaisesRegex(ProductMediaError, "rights"):
            prepare_product_media(
                self.workspace(),
                run_id="rejected",
                asset_key="fixture-product-01",
                alt_text="Vista principal",
                source_url="https://manufacturer.example.invalid/media/source.jpg",
                rights_confirmed=False,
            )
        self.assertFalse((self.output_root / "rejected").exists())

    def test_rejects_source_below_approved_minimum(self) -> None:
        image = Image.new("RGB", (799, 800), (255, 255, 255))
        image.save(self.source, format="JPEG")
        image.close()
        with self.assertRaisesRegex(ProductMediaError, "smaller"):
            self.prepare(self.output_root, "too-small")
        self.assertFalse((self.output_root / "too-small").exists())

    def test_cli_prepares_media_with_explicit_rights_confirmation(self) -> None:
        output = StringIO()
        with redirect_stdout(output):
            status = main([
                "prepare-product-media",
                "--input-root", str(self.input_root),
                "--output-root", str(self.output_root),
                "--source", "source.jpg",
                "--profile", "profile.json",
                "--run-id", "cli-media",
                "--asset-key", "fixture-product-01",
                "--alt", "Vista principal del producto fixture",
                "--source-url", "https://manufacturer.example.invalid/media/source.jpg",
                "--rights-confirmed",
            ])
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output.getvalue())["schema"], "enki-product-media-result/v1")

    def test_primary_image_policy_reframes_white_space_without_geometry_drift(self) -> None:
        policy_path = self.input_root / "primary-policy.json"
        policy_path.write_text(json.dumps(PRIMARY_IMAGE_POLICY), encoding="utf-8")
        policy = load_primary_image_policy(policy_path)
        source = self.input_root / "cutout.png"
        image = Image.new("RGB", (1200, 900), "white")
        image.paste((80, 80, 80), (518, 192, 682, 708))
        image.save(source, format="PNG")
        image.close()
        target = self.output_root / "cutout.webp"

        result = render_primary_product_image_candidate(
            source,
            target,
            policy,
            source_class="official",
        )

        self.assertEqual(result["sourceContentBox"], [518, 192, 682, 708])
        self.assertAlmostEqual(result["targetContentFill"], 0.78, places=2)
        self.assertFalse(result["upscaleCapped"])
        source_ratio = 164 / 516
        output_box = result["outputContentBox"]
        output_ratio = (output_box[2] - output_box[0]) / (output_box[3] - output_box[1])
        self.assertAlmostEqual(output_ratio, source_ratio, places=2)
        with Image.open(target) as rendered:
            self.assertEqual(rendered.size, (1000, 1000))
            self.assertEqual(rendered.format, "WEBP")
            self.assertEqual(dict(rendered.getexif()), {})
            self.assertEqual(rendered.getpixel((0, 0))[:3], (255, 255, 255))

    def test_primary_image_policy_caps_small_pdf_derived_sources(self) -> None:
        source = self.input_root / "small-cutout.png"
        image = Image.new("RGB", (1000, 1000), "white")
        image.paste((60, 60, 60), (450, 450, 550, 550))
        image.save(source, format="PNG")
        image.close()
        target = self.output_root / "small-cutout.webp"

        result = render_primary_product_image_candidate(
            source,
            target,
            PRIMARY_IMAGE_POLICY,
            source_class="pdf-derived",
        )

        self.assertTrue(result["upscaleCapped"])
        self.assertEqual(result["appliedScale"], 1.75)
        self.assertGreaterEqual(result["targetContentFill"], 0.17)
        self.assertLess(result["targetContentFill"], 0.19)


if __name__ == "__main__":
    unittest.main()
