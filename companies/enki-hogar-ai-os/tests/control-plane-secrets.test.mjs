import assert from "node:assert/strict";
import {mkdtemp, readFile, stat, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {
  CONTROL_PLANE_INDEPENDENCE_KEYS,
  initializeControlPlaneSecrets,
  REQUIRED_CONTROL_PLANE_SECRETS,
} from "../scripts/init-local-control-plane-secrets.mjs";

async function fixture(context, content = "WOO_BASE_URL=https://shop.example.invalid\n") {
  const directory = await mkdtemp(join(tmpdir(), "enki-control-plane-secrets-"));
  context.after(async () => (await import("node:fs/promises")).rm(directory, {recursive: true, force: true}));
  const envFile = join(directory, "connectors.env");
  await writeFile(envFile, content, {mode: 0o644});
  return {directory, envFile};
}

test("adds one independent signing secret atomically without exposing it", async (context) => {
  const {envFile} = await fixture(context, `BETTER_AUTH_SECRET=${"A".repeat(64)}\nCONTENT_PUBLISHER_MCP_TOKEN=${"B".repeat(64)}\n`);
  const result = await initializeControlPlaneSecrets(envFile, {randomValue: () => "C".repeat(64)});
  assert.deepEqual(result.generated, REQUIRED_CONTROL_PLANE_SECRETS);
  assert.deepEqual(result.existing, []);
  assert.equal(result.mode, "updated_atomically");
  const content = await readFile(envFile, "utf8");
  assert.match(content, /^PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=C{64}$/m);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);

  const second = await initializeControlPlaneSecrets(envFile, {randomValue: () => { throw new Error("must not generate"); }});
  assert.equal(second.mode, "unchanged");
  assert.equal((await readFile(envFile, "utf8")).match(/PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=/g).length, 1);
});

test("rejects weak, duplicate, reused, and symlinked signing secrets", async (context) => {
  const {directory, envFile} = await fixture(context, "PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=change-me\n");
  await assert.rejects(initializeControlPlaneSecrets(envFile), /weak|placeholder/);

  await writeFile(envFile, `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=${"A".repeat(64)}\nPAPERCLIP_TOOL_ACTION_SIGNING_SECRET=${"B".repeat(64)}\n`);
  await assert.rejects(initializeControlPlaneSecrets(envFile), /Duplicate/);

  for (const independentKey of CONTROL_PLANE_INDEPENDENCE_KEYS) {
    await writeFile(envFile, `${independentKey}=${"A".repeat(64)}\nPAPERCLIP_TOOL_ACTION_SIGNING_SECRET=${"A".repeat(64)}\n`);
    await assert.rejects(initializeControlPlaneSecrets(envFile), new RegExp(`independent.*${independentKey}`));
  }

  const link = join(directory, "link.env");
  await symlink(envFile, link);
  await assert.rejects(initializeControlPlaneSecrets(link), /regular file/);
});
