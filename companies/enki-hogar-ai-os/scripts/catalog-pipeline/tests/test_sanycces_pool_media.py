from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.sanycces_pool_media import (  # noqa: E402
    COLLECTION_LINK_HTML,
    GOOGLE_SHOPPING_DESCRIPTION_MAX,
    INSPIRATION_SOURCE_URLS,
    POOL_MEDIA_SPECS,
    PRODUCT_COPY,
    PRODUCT_SEO_OVERRIDES,
    RM_SOURCE_URLS,
    _official_url,
    _save_webp,
    _value_bullet,
)


PROFILE = {
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


class SanyccesPoolMediaTest(unittest.TestCase):
    def test_official_media_url_allowlist_rejects_lookalikes(self) -> None:
        self.assertTrue(_official_url("https://sanycces.es/wp-content/uploads/product.png"))
        self.assertTrue(_official_url("https://www.sanycces.es/product.png"))
        self.assertFalse(_official_url("http://sanycces.es/product.png"))
        self.assertFalse(_official_url("https://sanycces.es.example.com/product.png"))
        self.assertFalse(_official_url("https://sanycces.es@evil.example/product.png"))

    def test_reviewed_mapping_covers_exact_pool_scope(self) -> None:
        self.assertEqual(len(POOL_MEDIA_SPECS), 24)
        self.assertEqual(len({item.sku for item in POOL_MEDIA_SPECS}), 24)
        self.assertEqual(sum(item.variable for item in POOL_MEDIA_SPECS), 20)
        self.assertEqual(sum(not item.variable for item in POOL_MEDIA_SPECS), 4)
        self.assertEqual(len({item.asset_key for item in POOL_MEDIA_SPECS if item.variable}), 18)
        self.assertEqual(len({item.dimension_key for item in POOL_MEDIA_SPECS}), 22)
        self.assertEqual(set(RM_SOURCE_URLS), {item.asset_key for item in POOL_MEDIA_SPECS if item.variable})
        self.assertEqual(set(INSPIRATION_SOURCE_URLS), {item.asset_key for item in POOL_MEDIA_SPECS if item.variable})
        self.assertTrue(all(item.finish_crop_y is not None for item in POOL_MEDIA_SPECS if item.variable))

    def test_reviewed_copy_covers_every_parent_and_stays_within_search_limits(self) -> None:
        self.assertEqual(set(PRODUCT_COPY), {item.sku for item in POOL_MEDIA_SPECS})
        for name, short_description in PRODUCT_COPY.values():
            self.assertLessEqual(len(name), 70)
            self.assertGreaterEqual(len(short_description), 80)
            self.assertLessEqual(len(short_description), GOOGLE_SHOPPING_DESCRIPTION_MAX)

    def test_search_overrides_replace_internal_codes_with_buyer_language(self) -> None:
        self.assertEqual(set(PRODUCT_SEO_OVERRIDES), {
            "MEN000SS", "MH2000SS", "MH2D006SS", "MH2D066SS",
            "RAC00012SS", "TH2000SS", "TH2D006SS", "TH2D066SS",
        })
        self.assertIn("ducha-de-mano", PRODUCT_SEO_OVERRIDES["MH2D006SS"]["slug"])
        self.assertIn("barra-integrada", PRODUCT_SEO_OVERRIDES["MH2D066SS"]["slug"])
        self.assertNotIn("006", PRODUCT_SEO_OVERRIDES["TH2D006SS"]["focusKeyword"])
        self.assertNotIn("066", PRODUCT_SEO_OVERRIDES["TH2D066SS"]["focusKeyword"])
        for sku in ("MEN000SS", "MH2000SS", "RAC00012SS", "TH2000SS"):
            self.assertNotIn("Consulta acabados", PRODUCT_SEO_OVERRIDES[sku]["description"])
            self.assertNotIn("316L", PRODUCT_SEO_OVERRIDES[sku]["description"])

    def test_sanybox_titles_make_inox_distinction_visible(self) -> None:
        for sku in ("MEN000SS", "MH2000SS", "RAC00012SS", "TH2000SS"):
            self.assertIn("Sanybox Inox", PRODUCT_COPY[sku][0])

    def test_titles_use_natural_product_brand_series_structure(self) -> None:
        for name, _description in PRODUCT_COPY.values():
            self.assertEqual(name.count(" – "), 2)
            self.assertTrue(name.endswith(" – Sanycces – Pool"))
        self.assertEqual(
            PRODUCT_COPY["MNO006SS"][0],
            "Grifo Monomando de Lavabo – Sanycces – Pool",
        )

    def test_series_search_link_is_a_standalone_paragraph(self) -> None:
        self.assertTrue(COLLECTION_LINK_HTML.startswith("<p><a "))
        self.assertTrue(COLLECTION_LINK_HTML.endswith("</a></p>"))
        self.assertNotIn("compatibles.", COLLECTION_LINK_HTML)

    def test_customer_value_bullets_are_idempotent(self) -> None:
        bullets = (
            "Acero inoxidable 316L",
            "Apertura en frío",
            "Caudal de 18,8 l/min a 3 bar",
            "Caudal de 4,7 l/min a 3 bar",
            "Limitador de caudal de 9 l/min",
            "Altura regulable",
            "Tetinas antical",
            "Parte externa; requiere Sanybox MH2000SS",
        )
        for bullet in bullets:
            once = _value_bullet(bullet)
            self.assertEqual(_value_bullet(once), once)

    def test_only_reviewed_wall_variants_share_media(self) -> None:
        groups: dict[str, list[str]] = {}
        for item in POOL_MEDIA_SPECS:
            groups.setdefault(item.dimension_key, []).append(item.sku)
        shared = {key: sorted(value) for key, value in groups.items() if len(value) > 1}
        self.assertEqual(shared, {
            "pool-men-r": ["MEN006R14SS", "MEN006R18SS"],
            "pool-men-s": ["MEN006S14SS", "MEN006S18SS"],
        })

    def test_dimension_webp_is_deterministic_square_and_metadata_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Image.new("RGB", (2400, 900), "white")
            first = root / "first.webp"
            second = root / "second.webp"
            try:
                first_result = _save_webp(source, first, PROFILE)
                second_result = _save_webp(source, second, PROFILE)
            finally:
                source.close()
            self.assertEqual(first_result["sha256"], second_result["sha256"])
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with Image.open(first) as prepared:
                self.assertEqual(prepared.size, (1000, 1000))
                self.assertEqual(dict(prepared.getexif()), {})
                self.assertNotIn("icc_profile", prepared.info)
                self.assertNotIn("xmp", prepared.info)

    def test_special_mh2d066_rm_source_remains_explicit(self) -> None:
        self.assertEqual(
            RM_SOURCE_URLS["pool-mh2d066"],
            "https://sanycces.es/wp-content/uploads/2026/04/POOL-FOTOS-WEB11.png",
        )


if __name__ == "__main__":
    unittest.main()
