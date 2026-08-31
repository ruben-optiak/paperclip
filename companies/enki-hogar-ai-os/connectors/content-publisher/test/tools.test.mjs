import assert from "node:assert/strict";
import test from "node:test";
import {createToolDefinitions} from "../src/tools.mjs";

function definitions(overrides = {}) {
  return createToolDefinitions({
    config: {writeMode: "disabled", wordpress: null, meta: null},
    wordpress: null,
    meta: null,
    ledger: {execute: async (_input, effect) => effect()},
    ...overrides,
  });
}

test("publishes the exact reviewed read and ask-first write catalog", () => {
  const tools = definitions();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "publisher_get_capabilities",
    "wordpress_list_posts",
    "wordpress_get_article",
    "wordpress_upsert_post",
    "facebook_list_page_posts",
    "facebook_publish_page_post",
    "instagram_list_media",
    "instagram_get_publishing_limit",
    "instagram_publish_image",
  ]);
  const writes = tools.filter((tool) => tool.annotations.readOnlyHint === false);
  assert.deepEqual(writes.map((tool) => tool.name), ["wordpress_upsert_post", "facebook_publish_page_post", "instagram_publish_image"]);
  assert.equal(writes.every((tool) => tool.annotations.idempotentHint === true && tool.annotations.destructiveHint === false), true);
});

test("kill switch rejects a write before provider or journal execution", async () => {
  let calls = 0;
  const tool = definitions({
    wordpress: {upsertPost: async () => { calls += 1; }},
    ledger: {execute: async (_input, effect) => { calls += 1; return effect(); }},
  }).find((entry) => entry.name === "wordpress_upsert_post");
  const response = await tool.execute({
    idempotency_key: "issue-1:revision-1",
    title: "Fixture",
    slug: "fixture",
    content_html: "<p>Fixture</p>",
    status: "draft",
  });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /kill switch/);
  assert.equal(calls, 0);
});

test("approved mode sends the exact reviewed arguments through the journal", async () => {
  const effects = [];
  const requests = [];
  const tool = definitions({
    config: {
      writeMode: "approved",
      wordpress: {baseUrl: "https://shop.example.invalid"},
      meta: null,
    },
    wordpress: {upsertPost: async (input) => { effects.push(input); return {external_id: "12", status: "draft"}; }},
    ledger: {execute: async (input, effect) => { requests.push(input); return effect(); }},
  }).find((entry) => entry.name === "wordpress_upsert_post");
  const response = await tool.execute({
    idempotency_key: "ENK-100:content-draft:7",
    title: "Fixture",
    slug: "fixture",
    content_html: "<p>Fixture</p>",
    status: "draft",
  });
  assert.equal(response.isError, undefined);
  assert.equal(requests[0].provider, "wordpress");
  assert.equal(requests[0].operation, "upsert_post");
  assert.equal(effects[0].create_missing_terms, false);
});
