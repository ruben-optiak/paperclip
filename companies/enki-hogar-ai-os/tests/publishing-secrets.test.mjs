import assert from "node:assert/strict";
import {chmod, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {initializePublishingSecrets} from "../scripts/init-local-publishing-secrets.mjs";

async function fixture(context, content = "WOO_BASE_URL=https://shop.example.invalid\n") {
  const directory = await mkdtemp(join(tmpdir(), "enki-publishing-secrets-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const path = join(directory, "connectors.env");
  await writeFile(path, content, {mode: 0o644});
  return {directory, path};
}

test("adds one strong connector bearer and keeps write mode disabled", async (context) => {
  const {path} = await fixture(context);
  const result = await initializePublishingSecrets(path, {randomValue: () => "A".repeat(64)});
  assert.deepEqual(result.generated, ["CONTENT_PUBLISHER_MCP_TOKEN"]);
  assert.equal(result.writeMode, "disabled");
  const content = await readFile(path, "utf8");
  assert.match(content, /^CONTENT_PUBLISHER_MCP_TOKEN=A{64}$/m);
  assert.match(content, /^CONTENT_PUBLISH_WRITE_MODE=disabled$/m);

  await chmod(path, 0o600);
  const second = await initializePublishingSecrets(path, {randomValue: () => "B".repeat(64)});
  assert.equal(second.mode, "unchanged");
  assert.equal((await readFile(path, "utf8")).match(/CONTENT_PUBLISHER_MCP_TOKEN=/g).length, 1);
});

test("refuses symlinks, weak placeholders, duplicates, and an already enabled writer", async (context) => {
  const {directory, path} = await fixture(context, "CONTENT_PUBLISHER_MCP_TOKEN=change-me\n");
  await assert.rejects(() => initializePublishingSecrets(path), /weak|placeholder/);
  await writeFile(path, `CONTENT_PUBLISHER_MCP_TOKEN=${"A".repeat(64)}\nCONTENT_PUBLISHER_MCP_TOKEN=${"B".repeat(64)}\n`);
  await assert.rejects(() => initializePublishingSecrets(path), /Duplicate/);
  await writeFile(path, `CONTENT_PUBLISHER_MCP_TOKEN=${"A".repeat(64)}\nCONTENT_PUBLISH_WRITE_MODE=approved\n`);
  await assert.rejects(() => initializePublishingSecrets(path), /must be disabled/);
  const link = join(directory, "link.env");
  await symlink(path, link);
  await assert.rejects(() => initializePublishingSecrets(link), /symlink/);
});
