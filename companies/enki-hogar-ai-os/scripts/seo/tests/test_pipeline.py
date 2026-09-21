import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "pipeline.py"
spec = importlib.util.spec_from_file_location("seo_pipeline", SCRIPT)
seo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seo)
ORIGIN = "https://www.example.invalid"


class SeoPipelineTests(unittest.TestCase):
    def test_url_guard_preserves_distinct_paths_and_rejects_actions_and_pii(self):
        for value in ["?add-to-cart=5", "/cart/", "/checkout/", "/wp-json/", "/%77p-admin/", "/a%40b.test/", "/+34612345678/", "https://evil.invalid/", "https://user:pass@www.example.invalid/a", "/a%3Fadd-to-cart=5"]:
            with self.subTest(value=value):
                self.assertIsNone(seo.safe_url(value, ORIGIN))
        self.assertNotEqual(seo.safe_url("/a", ORIGIN), seo.safe_url("/a/", ORIGIN))
        self.assertEqual(seo.safe_url("/a/#section", ORIGIN), ORIGIN + "/a/")

    def test_robots_selects_specific_group_and_longest_match(self):
        rules = "User-agent: Googlebot\nDisallow: /private\nUser-agent: *\nDisallow: */page/*\nDisallow: /private\nAllow: /private/public$"
        self.assertFalse(seo.robots_allowed(rules, ORIGIN + "/x/page/2/", "EnkiSeoAudit/1.0"))
        self.assertTrue(seo.robots_allowed(rules, ORIGIN + "/x/page/2/", "Googlebot"))
        self.assertTrue(seo.robots_allowed(rules, ORIGIN + "/private/public", "EnkiSeoAudit/1.0"))
        self.assertFalse(seo.robots_allowed(rules, ORIGIN + "/private/public/other", "EnkiSeoAudit/1.0"))

    def test_sitemap_ignores_image_locations_and_rejects_entities(self):
        xml = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="urn:image"><url><loc>https://www.example.invalid/a/</loc><image:image><image:loc>https://cdn.invalid/a.jpg</image:loc></image:image></url></urlset>'
        self.assertEqual(seo.sitemap_entries(xml), ("urlset", [ORIGIN + "/a/"]))
        with self.assertRaises(ValueError):
            seo.sitemap_entries('<!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><urlset/>')

    def test_html_handles_attribute_order_comments_and_headers(self):
        html = '''<title>A &amp; B</title><!-- <meta name="robots" content="noindex"> -->
        <link href="/a/" REL="canonical"><meta content="Example" name="description"><h1>Title</h1>
        <script>var x = '<a href="/fake/">';</script><a href="/b/">Real</a>
        <a rel="nofollow" href="/c/">No</a><a href="/?add-to-cart=1">Buy</a>'''
        result = seo.inspect_page(html, ORIGIN + "/a/", ORIGIN, {"x-robots-tag": "noindex"})
        self.assertTrue(result["noindex"])
        self.assertEqual(result["canonical"], ORIGIN + "/a/")
        self.assertEqual(result["outgoing"], [ORIGIN + "/b/"])
        self.assertEqual(result["titleLength"], 5)
        self.assertEqual(result["h1Count"], 1)

    def test_multiple_or_cross_origin_canonicals_remain_ambiguous(self):
        result = seo.inspect_page('<link rel="canonical" href="https://evil.invalid/a"><link rel="canonical" href="/a/">', ORIGIN, ORIGIN)
        self.assertEqual(result["canonicalCount"], 2)
        self.assertEqual(result["unsafeCanonicalCount"], 1)
        self.assertIsNone(result["canonical"])

    def test_noindex_omission_and_nofollow_are_not_silent_passes(self):
        result = seo.inspect_page('<meta name="robots" content="none"><a href="/a/">A</a>', ORIGIN, ORIGIN)
        self.assertTrue(result["noindex"])
        self.assertTrue(result["nofollow"])
        self.assertEqual(result["outgoing"], [])

    def test_redirect_is_checked_before_network_follow(self):
        guard = seo.GuardedRedirect(ORIGIN, "EnkiSeoAudit/1.0", "User-agent: *\nDisallow: /private", 2)
        for target in ["https://evil.invalid/", ORIGIN + "/private/", ORIGIN + "/?add-to-cart=1"]:
            with self.assertRaises(ValueError):
                guard.redirect_request(None, None, 301, "", {}, target)

    def test_gsc_weights_position_and_ctr_instead_of_averaging_rows(self):
        result = seo.gsc_aggregate([{"clicks": 1, "impressions": 10, "position": 2}, {"clicks": 0, "impressions": 90, "position": 12}])
        self.assertEqual(result, {"clicks": 1, "impressions": 100, "ctr": 0.01, "position": 11})
        self.assertIsNone(seo.gsc_aggregate([])["position"])
        with self.assertRaises(ValueError):
            seo.gsc_aggregate([{"clicks": 5, "impressions": 2, "position": 1}])

    def test_overlap_is_candidate_only_and_raw_query_text_rejected(self):
        rows = [{"querySha256": "a" * 64, "url": ORIGIN + path, "clicks": 1, "impressions": 20, "position": 8} for path in ["/a/", "/b/"]]
        result = seo.overlap_candidates(rows)
        self.assertEqual(len(result), 1)
        self.assertFalse(result[0]["cannibalizationProven"])
        self.assertEqual(seo.overlap_candidates(rows[:1]), [])
        with self.assertRaises(ValueError):
            seo.overlap_candidates([{**rows[0], "query": "a private query"}])

    def test_source_unavailable_stale_and_truncated_never_become_zero(self):
        now = datetime(2026, 9, 12, tzinfo=timezone.utc)
        self.assertFalse(seo.source_usable({"status": "unavailable"}, now))
        self.assertFalse(seo.source_usable({"status": "available", "capturedAt": "2026-09-03T00:00:00Z", "truncated": False}, now))
        self.assertFalse(seo.source_usable({"status": "available", "capturedAt": "2026-09-12T00:00:00Z", "truncated": True}, now))
        self.assertFalse(seo.source_usable({"status": "partial", "capturedAt": "2026-09-12T00:00:00Z", "truncated": False}, now))

    def test_config_rejects_missing_overlapping_and_invalid_periods(self):
        config = seo.load_config(seo.PACKAGE / "references/seo/pipeline-v1.json")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            for periods in [[], [config["periods"][0]] * 2,
                            [{"start": "2026-02-30", "end": "2026-03-01"}, config["periods"][1]]]:
                path.write_text(json.dumps({**config, "periods": periods}))
                with self.assertRaises(ValueError):
                    seo.load_config(path)

    def test_analysis_keeps_sitemap_conflict_and_sample_link_limits(self):
        page = {"url": ORIGIN + "/a/", "status": 200, "signals": seo.inspect_page('<meta name="robots" content="noindex">', ORIGIN + "/a/", ORIGIN)}
        snapshot = {"capturedAt": "2026-09-12T00:00:00Z", "inventory": [{"url": page["url"]}], "pages": [page], "coverage": {"sampled": True}}
        result = seo.analyze(snapshot, {}, {"origin": ORIGIN})
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["traffic"])
        self.assertIsNone(result["queryOverlapCandidates"])
        self.assertIsNone(result["internalLinks"]["orphansConfirmed"])
        self.assertIn("sitemap_noindex", [row["code"] for row in result["findings"]])
        for row in result["findings"]:
            self.assertEqual(row["score"], round(row["impact"] * row["confidence"] / row["effort"], 3))

    def test_new_snapshots_cannot_overwrite_previous_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.json"
            seo.write_new(path, {"value": 1})
            with self.assertRaises(FileExistsError):
                seo.write_new(path, {"value": 2})

    def test_periods_timezone_and_duplicate_rows_are_validated(self):
        config = {"origin": ORIGIN, "periods": [{"start": "2026-08-01", "end": "2026-08-31"}]}
        row = {"url": ORIGIN + "/a/", "clicks": 1, "impressions": 10, "position": 5}
        source = {"timezone": "America/Los_Angeles", "periods": [{**config["periods"][0], "rows": [row]}]}
        self.assertEqual(seo.period_metrics(source, config, "gsc")[0]["ctr"], 0.1)
        with self.assertRaises(ValueError):
            seo.period_metrics({**source, "timezone": "Europe/Madrid"}, config, "gsc")
        with self.assertRaises(ValueError):
            seo.period_metrics({**source, "periods": [{**config["periods"][0], "rows": [row, row]}]}, config, "gsc")
        with self.assertRaises(ValueError):
            seo.period_metrics({**source, "periods": []}, config, "gsc")

    def test_search_priority_uses_closed_source_rows_and_preserves_missing_comparator(self):
        config = {"origin": ORIGIN, "periods": [{"start": "2026-07-01", "end": "2026-07-31"}, {"start": "2026-08-01", "end": "2026-08-31"}]}
        prior = {"url": ORIGIN + "/a/", "clicks": 20, "impressions": 200, "position": 4}
        latest = [{**prior, "clicks": 5}, {"url": ORIGIN + "/b/", "clicks": 1, "impressions": 1000, "position": 8}]
        source = {"timezone": "America/Los_Angeles", "periods": [{**config["periods"][0], "rows": [prior]}, {**config["periods"][1], "rows": latest}]}
        rows = seo.search_opportunities(source, config)
        self.assertEqual(rows[0]["url"], ORIGIN + "/b/")
        self.assertIsNone(rows[0]["clicksPerDayDelta"])
        self.assertTrue(rows[0]["earlierRowMissing"])
        self.assertEqual(rows[1]["reason"], "visibility_drop_review")
        self.assertFalse(rows[1]["mutationAuthorized"])

    def test_committed_observation_replays_all_findings_without_network(self):
        config = seo.load_config(seo.PACKAGE / "references/seo/pipeline-v1.json")
        snapshot = json.loads((seo.PACKAGE / "references/seo/public-2026-09-12.json").read_text())
        sources = json.loads((seo.PACKAGE / "references/seo/sources-2026-09-12.json").read_text())
        saved = json.loads((seo.PACKAGE / "references/seo/analysis-2026-09-12.json").read_text())
        result = seo.analyze(snapshot, sources, config, datetime.fromisoformat(saved["analyzedAt"]))
        self.assertEqual(result, saved)

    def test_restored_capture_replays_with_partial_overlap_and_unknown_canonicals(self):
        config = seo.load_config(seo.PACKAGE / "references/seo/pipeline-v1.json")
        snapshot = json.loads((seo.PACKAGE / "references/seo/public-2026-09-12.json").read_text())
        sources = json.loads((seo.PACKAGE / "references/seo/sources-2026-09-12-restored.json").read_text())
        saved = json.loads((seo.PACKAGE / "references/seo/analysis-2026-09-12-restored.json").read_text())
        result = seo.analyze(snapshot, sources, config, datetime.fromisoformat(saved["analyzedAt"]))
        self.assertEqual(result, saved)
        self.assertEqual(result["queryOverlapCoverage"]["status"], "partial")
        self.assertEqual(len(result["queryOverlapCandidates"]), 21)
        self.assertTrue(all(row["sourceCoverage"] == "partial_observed_subset_only" for row in result["queryOverlapCandidates"]))
        self.assertTrue(all(row["googleCanonical"] is None for row in result["inspection"]["rows"]))
        self.assertEqual(len(result["searchOpportunities"]), 35)


if __name__ == "__main__":
    unittest.main()
