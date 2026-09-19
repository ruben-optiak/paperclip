import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {prepareCompletion, completeIssue, completionRef, createApi, transportJson, readJsonInput} from "../skills/optiak-durable-completion/scripts/complete-issue.mjs";
import {evaluateLinearSnapshot, collectLinearSnapshot, loadBaseline} from "../scripts/linear-preflight.mjs";
import {recordQaNote} from "../scripts/record-qa-note.mjs";

const raw = readFileSync(new URL("../skills/optiak-durable-completion/references/fixtures/connected-sample.md", import.meta.url), "utf8");
const fixture = () => JSON.parse(raw.match(/```json\n([\s\S]*?)\n```/)[1]);
const now = Date.parse("2026-01-01T10:01:00Z");
const normalizeServerText = value => value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");

test("embedded JSON survives Paperclip multiline normalization without changing values", () => {
  const values = ["A\nB", "A\r\nB", "A\\nB", "A\\r\\nB", "A\\\\nB", 'quoted "value"', "Español 😀"];
  for (const text of values) {
    const json = transportJson({text});
    assert.equal(normalizeServerText(json), json);
    assert.deepEqual(JSON.parse(json), {text});
  }
  const {input, context} = fixture();
  input.productSample.items[0].rationale = "First criterion\nSecond criterion";
  const {comment} = prepareCompletion(input, context, {now});
  assert.equal(normalizeServerText(comment), comment);
  for (const match of comment.matchAll(/\x60{3}json\n([\s\S]*?)\n\x60{3}/g)) assert.doesNotThrow(() => JSON.parse(match[1]));
});
test("plain Markdown with literal escaped newlines is rejected before any write", async () => {
  const {input, context} = fixture(); input.body = "example\\nvalue";
  assert.throws(() => prepareCompletion(input, context, {now}), /literal_escaped/);
  let calls = 0;
  await assert.rejects(recordQaNote({...note, body: "example\\r\\nvalue"}, async () => { calls++; }), /literal_escaped/);
  assert.equal(calls, 0);
});
test("JSON stdin decodes split UTF-8 once and rejects malformed or oversized input", async () => {
  const bytes = Buffer.from(JSON.stringify({text: "Español 😀"}));
  async function* oneByteChunks() { for (const byte of bytes) yield Buffer.from([byte]); }
  assert.deepEqual(await readJsonInput(oneByteChunks()), {text: "Español 😀"});
  await assert.rejects(readJsonInput([Buffer.from([0xff])]));
  await assert.rejects(readJsonInput([Buffer.alloc(262145)]), /input_too_large/);
});

test("installed skill prepares exact run binding and one envelope without API calls", () => {
  const {input, context} = fixture();
  const payload = prepareCompletion(input, context, {now});
  assert.equal(payload.status, "done");
  assert.equal(payload.comment.match(/optiak-result-envelope\/v1/g).length, 1);
  assert(payload.comment.includes(completionRef(context)));
});

