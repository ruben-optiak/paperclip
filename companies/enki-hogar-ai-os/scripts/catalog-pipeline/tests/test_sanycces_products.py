from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.sanycces_products import (  # noqa: E402
    DEFAULT_ADAPTER,
    _render_pdf_image_contact_sheets,
    build_section_breakdown,
    extract_matrix_observations,
    group_catalog_references,
    load_sanycces_adapter,
    logical_page_descriptors,
    propose_reviewed_pdf_image_mappings,
    verify_reviewed_section_expectation,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = PACKAGE_ROOT / "skills" / "enki-product-publishing" / "fixtures" / "sanycces-catalog-matrices-v1.json"


class SanyccesProductAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.adapter, cls.adapter_sha256 = load_sanycces_adapter()
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_adapter_is_exact_snapshot_scoped_and_local_only(self) -> None:
        self.assertEqual(DEFAULT_ADAPTER.name, "sanycces-griferia-2026.v1.json")
        self.assertEqual(self.adapter["source"]["physicalPageCount"], 133)
        self.assertEqual(self.adapter["source"]["logicalPageCount"], 264)
        self.assertEqual(self.adapter["wooSnapshot"]["dataRows"], 1647)
        self.assertEqual(self.adapter["wooSnapshot"]["columns"], 470)
        self.assertEqual(len(self.adapter_sha256), 64)
        self.assertTrue(self.adapter["authority"]["isCatalogInventoryTruth"])
        self.assertEqual(self.adapter["authority"]["catalogInventorySource"], "official_pdf")
        self.assertFalse(self.adapter["authority"]["websiteMayDefineCatalogInventory"])
        for key in (
            "isLiveCommercialTruth",
            "isConfirmedNewProductList",
            "isExternalMutationAuthority",
            "canGenerateWooImport",
            "canPublishProducts",
        ):
            self.assertFalse(self.adapter["authority"][key])

    def test_fixture_hash_and_case_count_are_pinned(self) -> None:
        digest = hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()
        self.assertEqual(self.adapter["fixture"]["sha256"], digest)
        self.assertEqual(len(self.fixture["cases"]), self.adapter["qualityGate"]["expectedFixtureCases"])
        self.assertTrue(self.fixture["sanitized"])

    def test_logical_page_model_covers_all_pages_and_only_reviewed_matrices(self) -> None:
        pages = logical_page_descriptors(self.adapter)
        self.assertEqual(len(pages), 264)
        self.assertEqual(pages[0]["role"], "front_cover")
        self.assertEqual(pages[-1]["role"], "back_cover")
        matrices = [page["printedPage"] for page in pages if page["role"] == "sku_matrix"]
        technical = [page["printedPage"] for page in pages if page["role"] == "technical"]
        self.assertEqual(len(matrices), 50)
        self.assertEqual(len(technical), 50)
        self.assertEqual(matrices[:3], [53, 55, 57])
        self.assertEqual(matrices[-2:], [259, 261])
        self.assertEqual(next(page for page in pages if page["printedPage"] == 49)["role"], "index")
        self.assertEqual(next(page for page in pages if page["printedPage"] == 123)["role"], "index")
        self.assertEqual(next(page for page in pages if page["printedPage"] == 169)["role"], "index")

    def test_all_sanitized_matrix_cases_match_their_oracle(self) -> None:
        for case in self.fixture["cases"]:
            with self.subTest(case=case["key"]):
                observations, _ = extract_matrix_observations(
                    case["words"],
                    adapter=self.adapter,
                    printed_page=53,
                    physical_page=27,
                    side="right",
                    section="fixture",
                    page_role=case["pageRole"],
                )
                self.assertEqual([item["reference"] for item in observations], case["expected"]["references"])
                self.assertEqual(sum(item["relationValid"] for item in observations), case["expected"]["valid"])
                self.assertEqual(sum(not item["relationValid"] for item in observations), case["expected"]["needsReview"])
                if "reason" in case["expected"]:
                    self.assertIn(case["expected"]["reason"], observations[0]["reasonCodes"])
                if "role" in case["expected"]:
                    self.assertEqual({item["entityRole"] for item in observations}, {case["expected"]["role"]})

    def test_matrix_geometry_does_not_accept_a_nearby_wrong_finish(self) -> None:
        words = [
            {"text": "CR", "x0": 90, "x1": 110, "y0": 100, "y1": 110},
            {"text": "BM", "x0": 190, "x1": 210, "y0": 100, "y1": 110},
            {"text": "EEE505BM", "x0": 80, "x1": 120, "y0": 125, "y1": 135},
        ]
        observations, _ = extract_matrix_observations(
            words,
            adapter=self.adapter,
            printed_page=53,
            physical_page=27,
            side="right",
            section="fixture",
        )
        self.assertEqual(len(observations), 1)
        self.assertFalse(observations[0]["relationValid"])
        self.assertEqual(observations[0]["nearestFinish"], "CR")
        self.assertIn("finish_suffix_mismatch", observations[0]["reasonCodes"])

    def test_reference_groups_distinguish_partial_and_absent_coverage(self) -> None:
        def candidate(reference: str, status: str, finish: str, tail: str = "") -> dict:
            return {
                "reference": reference,
                "comparisonStatus": status,
                "entityRole": "kit_variant" if tail else "sellable_candidate",
                "sections": ["fixture"],
                "printedPages": [53],
                "evidence": [
                    {
                        "relationValid": True,
                        "catalogDisposition": "candidate",
                        "nearestFinish": finish,
                        "variantTail": tail,
                        "nearbyTitle": "Sanitized fixture",
                    }
                ],
            }

        groups = group_catalog_references(
            [
                candidate("AAA101CR", "existing", "CR"),
                candidate("AAA101BM", "not_in_export", "BM"),
                candidate("BBB202CRKS", "not_in_export", "CR", "KS"),
                candidate("BBB202BMKS", "not_in_export", "BM", "KS"),
                candidate("CCC303CRCR", "not_in_export", "CR"),
                candidate("CCC303BMBM", "not_in_export", "BM"),
            ],
            "a" * 64,
        )
        by_identity = {(item["baseReference"], item["configurationTail"]): item for item in groups}
        self.assertEqual(by_identity[("AAA101", "")]["groupStatus"], "partial_export_coverage")
        self.assertEqual(by_identity[("BBB202", "KS")]["groupStatus"], "absent_from_export")
        self.assertEqual(by_identity[("CCC303", "")]["referenceCount"], 2)

    def test_pool_review_expectation_distinguishes_pages_from_products(self) -> None:
        expected = self.adapter["qualityGate"]["reviewedSectionExpectations"]["pool"]
        self.assertEqual(expected["indexCards"], 27)
        self.assertEqual(expected["matrixPages"], 10)
        self.assertEqual(expected["catalogInventoryGroups"], 28)
        self.assertEqual(expected["productCandidateGroups"], 24)
        self.assertEqual(expected["sellableBaseGroups"], 20)
        self.assertEqual(expected["kitGroups"], 4)
        self.assertEqual(expected["componentGroups"], 4)
        self.assertEqual(expected["contextOnlyGroups"], 2)
        media_expected = self.adapter["mediaEvidence"]["reviewedSectionMappingExpectations"]["pool"]
        self.assertEqual(media_expected["technicalMatrixPairs"], 10)
        self.assertEqual(media_expected["mappedCandidates"], 28)
        self.assertEqual(media_expected["cardinalityMismatchPairs"], 0)

    def test_reviewed_section_gate_fails_on_ten_product_miscount(self) -> None:
        actual = dict(self.adapter["qualityGate"]["reviewedSectionExpectations"]["pool"])
        actual["productCandidateGroups"] = 10
        result = verify_reviewed_section_expectation("pool", {"pool": actual}, self.adapter)
        self.assertEqual(result["status"], "drift")
        self.assertEqual(result["mismatches"][0]["metric"], "productCandidateGroups")

    def test_section_breakdown_keeps_inventory_components_and_context_distinct(self) -> None:
        groups = [
            {
                "sections": ["pool"],
                "groupStatus": "absent_from_export",
                "entityRole": "sellable_candidate",
            },
            {
                "sections": ["pool"],
                "groupStatus": "absent_from_export",
                "entityRole": "kit_variant",
            },
            {
                "sections": ["pool"],
                "groupStatus": "absent_from_export",
                "entityRole": "component",
            },
            {
                "sections": ["pool"],
                "groupStatus": "excluded_context",
                "entityRole": "context_reference",
            },
        ]
        candidates = [{"sections": ["pool"]} for _ in range(7)]
        page_rows = [
            {
                "section": "pool",
                "role": "index",
                "printedPage": 122,
                "indexCardCount": 3,
                "matrixObservationCount": 0,
            },
            {
                "section": "pool",
                "role": "sku_matrix",
                "printedPage": 127,
                "indexCardCount": 0,
                "matrixObservationCount": 7,
            },
        ]
        pool = build_section_breakdown(groups, candidates, page_rows)["pool"]
        self.assertEqual(pool["catalogInventoryGroups"], 3)
        self.assertEqual(pool["productCandidateGroups"], 2)
        self.assertEqual(pool["componentGroups"], 1)
        self.assertEqual(pool["contextOnlyGroups"], 1)

    def test_reviewed_image_mapping_is_scoped_and_requires_equal_cardinality(self) -> None:
        adapter = json.loads(json.dumps(self.adapter))
        image = {
            "candidateKey": "image-1",
            "section": "pool",
            "printedPage": 126,
            "extractionStatus": "extracted_original_jpeg",
            "placementBoxPoints": [0, 10, 20, 30],
            "mappingState": "unmapped",
            "proposedGroupKey": None,
            "proposedBaseReference": None,
            "proposedConfigurationTail": None,
            "mappingMethod": None,
            "reasonCodes": ["unmapped_to_catalog_group"],
        }
        group = {
            "groupKey": "group-1",
            "baseReference": "AAA101",
            "configurationTail": "",
            "groupStatus": "absent_from_export",
            "sections": ["pool"],
            "printedPages": [127],
            "references": {
                "existing": [],
                "not_in_export": ["AAA101CR"],
                "needs_review": [],
                "excluded_context": [],
            },
        }
        candidate = {
            "reference": "AAA101CR",
            "evidence": [{"printedPage": 127, "box": [0, 12, 20, 22]}],
        }
        result = propose_reviewed_pdf_image_mappings("pool", [image], [group], [candidate], adapter)
        self.assertEqual(result["status"], "drift")
        self.assertEqual(result["pairs"][0]["status"], "mapped_by_vertical_order")
        self.assertTrue(all(row["status"] == "cardinality_mismatch" for row in result["pairs"][1:]))
        self.assertEqual(image["mappingState"], "proposed_needs_visual_review")
        self.assertEqual(image["proposedBaseReference"], "AAA101")
        self.assertNotIn("unmapped_to_catalog_group", image["reasonCodes"])

    def test_pdf_image_contact_sheet_is_deterministic_and_never_claims_source_upscaling(self) -> None:
        candidates = [
            {
                "candidateKey": "image-1",
                "section": "pool",
                "printedPage": 126,
                "placementBoxPoints": [0, 10, 20, 30],
                "filePath": "pdf-image-candidates/assets/image-1.jpg",
                "proposedBaseReference": "AAA101",
                "proposedConfigurationTail": "",
                "sourcePixels": {"width": 32, "height": 48},
            }
        ]
        hashes = []
        for _ in range(2):
            with TemporaryDirectory() as temp:
                root = Path(temp)
                asset = root / candidates[0]["filePath"]
                asset.parent.mkdir(parents=True)
                Image.new("RGB", (32, 48), (150, 160, 170)).save(asset, "JPEG", quality=90)
                rows = _render_pdf_image_contact_sheets(candidates, root)
                self.assertEqual(len(rows), 1)
                self.assertFalse(rows[0]["sourcePixelsUpscaled"])
                self.assertTrue((root / rows[0]["imagePath"]).is_file())
                hashes.append(rows[0]["imageSha256"])
        self.assertEqual(hashes[0], hashes[1])


if __name__ == "__main__":
    unittest.main()
