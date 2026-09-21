from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.sanycces_pool_bundles import (  # noqa: E402
    SANYBOX_CATEGORY_PATH,
    _category_path,
    _category_ids_for_path,
    _category_paths,
    _finish_configuration,
    _price_policy_audit,
    _product_from_article,
)


def article(*, simple: bool) -> dict:
    reference = "MEN000SS" if simple else "MNO006SS"
    variants = [
        {
            "reference": "MEN000SS",
            "ean": "8435737779165",
            "expectedRegularGross21": "124.63",
            "officialPvpExVat": "103.00",
            "discountPercent": "15.00",
            "salePriceGross": "105.94",
        }
    ] if simple else [
        {
            "reference": "MNO006SSNB",
            "ean": "8435737779196",
            "expectedRegularGross21": "254.10",
            "officialPvpExVat": "210.00",
            "discountPercent": "15.00",
            "salePriceGross": "215.99",
        },
        {
            "reference": "MNO006SSRM",
            "ean": "8435737779202",
            "expectedRegularGross21": "310.97",
            "officialPvpExVat": "257.00",
            "discountPercent": "17.50",
            "salePriceGross": "264.32",
        },
    ]
    return {
        "identity": f"{reference}::",
        "baseReference": reference,
        "configurationTail": "",
        "groupKey": "group-key",
        "title": "Sanybox Inox Pool" if simple else "Monomando de lavabo Pool",
        "slug": "sanybox-inox-pool" if simple else "monomando-de-lavabo-pool",
        "recommendedCategory": "Grifos de baño > Grifos Lavabo",
        "productModelRecommendation": "simple" if simple else "variable_by_finish",
        "merchandisingDecision": "standalone_sellable_sanybox_product_approved" if simple else "sellable_product",
        "descriptionHtml": "<p>Descripción revisada.</p>",
        "shortDescriptionHtml": "<p>Resumen revisado.</p>",
        "seo": {
            "title": "Producto Pool de Sanycces | Enki",
            "metaDescription": "Descripción SEO revisada para el producto Pool de Sanycces.",
            "focusKeyword": "producto pool sanycces",
        },
        "pdfEvidence": {"sourceSha256": "a" * 64},
        "pricing": {
            "officialTariffSha256": "b" * 64,
            "discountPolicyKey": "sanycces-pvp-tier-2026-v1",
            "variants": variants,
        },
        "media": {
            "alt": "Producto Pool de Sanycces",
            "primary": {
                "assetKey": "pool-product",
                "outputPath": "media/pool-product.webp",
                "outputSha256": "c" * 64,
                "outputWidth": 1000,
                "outputHeight": 1000,
                "sourceSha256": "d" * 64,
                "sourceUrl": "https://sanycces.es/media/pool-product.png",
            },
        },
    }


class SanyccesPoolBundleTests(unittest.TestCase):
    def test_resolves_exact_category_paths_and_live_finish_attribute(self) -> None:
        categories = [
            {"id": 280, "name": "Grifos de baño", "parent": 0},
            {"id": 291, "name": "Grifos Lavabo", "parent": 280},
            {"id": 958, "name": "Fontanería", "parent": 0},
            {"id": 976, "name": "Sanybox", "parent": 958},
        ]
        self.assertEqual(
            _category_paths(categories),
            {
                "Grifos de baño": 280,
                "Grifos de baño > Grifos Lavabo": 291,
                "Fontanería": 958,
                "Fontanería > Sanybox": 976,
            },
        )
        self.assertEqual(
            _category_ids_for_path(
                _category_paths(categories),
                "Grifos de baño > Grifos Lavabo",
            ),
            [280, 291],
        )
        attribute_id, options = _finish_configuration(
            [{"id": 15, "name": "Acabado", "taxonomy": "pa_acabado"}],
            [
                {"name": "Níquel cepillado", "slug": "niquel-cepillado"},
                {"name": "Metal Raw", "slug": "metal-raw"},
            ],
        )
        self.assertEqual(attribute_id, 15)
        self.assertEqual(options, {"NB": "Níquel cepillado", "RM": "Metal Raw"})

    def test_sanybox_always_uses_the_dedicated_category(self) -> None:
        self.assertEqual(_category_path(article(simple=True)), SANYBOX_CATEGORY_PATH)

    def test_builds_a_variable_parent_with_private_priced_children(self) -> None:
        product = _product_from_article(
            article(simple=False),
            category_ids=[280, 291],
            finish_attribute_id=15,
            finish_options={"NB": "Níquel cepillado", "RM": "Metal Raw"},
            taxonomy_sha256="e" * 64,
            woo_sha256="f" * 64,
            discount_policy_sha256="1" * 64,
        )
        self.assertEqual(product["type"], "variable")
        self.assertEqual(product["sku"], "MNO006SS")
        self.assertEqual(product["categories"], [280, 291])
        self.assertEqual(product["attributes"][0]["id"], 15)
        self.assertEqual(product["attributes"][0]["options"], ["Níquel cepillado", "Metal Raw"])
        self.assertEqual([item["status"] for item in product["variations"]], ["private", "private"])
        self.assertEqual(product["variations"][0]["commerce"]["salePrice"], "215.99")
        self.assertFalse(product["variations"][0]["commerce"]["manageStock"])
        self.assertNotIn("stockQuantity", product["variations"][0]["commerce"])
        self.assertEqual(product["variations"][0]["commerce"]["stockStatus"], "instock")
        self.assertNotIn("regularPrice", product["commerce"])

    def test_builds_a_priced_simple_sanybox(self) -> None:
        product = _product_from_article(
            article(simple=True),
            category_ids=[958, 976],
            finish_attribute_id=15,
            finish_options={"NB": "Níquel cepillado", "RM": "Metal Raw"},
            taxonomy_sha256="e" * 64,
            woo_sha256="f" * 64,
            discount_policy_sha256="1" * 64,
        )
        self.assertEqual(product["type"], "simple")
        self.assertEqual(product["sku"], "MEN000SS")
        self.assertEqual(product["gtin"], "8435737779165")
        self.assertEqual(product["commerce"]["regularPrice"], "124.63")
        self.assertEqual(product["commerce"]["salePrice"], "105.94")
        self.assertFalse(product["commerce"]["manageStock"])
        self.assertNotIn("stockQuantity", product["commerce"])
        self.assertEqual(product["commerce"]["stockStatus"], "instock")
        self.assertEqual(product["attributes"], [])

    def test_builds_a_complete_price_policy_audit(self) -> None:
        audit = _price_policy_audit(
            [article(simple=False), article(simple=True)],
            discount_policy_sha256="1" * 64,
        )
        self.assertEqual(audit["schema"], "enki-product-price-policy-audit/v1")
        self.assertEqual(audit["policySha256"], "1" * 64)
        self.assertEqual(audit["officialTariffSha256"], "b" * 64)
        self.assertEqual(audit["summary"]["sellableSkus"], 3)


if __name__ == "__main__":
    unittest.main()
