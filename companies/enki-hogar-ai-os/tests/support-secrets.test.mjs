import assert from "node:assert/strict";
import {mkdtemp, readFile, stat, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {initializeSupportSecrets, REQUIRED_SUPPORT_SECRETS} from "../scripts/init-local-support-secrets.mjs";

test("support secrets are added atomically without exposing or replacing existing values", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "enki-support-secrets-"));
  context.after(async () => (await import("node:fs/promises")).rm(directory, {recursive: true, force: true}));
  const envFile = join(directory, "connectors.env");
  await writeFile(envFile, "WOO_BASE_URL=https://example.invalid\nSUPPORT_MCP_TOKEN=existing-secret-value-that-is-long-enough-1234567890\n", {mode: 0o600});

  const result = await initializeSupportSecrets(envFile, {randomValue: (key) => `${key.toLowerCase()}_${"x".repeat(48)}`});
  assert.deepEqual(result.generated, ["SUPPORT_DB_ADMIN_PASSWORD", "SUPPORT_DB_READER_PASSWORD"]);
  assert.deepEqual(result.existing, ["SUPPORT_MCP_TOKEN"]);
  assert.equal(result.mode, "updated_atomically");
  const content = await readFile(envFile, "utf8");
  assert.match(content, /^SUPPORT_MCP_TOKEN=existing-secret-value-that-is-long-enough-1234567890$/m);
  for (const key of REQUIRED_SUPPORT_SECRETS) assert.equal((content.match(new RegExp(`^${key}=`, "gm")) || []).length, 1);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);

  const second = await initializeSupportSecrets(envFile, {randomValue: () => { throw new Error("must not generate"); }});
  assert.equal(second.mode, "unchanged");
});

test("support secret initialization rejects placeholders and symlinks", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "enki-support-secrets-"));
  context.after(async () => (await import("node:fs/promises")).rm(directory, {recursive: true, force: true}));
  const placeholder = join(directory, "placeholder.env");
  await writeFile(placeholder, "SUPPORT_DB_ADMIN_PASSWORD=change-me-admin-password\n", {mode: 0o600});
  await assert.rejects(initializeSupportSecrets(placeholder), /placeholder/);

  const link = join(directory, "link.env");
  await symlink(placeholder, link);
  await assert.rejects(initializeSupportSecrets(link), /regular file/);
});
