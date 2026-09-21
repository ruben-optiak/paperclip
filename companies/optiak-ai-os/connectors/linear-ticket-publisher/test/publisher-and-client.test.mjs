import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicationJournal } from "../src/journal.mjs";
import { TicketPublisher } from "../src/publisher.mjs";
import { LinearClient } from "../src/linear-client.mjs";
import { PublisherError } from "../src/errors.mjs";

const fixturePath = fileURLToPath(new URL("../fixtures/valid-batch.json", import.meta.url));
const fixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));

function withJournal(run) {
  const directory = mkdtempSync(join(tmpdir(), "optiak-linear-publisher-"));
  const journal = new PublicationJournal(join(directory, "journal.sqlite"));
  return Promise.resolve(run(journal)).finally(() => {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

function provider(options = {}) {
  let creates = 0;
  return {
    get creates() { return creates; },
    verifyTeam: async () => {
      if (options.preflightError) throw options.preflightError;
    },
    createIssue: async () => {
      creates += 1;
      if (options.failAt === creates) throw options.error;
      return { identifier: `OPT-${100 + creates}`, url: `https://linear.app/optiak/issue/OPT-${100 + creates}` };
    },
  };
}

test("disabled mode validates but never calls Linear or creates journal rows", async () => withJournal(async (journal) => {
  const upstream = provider();
  const publisher = new TicketPublisher({ journal, provider: upstream, writeMode: "disabled" });
  const result = await publisher.publish(fixture());
  assert.equal(result.error.code, "write_disabled");
  assert.equal(upstream.creates, 0);
  assert.equal(journal.list().length, 0);
}));

test("successful publication replays from the durable journal without another provider mutation", async () => withJournal(async (journal) => {
  const upstream = provider();
  const publisher = new TicketPublisher({ journal, provider: upstream, writeMode: "enabled" });
  const first = await publisher.publish(fixture());
  const replay = await publisher.publish(fixture());
  assert.equal(first.outcome, "completed");
  assert.equal(first.tickets[0].outcome, "created");
  assert.equal(replay.tickets[0].outcome, "already_created");
  assert.equal(upstream.creates, 1);
}));

test("an uncertain partial batch stops immediately and can never auto-retry", async () => withJournal(async (journal) => {
  const input = fixture();
  input.tickets.push({ ...structuredClone(input.tickets[0]), key: "second-ticket", title: "Second bounded ticket" });
  input.tickets.push({ ...structuredClone(input.tickets[0]), key: "third-ticket", title: "Third bounded ticket" });
  const upstream = provider({ failAt: 2, error: new PublisherError("provider_transport_failure", { uncertain: true }) });
  const publisher = new TicketPublisher({ journal, provider: upstream, writeMode: "enabled" });
  const first = await publisher.publish(input);
  assert.equal(first.outcome, "blocked");
  assert.equal(first.completed.length, 1);
  assert.equal(first.error.ticketKey, "second-ticket");
  assert.equal(first.error.operatorReviewRequired, true);
  assert.equal(upstream.creates, 2);
  const replay = await publisher.publish(input);
  assert.equal(replay.error.code, "uncertain_previous_attempt");
  assert.equal(upstream.creates, 2);
  assert.deepEqual(
    Object.fromEntries(journal.list().map((row) => [row.draft_key, row.status])),
    { "enforce-budget": "succeeded", "second-ticket": "uncertain", "third-ticket": "prepared" },
  );
}));

test("a deterministic provider rejection also needs operator reset and a fresh approval", async () => withJournal(async (journal) => {
  const upstream = provider({ failAt: 1, error: new PublisherError("provider_rejected") });
  const publisher = new TicketPublisher({ journal, provider: upstream, writeMode: "enabled" });
  assert.equal((await publisher.publish(fixture())).error.code, "provider_rejected");
  assert.equal((await publisher.publish(fixture())).error.code, "failed_previous_attempt");
  assert.equal(upstream.creates, 1);
}));

test("the Linear client requests least-privilege scopes, verifies team OPT and projects only issue identity", async () => {
  const teamId = ["aaaaaaaa", "bbbb", "4ccc", "8ddd", "eeeeeeeeeeee"].join("-");
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "runtime-only-token", expires_in: 3600, scope: "read issues:create" }), { status: 200 });
    }
    const request = JSON.parse(options.body);
    if (request.query.includes("VerifyTeam")) {
      return new Response(JSON.stringify({ data: { team: { id: teamId, key: "OPT" } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { issueCreate: { success: true, issue: { identifier: "OPT-321", url: "https://linear.app/optiak/issue/OPT-321/example", team: { key: "OPT" } } } } }), { status: 200 });
  };
  const client = new LinearClient({ teamId, oauthClientId: "client", oauthClientSecret: "runtime-secret", fetchImpl });
  await client.verifyTeam();
  const result = await client.createIssue({ title: "Example", description: "Example", priority: 2 });
  assert.deepEqual(result, { identifier: "OPT-321", url: "https://linear.app/optiak/issue/OPT-321" });
  assert.equal(calls.length, 3);
  assert.match(String(calls[0].options.body), /issues%3Acreate/);
  assert.equal(JSON.stringify(result).includes("runtime-only-token"), false);
});

test("ambiguous provider mutation responses are uncertain", async () => {
  const teamId = ["aaaaaaaa", "bbbb", "4ccc", "8ddd", "eeeeeeeeeeee"].join("-");
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600, scope: "read,issues:create" }), { status: 200 });
    if (call === 2) return new Response(JSON.stringify({ data: { team: { id: teamId, key: "OPT" } } }), { status: 200 });
    return new Response(JSON.stringify({ data: { issueCreate: { success: true, issue: { identifier: "OPT-9", url: "https://linear.app/other/issue/OPT-9", team: { key: "OPT" } } } } }), { status: 200 });
  };
  const client = new LinearClient({ teamId, oauthClientId: "client", oauthClientSecret: "secret", fetchImpl });
  await client.verifyTeam();
  await assert.rejects(client.createIssue({ title: "Example", description: "Example", priority: 2 }), (error) => error.code === "provider_result_mismatch" && error.uncertain === true);
});