for (const [name, change, expected] of [
  ["invented live enum", x => x.input.envelope.evidence.scope = "live_bounded_linear_sample", /unsupported value/],
  ["wrong run", x => x.input.envelope.report.runRef = "other-run", /binding_mismatch/],
  ["unresolved report ref", x => x.input.envelope.report.reportRef = "this comment", /binding_mismatch/],
  ["made up aggregate", x => x.input.envelope.object.verdict = "mixed_item_dispositions", /sample_verdict/],
  ["inferred readiness", x => x.input.envelope.operations.readiness = "ready", /not_release/],
  ["production evidence", x => x.input.envelope.evidence.scope = "production", /not_release/],
  ["unknown disposition", x => x.input.productSample.items[0].disposition = "High", /item_disposition/],
  ["scheduled without authority", x => x.input.productSample.items[0].disposition = "scheduled", /requires_authority/],
  ["extra raw provider field", x => x.input.productSample.items[0].description = "raw body", /unexpected_field/],
  ["email in ledger", x => x.input.productSample.items[0].nextRole = "synthetic@example.test", /email_not_allowed/],
  ["outside team", x => x.input.productSample.items[0].id = "OTHER-101", /invalid_or_duplicate/],
  ["foreign URL", x => x.input.productSample.items[0].url = "https://linear.app/foreign/issue/OPT-101", /source_url/],
  ["URL query", x => x.input.productSample.items[0].url += "?credential=synthetic", /source_url/],
  ["duplicate item", x => x.input.productSample.items.push(x.input.productSample.items[0]), /invalid_or_duplicate/],
  ["detail outside sample", x => x.input.productSample.detailIds.push("OPT-999"), /detail_selection/],
  ["missing required updatedAt", x => delete x.input.productSample.items[0].updatedAt, /timestamp/],
  ["fabricated future update", x => x.input.productSample.items[0].updatedAt = "2026-01-02T09:00:00Z", /future_source/],
  ["invalid calendar date", x => x.input.productSample.items[0].updatedAt = "2025-02-30T09:00:00Z", /timestamp/],
  ["duplicate textual envelope", x => x.input.body += " optiak-result-envelope/v1", /duplicate_envelope/],
  ["oversize report", x => x.input.body = "a".repeat(24001), /report_body/],
]) test(`completion rejects ${name}`, () => {
  const data = fixture(); change(data);
  assert.throws(() => prepareCompletion(data.input, data.context, {now}), expected);
});

test("connected evidence enforces comparison time, while fixture dates stay historical", () => {
  const {input, context} = fixture();
  assert.doesNotThrow(() => prepareCompletion(input, context));
  input.envelope.evidence.scope = "connected_non_production";
  assert.doesNotThrow(() => prepareCompletion(input, context, {now}));
  for (const clock of [now + 900001, now - 120000]) assert.throws(() => prepareCompletion(input, context, {now: clock}), /stale_or_future/);
});

function completionApi({commit = true, error, foreign = false, duplicate = false} = {}) {
  const {context} = fixture();
  const issue = {id: context.issueId, companyId: foreign ? "foreign" : context.companyId, assigneeAgentId: context.agentId, status: "in_progress", checkoutRunId: context.runId};
  const comments = [], calls = [];
  const api = async (path, method = "GET", payload) => {
    calls.push({path, method});
    if (method === "PATCH") {
      if (commit) { issue.status = payload.status; comments.push({id: "fixture-comment", createdByRunId: context.runId, body: payload.comment}); if (duplicate) comments.push({...comments[0], id: "duplicate"}); }
      if (error) throw error;
      return {...issue};
    }
    return path.endsWith("/comments") ? structuredClone(comments) : {...issue};
  };
  return {api, calls, comments, issue};
}
test("one combined write, verified persistence, same-run replay is a no-op", async () => {
  const {input, context} = fixture(), mock = completionApi();
  assert.equal((await completeIssue(input, context, mock.api, {now})).wrote, true);
  assert.equal((await completeIssue(input, context, mock.api, {now})).wrote, false);
  assert.equal(mock.calls.filter(c => c.method !== "GET").length, 1);
  assert.equal(mock.comments.length, 1);
});
test("response lost after commit reconciles without repeating the write", async () => {
  const {input, context} = fixture(), mock = completionApi({error: new Error("lost")});
  assert.equal((await completeIssue(input, context, mock.api, {now})).reconciled, true);
  assert.equal(mock.calls.filter(c => c.method === "PATCH").length, 1);
});
test("an exact persisted connected report can be verified after its freshness window", async () => {
  const {input, context} = fixture(), mock = completionApi();
  input.envelope.evidence.scope = "connected_non_production";
  await completeIssue(input, context, mock.api, {now});
  assert.equal((await completeIssue(input, context, mock.api, {now: now + 900001})).wrote, false);
  assert.equal(mock.calls.filter(c => c.method === "PATCH").length, 1);
  const freshMock = completionApi();
  await assert.rejects(completeIssue(input, context, freshMock.api, {now: now + 900001}), /stale_or_future/);
  assert.equal(freshMock.calls.filter(c => c.method === "PATCH").length, 0);
});
test("lost response without persistence fails; never claims success or retries", async () => {
  const {input, context} = fixture(), mock = completionApi({commit: false, error: new Error("lost")});
  await assert.rejects(completeIssue(input, context, mock.api, {now}), /unconfirmed/);
  assert.equal(mock.calls.filter(c => c.method === "PATCH").length, 1);
});
for (const status of [401, 403, 409, 422]) test(`HTTP ${status} never retries a disposition`, async () => {
  const {input, context} = fixture(), mock = completionApi({commit: false, error: Object.assign(new Error("denied"), {status})});
  await assert.rejects(completeIssue(input, context, mock.api, {now}), /denied/);
  assert.equal(mock.calls.length, 3);
});
test("scope and checkout guards prevent writes", async () => {
  for (const mismatch of ["company", "lease", "closed"]) {
    const {input, context} = fixture(), mock = completionApi({foreign: mismatch === "company"});
    if (mismatch === "lease") mock.issue.checkoutRunId = "another-run";
    if (mismatch === "closed") mock.issue.status = "done";
    await assert.rejects(completeIssue(input, context, mock.api, {now}));
    assert.equal(mock.calls.filter(c => c.method === "PATCH").length, 0);
  }
});
test("duplicate canonical reports and changed replay body fail closed", async () => {
  const {input, context} = fixture(), duplicate = completionApi({duplicate: true});
  await assert.rejects(completeIssue(input, context, duplicate.api, {now}), /duplicate_run_reports/);
  const mock = completionApi(); await completeIssue(input, context, mock.api, {now});
  input.body += " changed";
  await assert.rejects(completeIssue(input, context, mock.api, {now}), /existing_report_differs/);
});
test("API client preserves bridge path, blocks redirects, and passes run header", async () => {
  let request;
  const api = createApi({baseUrl: "http://localhost:3100/run-bridge/api", token: "synthetic", runId: "fixture-run"}, async (url, options) => { request = {url, options}; return {ok: true, json: async () => ({ok: true})}; });
  await api("/issues/fixture-issue", "PATCH", {status: "done"});
  assert.equal(request.url, "http://localhost:3100/run-bridge/api/issues/fixture-issue");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers["X-Paperclip-Run-Id"], "fixture-run");
});

