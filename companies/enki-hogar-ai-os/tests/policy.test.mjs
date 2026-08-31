import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const policy = readFileSync(join(packageDir, "policies", "tool-allowlist.yaml"), "utf8");
const desired = JSON.parse(readFileSync(join(packageDir, "policies", "desired-state.yaml"), "utf8"));

test("policy quarantines every mutation except the three Board-approved publication tools", () => {
  for (const term of ["mutate", "refund", "budget", "index", "publish", "upload", "delete", "update"]) {
    assert.match(policy, new RegExp(term));
  }
  assert.match(policy, /default: quarantine/);
  assert.match(policy, /deniedPatterns: \[create, update, delete, refund, batch, customer, set, write\]/);
  const publisher = desired.connections.find((connection) => connection.key === "content_publisher");
  assert.deepEqual(publisher?.writeTools, [
    "wordpress_upsert_post",
    "facebook_publish_page_post",
    "instagram_publish_image",
  ]);
  assert.equal(publisher?.quarantineNewEntries, true);
  const approval = desired.policies.find((candidate) => candidate.name === "Enki require Board approval for publishing");
  assert.equal(approval?.policyType, "require_approval");
  assert.equal(approval?.priority, 100);
  assert.deepEqual(approval?.requiredToolNames, publisher?.writeTools);
  const block = desired.policies.find((candidate) => candidate.name === "Enki block write and destructive tools");
  assert.equal(block?.policyType, "block");
  assert.equal(block?.priority, 1000);
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
