import assert from "node:assert/strict";
import test from "node:test";
import {createToolDefinitions} from "../src/tools.mjs";

function repository() {
  return new Proxy({}, {get: (_target, key) => async (input) => ({method: String(key), input})});
}

test("agent catalogue contains exactly eight closed-world read-only support tools", () => {
  const tools = createToolDefinitions(repository());
  assert.deepEqual(tools.map((tool) => tool.name), [
    "knowledge_resolve_product",
    "knowledge_get_technical_profile",
    "knowledge_check_compatibility",
    "knowledge_list_allowed_options",
    "knowledge_get_configuration_model",
    "knowledge_search_support",
    "knowledge_get_evidence",
    "knowledge_coverage",
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.doesNotMatch(tool.name, /(?:create|update|delete|archive|restore|purge|import|reindex|price|stock)/);
  }
});

test("product resolution requires exactly one identifier", async () => {
  const tool = createToolDefinitions(repository()).find((entry) => entry.name === "knowledge_resolve_product");
  const missing = await tool.execute({});
  const conflicting = await tool.execute({woo_sku: "A", manufacturer_ref: "A"});
  assert.equal(missing.isError, true);
  assert.equal(conflicting.isError, true);
});

test("every result declares the split technical and commercial authority", async () => {
  const tool = createToolDefinitions(repository()).find((entry) => entry.name === "knowledge_coverage");
  const response = await tool.execute({});
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.schema, "enki-product-support-result/v1");
  assert.equal(payload.authority.commercial_source, "woocommerce-live");
  assert.equal(payload.authority.commercial_fields_included, false);
  assert.equal(payload.authority.rebuildable_projection, true);
});