function linearFixture() {
  const catalog = loadBaseline().tools.map(t => ({...t, reviewedAt: "2026-01-01T09:00:00Z", status: "active", riskLevel: "read", isReadOnly: true, isWrite: false, isDestructive: false}));
  catalog.push({toolName: "get_notifications", status: "active", reviewedAt: null});
  const tools = catalog.map(t => ({toolName: t.toolName, risk: "read", decision: t.toolName === "get_notifications" ? "off" : "allowed"}));
  return {schema: "optiak-linear-preflight/v1", observedAt: "2026-01-01T10:00:00Z", connection: {endpoint: "https://mcp.linear.app/mcp/readonly", transportEndpoint: "https://mcp.linear.app/mcp/readonly", quarantineNewEntries: true, transportQuarantineNewEntries: true, status: "active", enabled: true, healthStatus: "ok", healthCheckedAt: "2026-01-01T10:00:00Z", lastCatalogRefreshAt: "2026-01-01T10:00:00Z"}, profileDefaultAction: "deny", installs: [{productOnly: true}], catalog, audience: [{isProduct: true, tools}, {isProduct: false, tools: tools.map(t => ({...t, decision: "off"}))}]};
}
test("reviewed reads stay allowed while discovered notifications stay off", () => {
  const result = evaluateLinearSnapshot(linearFixture(), loadBaseline(), {now});
  assert.equal(result.status, "ready_for_bounded_read");
  assert.equal(result.productAllowedCount, 38);
  assert.deepEqual(result.newToolNames, ["get_notifications"]);
});
test("truly quarantined new tools need not appear in the effective gateway catalog", () => {
  const snapshot = linearFixture();
  snapshot.catalog.at(-1).status = "quarantined";
  snapshot.catalog.at(-1).quarantinedAt = "2026-01-01T10:00:00Z";
  for (const agent of snapshot.audience) agent.tools.pop();
  const result = evaluateLinearSnapshot(snapshot, loadBaseline(), {now});
  assert.equal(result.status, "ready_for_bounded_read");
  assert.equal(result.quarantinedOrExcludedCount, 1);
  assert.equal(result.productAllowedCount, 38);
});
for (const [name, change, expected] of [
  ["auto inclusion", x => x.connection.quarantineNewEntries = false, "automatic_catalog_inclusion"],
  ["transport drift", x => x.connection.transportQuarantineNewEntries = false, "automatic_catalog_inclusion"],
  ["endpoint broadened", x => x.connection.endpoint = "https://mcp.linear.app/mcp", "endpoint_mismatch"],
  ["new tool granted", x => x.audience[0].tools.at(-1).decision = "allowed", "unreviewed_tool_access"],
  ["schema drift", x => x.catalog[0].schemaHash = "changed", "catalog_hash_drift"],
  ["description drift", x => x.catalog[0].versionHash = "changed", "catalog_hash_drift"],
  ["write disguised", x => x.catalog[0].isWrite = true, "unreviewed_or_unsafe_entry"],
  ["missing review", x => x.catalog[0].reviewedAt = null, "unreviewed_or_unsafe_entry"],
  ["foreign audience", x => x.audience[1].tools[0].decision = "allowed", "non_product_access"],
  ["company install", x => x.installs[0].productOnly = false, "installation_scope_expanded"],
  ["broad default", x => x.profileDefaultAction = "allow", "profile_default_not_deny"],
  ["missing effective tool", x => x.audience[0].tools.pop(), "incomplete_effective_access"],
  ["stale health", x => x.connection.healthCheckedAt = "2025-01-01T00:00:00Z", "health_stale_or_missing"],
]) test(`Linear preflight blocks ${name}`, () => {
  const x = linearFixture(); change(x);
  const result = evaluateLinearSnapshot(x, loadBaseline(), {now});
  assert.equal(result.status, "blocked"); assert(result.errors.includes(expected));
});
test("collector aborts before catalog read when automatic inclusion is enabled", async () => {
  const calls = [];
  await assert.rejects(collectLinearSnapshot(async path => { calls.push(path); return {companyId: "fixture-company", config: {quarantineNewEntries: false}}; }, {companyId: "fixture-company", connectionId: "fixture-connection", productAgentId: "fixture-product"}), /unsafe_connection/);
  assert.equal(calls.length, 1);
});

