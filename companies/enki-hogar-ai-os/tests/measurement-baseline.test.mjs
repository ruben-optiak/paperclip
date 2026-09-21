import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const receipt = JSON.parse(readFileSync(join(root, "references/measurement/eai-006-baseline-2026-09-03.json"), "utf8"));
const runbook = readFileSync(join(root, "runbooks/measurement-baseline.md"), "utf8");

test("EAI-006 receipt preserves closed comparable periods and no private identifiers", () => {
  assert.equal(receipt.schema, "enki-measurement-baseline/v1");
  assert.deepEqual(receipt.periods.map(({start, end}) => [start, end]), [["2026-07-01", "2026-07-31"], ["2026-08-01", "2026-08-31"]]);
  assert.equal(receipt.sources.ga4.propertyIdentifierRetained, false);
  assert.equal(receipt.sources.woocommerce.customerDataRetained, false);
  assert.equal(receipt.authority.containsPii, false);
  assert.equal(receipt.authority.containsPrivateIdentifiers, false);
  assert.equal(receipt.authority.isExternalMutationAuthority, false);
  assert.doesNotMatch(JSON.stringify(receipt), /properties\/\d|customer[_-]?id|order[_-]?id|email|credential|token/i);
});

test("EAI-006 fails the GA4 commercial-truth gate on both observed months", () => {
  for (const period of receipt.periods) {
    assert.equal(period.reconciliation.commercialRevenueMatches, false);
    assert.equal(Number(period.ga4.purchaseRevenueEur) < Number(period.woocommerce.grossRevenueEur), true);
    assert.equal(period.ga4.sampled, false);
    assert.equal(period.ga4.dataLossFromOtherRow, false);
    assert.equal(period.gsc.truncated, false);
  }
  assert.equal(receipt.usability.ga4PurchasesRevenue, "not_usable_as_commercial_truth_due_to_woo_mismatch");
  assert.equal(receipt.decision.editorialExecutionGateCleared, false);
});

test("measurement runbook fixes reproducible queries and conservative usage", () => {
  for (const marker of ["run_report", "gsc_search_analytics", "woo_sales_summary", "wordpress_list_posts", "PARTIAL", "Consent/tag status is unknown", "not commercial truth"]) assert.ok(runbook.includes(marker), marker);
  assert.match(runbook, /EAI-007.*EAI-023.*remain blocked/);
  assert.match(runbook, /do not change analytics, tags, consent, campaigns or the site/i);
});
