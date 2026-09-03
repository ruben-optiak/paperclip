import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(root, "references/finance/minimum-data-contract-v1.json"), "utf8"));
const runbook = readFileSync(join(root, "runbooks/financial-data-contract.md"), "utf8");

test("EAI-008 separates available commerce aggregates from missing accounting inputs", () => {
  assert.equal(contract.schema, "enki-financial-source-contract/v1");
  assert.deepEqual(contract.sources.map(({key}) => key), ["woo_sales_summary", "google_ads_aggregate", "ga4_aggregate"]);
  const unavailable = new Set(contract.requiredInputs.filter(({status}) => status === "unavailable").map(({key}) => key));
  for (const key of ["cogs", "statutory_vat", "carrier_fulfilment_cost", "payment_processing_fees", "refunds_by_transaction_date", "verified_new_customers", "governed_channel_attribution"]) assert.equal(unavailable.has(key), true, key);
  assert.equal(contract.qualityRules.missingIsZero, false);
  assert.equal(contract.qualityRules.estimatedActualsAllowed, false);
  assert.equal(contract.qualityRules.rowLevelCustomerJoinAllowed, false);
});

test("profitability metrics fail closed while required sources are absent", () => {
  const availability = Object.fromEntries(contract.metricAvailability.map((item) => [item.metric, item.status]));
  assert.equal(availability.recognized_orders, "available");
  assert.equal(availability.gross_checkout_revenue, "available");
  assert.equal(availability.tax_total, "available_non_statutory");
  assert.equal(availability.shipping_charged, "available_not_cost");
  for (const metric of ["cac", "gross_margin", "contribution_margin", "channel_profitability"]) assert.equal(availability[metric], "unavailable", metric);
  assert.equal(contract.authority.isAccountingStatement, false);
  assert.equal(contract.authority.isExternalMutationAuthority, false);
});

test("financial runbook preserves VAT shipping attribution and PII boundaries", () => {
  for (const marker of ["not called VAT", "never\ncarrier cost", "platform attribution measure", "value is `null`, never zero", "do not create customer/order joins"]) assert.match(runbook, new RegExp(marker));
  assert.match(runbook, /`ENK-5`, `EAI-024`.*stay\nblocked/);
});