function qaApi() {
  const docs = new Map(), calls = [];
  const issue = {id: "fixture-issue", companyId: "fixture-company", identifier: "OPT-101", status: "done", assigneeAgentId: "fixture-agent", assigneeUserId: null};
  const api = async (path, method = "GET", body) => {
    calls.push({path, method});
    if (path.endsWith("/live-runs")) return [];
    if (path.endsWith("/comments")) return [{id: "fixture-comment", createdByRunId: "fixture-run"}];
    if (path.includes("/documents/")) { if (method === "PUT") docs.set(path, {id: "fixture-document", ...body}); if (!docs.has(path)) throw Object.assign(new Error("not_found"), {status: 404}); return docs.get(path); }
    return {...issue};
  };
  return {api, calls, docs, issue};
}
const note = {companyId: "fixture-company", issueId: "fixture-issue", reportId: "fixture-comment", body: "QA checked this synthetic report; no continuation requested."};
test("QA uses an immutable document, preserves done and emits no comment on repeat", async () => {
  const mock = qaApi();
  assert.equal((await recordQaNote(note, mock.api)).wrote, true);
  assert.equal((await recordQaNote(note, mock.api)).wrote, false);
  assert.equal(mock.docs.size, 1);
  assert.equal(mock.calls.filter(c => c.method !== "GET").length, 1);
  assert(mock.calls.filter(c => c.method !== "GET").every(c => c.method === "PUT" && c.path.includes("/documents/qa-")));
});
test("QA refuses foreign, active or unbound targets without writes", async () => {
  for (const variant of ["foreign", "active", "unbound"]) {
    const mock = qaApi();
    if (variant === "foreign") mock.issue.companyId = "other";
    if (variant === "active") mock.issue.status = "in_progress";
    await assert.rejects(recordQaNote({...note, ...(variant === "unbound" ? {reportId: "other-report"} : {})}, mock.api));
    assert.equal(mock.calls.filter(c => c.method !== "GET").length, 0);
  }
});
