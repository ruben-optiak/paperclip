import assert from "node:assert/strict";
import test from "node:test";
import {bearerMatches, healthPayload} from "../src/server.mjs";

test("health contains no product/support data and bearer comparison is exact", () => {
  const body = healthPayload(1);
  assert.deepEqual(body, {status: "ok", service: "enki-product-support-knowledge-mcp", version: "0.2.0", schema_version: 1});
  assert.doesNotMatch(JSON.stringify(body), /brand|product_count|entity_count/);
  assert.equal(bearerMatches(undefined, "fixture-token-with-enough-length"), false);
  assert.equal(bearerMatches("Bearer wrong", "fixture-token-with-enough-length"), false);
  assert.equal(bearerMatches("Bearer fixture-token-with-enough-length", "fixture-token-with-enough-length"), true);
});
