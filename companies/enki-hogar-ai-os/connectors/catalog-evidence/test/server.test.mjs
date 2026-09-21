import assert from "node:assert/strict";
import test from "node:test";
import {bearerMatches, healthPayload} from "../src/server.mjs";

test("health leaks no catalogue metadata and bearer comparison is exact", () => {
  const body = healthPayload();
  assert.deepEqual(body, {status: "ok", service: "enki-catalogue-evidence-mcp", version: "0.1.0", schema_version: 1});
  assert.doesNotMatch(JSON.stringify(body), /brand|sku|publicationKey|runKey/);
  assert.equal(bearerMatches(undefined, "fixture-token-with-enough-length"), false);
  assert.equal(bearerMatches("Bearer wrong", "fixture-token-with-enough-length"), false);
  assert.equal(bearerMatches("Bearer fixture-token-with-enough-length", "fixture-token-with-enough-length"), true);
});
