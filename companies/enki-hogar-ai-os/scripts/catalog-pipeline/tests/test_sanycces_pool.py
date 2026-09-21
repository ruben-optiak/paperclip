from __future__ import annotations

import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.sanycces_pool import (  # noqa: E402
    GROUP_ASSET_KEYS,
    KIT_RELATED_ASSETS,
    OFFICIAL_ASSETS,
    OFFICIAL_WEB_ONLY_ACCESSORY_URLS,
    POOL_EXPECTED_COMPONENTS,
    POOL_EXPECTED_INVENTORY_GROUPS,
    POOL_EXPECTED_PRODUCT_CANDIDATES,
    POOL_TITLES,
    SANYCCES_DISCOUNT_POLICY_KEY,
    _discount_percent_for_pvp,
    _identity,
    _pool_article_record,
    _price_row,
    _published_tariff_audit_row,
    _sale_price_from_pvp,
    _seo,
    parse_official_pool_listing,
)


class SanyccesPoolTest(unittest.TestCase):
    def test_reviewed_pool_maps_cover_the_exact_expected_inventory(self) -> None:
        self.assertEqual(len(POOL_TITLES), POOL_EXPECTED_INVENTORY_GROUPS)
        self.assertEqual(len(OFFICIAL_ASSETS), 22)
        self.assertEqual(len(GROUP_ASSET_KEYS), 24)
        self.assertEqual(len(KIT_RELATED_ASSETS), 4)
        self.assertEqual(len(OFFICIAL_WEB_ONLY_ACCESSORY_URLS), 4)
        self.assertEqual(set(GROUP_ASSET_KEYS) | set(KIT_RELATED_ASSETS), set(POOL_TITLES))
        self.assertFalse(set(GROUP_ASSET_KEYS) & set(KIT_RELATED_ASSETS))
        component_keys = {
            _identity("MEN000SS"),
            _identity("MH2000SS"),
            _identity("RAC00012SS"),
            _identity("TH2000SS"),
        }
        self.assertEqual(len(component_keys), POOL_EXPECTED_COMPONENTS)
        self.assertEqual(len(POOL_TITLES) - len(component_keys), POOL_EXPECTED_PRODUCT_CANDIDATES)

    def test_parses_exact_official_listing_cardinality(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pool.html"
            cards = []
            for index in range(26):
                cards.append(
                    '<a href="https://sanycces.es/producto/pool-{0}/" '
                    'class="producto-item pool inox">'
                    '<div style="background-image: url(\'https://sanycces.es/media/{0}.png\')"></div>'
                    '<h3>Pool · Producto {0}</h3></a>'.format(index)
                )
            path.write_text("".join(cards), encoding="utf-8")
            rows = parse_official_pool_listing(path)
        self.assertEqual(len(rows), 26)
        self.assertEqual(rows[0]["title"], "Pool · Producto 0")
        self.assertEqual(rows[-1]["imageUrl"], "https://sanycces.es/media/25.png")

    def test_prefers_real_lazy_background_over_placeholder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pool.html"
            cards = []
            for index in range(26):
                cards.append(
                    '<a href="https://sanycces.es/producto/pool-{0}/" '
                    'class="producto-item pool inox">'
                    '<div style="--background-image: url(\'https://sanycces.es/media/{0}.png\'); '
                    '--background-image-placeholder: url(\'https://sanycces.es/media/placeholder.jpg\');"></div>'
                    '<h3>Pool · Producto {0}</h3></a>'.format(index)
                )
            path.write_text("".join(cards), encoding="utf-8")
            rows = parse_official_pool_listing(path)
        self.assertEqual(rows[0]["imageUrl"], "https://sanycces.es/media/0.png")
        self.assertNotIn("placeholder", rows[0]["imageUrl"])

    def test_compares_live_variable_prices_against_child_rows(self) -> None:
        store = {
            "type": "variable",
            "prices": {
                "price": "14296",
                "regular_price": "16819",
                "sale_price": "14296",
                "currency_minor_unit": 2,
            },
            "variations": [{"id": 101}, {"id": 102}],
        }
        parent = {
            "id": "100",
            "title": "Monomando Loop",
            "sku": "MNO001",
            "permalink": "https://www.enkihogar.com/example/",
            "productType": "variable",
        }
        children = [
            {"id": "101", "price": "142.96", "regularPrice": "168.19", "salePrice": "142.96"},
            {"id": "102", "price": "171.76", "regularPrice": "202.07", "salePrice": "171.76"},
        ]
        row = _price_row(store, parent, children)
        self.assertEqual(row["auditStatus"], "exact_live_export_match")
        self.assertEqual(row["derivedRegularPvpExVat21"], "139.00")
        self.assertEqual(row["discountPercent"], "15.00")
        self.assertTrue(row["derivedNetIsExactToCent"])

    def test_pool_article_is_prepared_but_never_authorized_for_publication(self) -> None:
        group = {
            "groupKey": "group-key",
            "baseReference": "MNO006SS",
            "configurationTail": "",
            "entityRole": "sellable_candidate",
            "printedPages": [127],
            "nearbyTitles": ["Monomando de lavabo / Basin mixer"],
            "references": {
                "existing": [],
                "not_in_export": ["MNO006SSNB", "MNO006SSRM"],
                "needs_review": [],
                "excluded_context": [],
            },
        }
        media = {
            "pool-mno": {
                "officialProductUrl": "https://sanycces.es/producto/pool_monomando_lavabo/",
                "outputPath": "media/pool-mno.webp",
                "outputSha256": "a" * 64,
            }
        }
        article = _pool_article_record(
            group,
            media,
            "b" * 64,
            {
                "MNO006SSNB": {
                    "sourceRow": 100,
                    "pvpExVat": Decimal("210"),
                    "ean": "8435315500001",
                    "eanStatus": "valid_or_blank",
                },
                "MNO006SSRM": {
                    "sourceRow": 101,
                    "pvpExVat": Decimal("257"),
                    "ean": "8435315500002",
                    "eanStatus": "valid_or_blank",
                },
            },
            "c" * 64,
        )
        self.assertEqual(article["publication"]["contentStatus"], "prepared_for_review")
        self.assertFalse(article["publication"]["publishAuthorized"])
        self.assertEqual(article["pricing"]["variants"][0]["officialPvpExVat"], "210.00")
        self.assertEqual(article["pricing"]["variants"][0]["expectedRegularGross21"], "254.10")
        self.assertEqual(article["pricing"]["variants"][0]["discountPercent"], "15.00")
        self.assertEqual(article["pricing"]["variants"][0]["salePriceGross"], "215.99")
        self.assertEqual(
            article["pricing"]["status"],
            "official_tariff_and_discount_policy_complete",
        )
        self.assertEqual(article["pricing"]["discountPolicyKey"], SANYCCES_DISCOUNT_POLICY_KEY)
        self.assertNotIn("commercial_discount_policy_required", article["publication"]["blockers"])
        self.assertNotIn("variable_product_bundle_not_supported_by_v1", article["publication"]["blockers"])
        self.assertLessEqual(len(article["seo"]["title"]), 70)
        self.assertLessEqual(len(article["seo"]["metaDescription"]), 155)
        self.assertEqual(article["media"]["status"], "dedicated_official_webp_prepared")
        self.assertNotIn("catálogo PDF", article["descriptionHtml"])
        self.assertNotIn("web oficial", article["descriptionHtml"])
        self.assertNotIn("trazabilidad", article["descriptionHtml"])

    def test_pool_seo_is_unique_complete_and_never_cut_with_ellipsis(self) -> None:
        rows = [_seo(title) for title in POOL_TITLES.values()]
        self.assertEqual(len({row["title"] for row in rows}), len(rows))
        self.assertEqual(len({row["metaDescription"] for row in rows}), len(rows))
        self.assertEqual(len({row["focusKeyword"] for row in rows}), len(rows))
        self.assertTrue(all(len(row["title"]) <= 70 for row in rows))
        self.assertTrue(all(len(row["metaDescription"]) <= 155 for row in rows))
        self.assertTrue(all("…" not in row["title"] + row["metaDescription"] for row in rows))
        self.assertIn("006", _seo(POOL_TITLES[_identity("MH2D006SS")])["focusKeyword"])
        self.assertIn("066", _seo(POOL_TITLES[_identity("MH2D066SS")])["focusKeyword"])

    def test_approved_discount_policy_uses_official_net_pvp_tiers(self) -> None:
        expected = {
            Decimal("0"): Decimal("5.00"),
            Decimal("24.99"): Decimal("5.00"),
            Decimal("25"): Decimal("7.50"),
            Decimal("49.99"): Decimal("7.50"),
            Decimal("50"): Decimal("10.00"),
            Decimal("99.99"): Decimal("10.00"),
            Decimal("100"): Decimal("15.00"),
            Decimal("249.99"): Decimal("15.00"),
            Decimal("250"): Decimal("17.50"),
            Decimal("499.99"): Decimal("17.50"),
            Decimal("500"): Decimal("20.00"),
        }
        for pvp, discount in expected.items():
            with self.subTest(pvp=pvp):
                self.assertEqual(_discount_percent_for_pvp(pvp), discount)
        self.assertEqual(
            _sale_price_from_pvp(Decimal("210")),
            (Decimal("254.10"), Decimal("15.00"), Decimal("215.99")),
        )

    def test_sanybox_is_a_standalone_simple_product_without_commercial_blocker(self) -> None:
        group = {
            "groupKey": "sanybox-group",
            "baseReference": "MEN000SS",
            "configurationTail": "",
            "entityRole": "component",
            "printedPages": [121],
            "nearbyTitles": ["Sanybox Inox"],
            "references": {
                "existing": [],
                "not_in_export": ["MEN000SS"],
                "needs_review": [],
                "excluded_context": [],
            },
        }
        media = {
            "pool-men000": {
                "officialProductUrl": "https://sanycces.es/producto/sanybox-inox/",
                "outputPath": "media/pool-men000.webp",
                "outputSha256": "a" * 64,
            }
        }
        article = _pool_article_record(
            group,
            media,
            "b" * 64,
            {
                "MEN000SS": {
                    "sourceRow": 100,
                    "pvpExVat": Decimal("103"),
                    "ean": "8435315500001",
                    "eanStatus": "valid_or_blank",
                }
            },
            "c" * 64,
        )
        self.assertEqual(article["productModelRecommendation"], "simple")
        self.assertNotIn("trazabilidad", article["shortDescriptionHtml"])
        self.assertNotIn("catálogo PDF", article["descriptionHtml"])
        self.assertEqual(
            article["merchandisingDecision"],
            "standalone_sellable_sanybox_product_approved",
        )
        self.assertEqual(article["recommendedCategory"], "Fontanería > Sanybox")
        self.assertEqual(article["publication"]["blockers"], [])

    def test_published_tariff_audit_accepts_exact_and_cardiff_composite_prices(self) -> None:
        tariff = {
            "LV30706046101SWM": {
                "reference": "LV30706046101SWM",
                "sourceRow": 2937,
                "pvpExVat": Decimal("400"),
            },
            "SOLIDMEC": {
                "reference": "SOLIDMEC",
                "sourceRow": 7174,
                "pvpExVat": Decimal("66"),
            },
            "SOLIDTWMEC": {
                "reference": "SOLIDTWMEC",
                "sourceRow": 7175,
                "pvpExVat": Decimal("110"),
            },
        }
        base = {
            "csvRow": 100,
            "id": "200",
            "parentId": "10",
            "title": "Cardiff",
            "regularPrice": "484.00",
            "salePrice": "399.30",
            "machiningTap": "No",
            "machiningTowelRail": "No",
        }
        exact = _published_tariff_audit_row(
            {**base, "sku": "LV30706046101SWM"},
            tariff,
        )
        composite = _published_tariff_audit_row(
            {
                **base,
                "id": "201",
                "sku": "LV30706046101SWM.TG",
                "regularPrice": "696.96",
                "salePrice": "557.57",
                "machiningTap": "Si",
                "machiningTowelRail": "Sí",
            },
            tariff,
        )
        self.assertEqual(exact["tariffComparisonStatus"], "exact_official_tariff_match")
        self.assertEqual(exact["expectedDiscountPercent"], "17.50")
        self.assertEqual(exact["expectedSalePriceGross"], "399.30")
        self.assertEqual(exact["discountPolicyStatus"], "exact_policy_match")
        self.assertEqual(composite["tariffComparisonStatus"], "official_tariff_composite_match")
        self.assertEqual(composite["officialTariffPvpExVat"], "576.00")
        self.assertEqual(composite["officialTariffReferences"], "LV30706046101SWM|SOLIDMEC|SOLIDTWMEC")
        self.assertFalse(composite["requiresReview"])
        self.assertEqual(composite["discountPolicyStatus"], "exact_policy_match")

    def test_published_tariff_audit_rejects_unproved_composite_or_wrong_price(self) -> None:
        tariff = {
            "LV30706046101SWM": {
                "reference": "LV30706046101SWM",
                "sourceRow": 2937,
                "pvpExVat": Decimal("400"),
            },
            "SOLIDMEC": {
                "reference": "SOLIDMEC",
                "sourceRow": 7174,
                "pvpExVat": Decimal("66"),
            },
            "SOLIDTWMEC": {
                "reference": "SOLIDTWMEC",
                "sourceRow": 7175,
                "pvpExVat": Decimal("110"),
            },
        }
        wrong_attributes = _published_tariff_audit_row(
            {
                "csvRow": 100,
                "id": "201",
                "parentId": "10",
                "title": "Cardiff",
                "sku": "LV30706046101SWM.T",
                "regularPrice": "617.10",
                "salePrice": "493.68",
                "machiningTap": "Si",
                "machiningTowelRail": "No",
            },
            tariff,
        )
        wrong_price = _published_tariff_audit_row(
            {
                "csvRow": 101,
                "id": "202",
                "parentId": "10",
                "title": "Cardiff",
                "sku": "LV30706046101SWM",
                "regularPrice": "485.00",
                "salePrice": "",
                "machiningTap": "No",
                "machiningTowelRail": "No",
            },
            tariff,
        )
        self.assertEqual(wrong_attributes["tariffComparisonStatus"], "published_sku_missing_from_tariff")
        self.assertEqual(
            wrong_attributes["identityIssue"],
            "cardiff_suffix_disagrees_with_machining_attributes",
        )
        self.assertEqual(wrong_price["tariffComparisonStatus"], "official_tariff_price_mismatch")
        self.assertTrue(wrong_price["priceErrorConfirmed"])


if __name__ == "__main__":
    unittest.main()
