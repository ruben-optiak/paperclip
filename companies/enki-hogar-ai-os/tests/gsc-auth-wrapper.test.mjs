import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

import {
  GSC_TOKEN_PATH,
  buildGscEnvironment,
  readInstalledOAuthClient,
} from "../connectors/google-mcps/gsc-auth-wrapper.mjs";

test("GSC wrapper reads a Desktop OAuth client without logging or persisting it", () => {
  const directory = mkdtempSync(join(tmpdir(), "enki-gsc-wrapper-"));
  const file = join(directory, "oauth-client.json");
  writeFileSync(file, JSON.stringify({installed: {client_id: "fixture-client", client_secret: "fixture-secret"}}), {mode: 0o600});

  const credentials = readInstalledOAuthClient(file);
  assert.deepEqual(credentials, {clientId: "fixture-client", clientSecret: "fixture-secret"});
  assert.deepEqual(buildGscEnvironment({PATH: "/usr/bin", GOOGLE_CLIENT_SECRET: "stale"}, credentials), {
    PATH: "/usr/bin",
    GOOGLE_CLIENT_ID: "fixture-client",
    GOOGLE_CLIENT_SECRET: "fixture-secret",
    GSC_TOKEN_PATH,
  });
});

test("GSC wrapper fails closed for a non-Desktop OAuth document", () => {
  const directory = mkdtempSync(join(tmpdir(), "enki-gsc-wrapper-"));
  const file = join(directory, "oauth-client.json");
  writeFileSync(file, JSON.stringify({web: {client_id: "fixture-client", client_secret: "fixture-secret"}}), {mode: 0o600});

  assert.throws(() => readInstalledOAuthClient(file), /installed client credentials/);
});
