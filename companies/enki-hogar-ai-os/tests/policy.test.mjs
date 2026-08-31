import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const policy = readFileSync(join(packageDir, "policies", "tool-allowlist.yaml"), "utf8");
const desired = JSON.parse(readFileSync(join(packageDir, "policies", "desired-state.yaml"), "utf8"));

test("policy denies every planned mutation surface", () => {
  for (const term of ["mutate", "refund", "budget", "index", "publish", "upload", "delete", "update"]) {
    assert.match(policy, new RegExp(term));
  }
  assert.match(policy, /default: quarantine/);
  assert.match(policy, /deniedPatterns: \[create, update, delete, refund, batch, customer, set, write\]/);
});

test("Google, Woo and product-support allowlists contain only expected query tools", () => {
  for (const tool of ["woo_sales_summary", "woo_orders_summary", "woo_get_product_structure", "search_search", "run_report", "gsc_search_analytics"]) {
    assert.match(policy, new RegExp(`\\b${tool}:`));
  }
  assert.doesNotMatch(policy, /^\s+(?:woo_update|woo_refund|woo_customer|gsc_index|ads_mutate)[^:]*:/m);
  assert.doesNotMatch(policy, /^\s+list_google_ads_links:/m);
  const analytics = desired.connections.find((connection) => connection.key === "google_analytics");
  assert.equal(analytics?.tools.includes("list_google_ads_links"), false);
  assert.equal(desired.profiles.every((profile) => !profile.allowedTools.includes("list_google_ads_links")), true);
  const support = desired.connections.find((connection) => connection.key === "product_support_knowledge");
  assert.equal(support?.tools.length, 8);
  assert.equal(support?.tools.every((tool) => /^knowledge_(?:resolve|get|check|list|search|coverage)/.test(tool)), true);
});

test("Customer Experience is zero-PII and cannot reach any order tool", () => {
  const customerProfile = desired.profiles.find((profile) => profile.agentSlug === "customer-experience-manager");
  const wooConnection = desired.connections.find((connection) => connection.key === "woocommerce");
  assert.deepEqual(customerProfile?.allowedTools, [
    "woo_get_product",
    "woo_get_product_structure",
    "knowledge_resolve_product",
    "knowledge_get_technical_profile",
    "knowledge_check_compatibility",
    "knowledge_list_allowed_options",
    "knowledge_get_configuration_model",
    "knowledge_search_support",
    "knowledge_get_evidence",
  ]);
  assert.equal(wooConnection?.tools.some((tool) => /(?:get|lookup).*order|order.*(?:get|lookup)/i.test(tool)), false);
  assert.equal(customerProfile?.allowedTools.some((tool) => /order|customer|refund/i.test(tool)), false);
});
