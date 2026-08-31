import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {PublicationLedger} from "../src/ledger.mjs";

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), "enki-publication-ledger-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  return new PublicationLedger(join(directory, "journal.json"), {now: () => new Date("2026-08-31T12:00:00.000Z")});
}

test("replays a successful idempotency key without executing twice", async (context) => {
  const ledger = await fixture(context);
  let calls = 0;
  const input = {provider: "wordpress", operation: "upsert_post", idempotencyKey: "issue-123:rev-4", request: {slug: "fixture"}};
  const first = await ledger.execute(input, async () => {
    calls += 1;
    return {external_id: "42", canonical_url: "https://shop.example.invalid/fixture", status: "draft"};
  });
  const replay = await ledger.execute(input, async () => {
    calls += 1;
    return {};
  });
  assert.equal(calls, 1);
  assert.equal(first.idempotent_replay, false);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.external_id, "42");

  const stored = JSON.parse(await readFile(ledger.path, "utf8"));
  const entry = stored.entries["wordpress:upsert_post:issue-123:rev-4"];
  assert.equal(entry.state, "succeeded");
  assert.equal(Object.hasOwn(entry, "request"), false, "journal stores only a request hash, not publication content");
});

test("blocks changed arguments and uncertain retries until operator reconciliation", async (context) => {
  const ledger = await fixture(context);
  const input = {provider: "facebook", operation: "publish_page_post", idempotencyKey: "issue-9:rev-1", request: {message: "Fixture"}};
  await assert.rejects(() => ledger.execute(input, async () => { throw new Error("HTTP 500"); }), /HTTP 500/);
  await assert.rejects(() => ledger.execute(input, async () => ({})), /outcome is uncertain/);
  await assert.rejects(() => ledger.execute({...input, request: {message: "Changed"}}, async () => ({})), /different publication arguments/);

  assert.deepEqual(await ledger.reconcile({...input, outcome: "not-applied"}), {outcome: "not-applied", retry_allowed: true});
  const retried = await ledger.execute(input, async () => ({external_id: "post-1", status: "published"}));
  assert.equal(retried.external_id, "post-1");
});

test("applied reconciliation requires and preserves the verified live status", async (context) => {
  const ledger = await fixture(context);
  const input = {provider: "wordpress", operation: "upsert_post", idempotencyKey: "issue-10:rev-2", request: {slug: "draft-fixture"}};
  await assert.rejects(() => ledger.execute(input, async () => { throw new Error("timeout"); }), /timeout/);
  await assert.rejects(
    () => ledger.reconcile({...input, outcome: "applied", externalId: "81"}),
    /verified status/,
  );
  const reconciled = await ledger.reconcile({...input, outcome: "applied", externalId: "81", status: "draft"});
  assert.equal(reconciled.external_id, "81");
  const replay = await ledger.execute(input, async () => { throw new Error("must not execute"); });
  assert.equal(replay.status, "draft");
  assert.equal(replay.idempotent_replay, true);
});
