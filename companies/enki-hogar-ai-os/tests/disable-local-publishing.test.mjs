import assert from "node:assert/strict";
import {mkdtemp, readFile, stat, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {disableLocalPublishing} from "../scripts/disable-local-publishing.mjs";

async function fixture(context, content) {
  const directory = await mkdtemp(join(tmpdir(), "enki-disable-publishing-"));
  context.after(async () => (await import("node:fs/promises")).rm(directory, {recursive: true, force: true}));
  const envFile = join(directory, "connectors.env");
  await writeFile(envFile, content, {mode: 0o644});
  return {directory, envFile};
}

test("atomically closes an enabled publishing window without touching other values", async (context) => {
  const {envFile} = await fixture(context, "SECRET=keep-me\nCONTENT_PUBLISH_WRITE_MODE=wordpress-drafts\n");
  const result = await disableLocalPublishing(envFile);
  assert.deepEqual(result, {
    key: "CONTENT_PUBLISH_WRITE_MODE",
    mode: "disabled",
    file: "updated_atomically",
  });
  const content = await readFile(envFile, "utf8");
  assert.match(content, /^SECRET=keep-me$/m);
  assert.match(content, /^CONTENT_PUBLISH_WRITE_MODE=disabled$/m);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);

  assert.equal((await disableLocalPublishing(envFile)).file, "unchanged");
});

test("fails closed on duplicate keys and symlinks", async (context) => {
  const {directory, envFile} = await fixture(
    context,
    "CONTENT_PUBLISH_WRITE_MODE=approved\nCONTENT_PUBLISH_WRITE_MODE=wordpress-drafts\n",
  );
  await assert.rejects(disableLocalPublishing(envFile), /Duplicate/);
  const link = join(directory, "link.env");
  await symlink(envFile, link);
  await assert.rejects(disableLocalPublishing(link), /regular file/);
});
