import assert from "node:assert/strict";
import test from "node:test";
import {serverConfig} from "../src/config.mjs";

test("configuration requires an independent bearer and explicit publication root", () => {
  assert.throws(() => serverConfig({}), /CATALOGUE_EVIDENCE_MCP_TOKEN/);
  assert.throws(() => serverConfig({CATALOGUE_EVIDENCE_MCP_TOKEN: "change-me-token-with-enough-length", CATALOGUE_EVIDENCE_ROOT: "/data"}), /non-placeholder/);
  assert.throws(() => serverConfig({CATALOGUE_EVIDENCE_MCP_TOKEN: "fixture-token-with-enough-length"}), /CATALOGUE_EVIDENCE_ROOT/);
  const config = serverConfig({CATALOGUE_EVIDENCE_MCP_TOKEN: "fixture-token-with-enough-length", CATALOGUE_EVIDENCE_ROOT: "/data/publication"});
  assert.equal(config.port, 8050);
  assert.equal(config.publicationRoot, "/data/publication");
  assert.equal(config.maxCropBytes, 1_000_000);
});
