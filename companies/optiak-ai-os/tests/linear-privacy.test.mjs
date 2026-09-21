import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {CONTRACT, normalizeRequest, projectLinearMcpResult, createProjectedLinearReader} from "../connectors/linear-privacy/projection.mjs";
import {loadBaseline} from "../scripts/linear-preflight.mjs";

const fixture = JSON.parse(readFileSync(new URL("../connectors/linear-privacy/fixture.json", import.meta.url)));
const listArgs = {team: "OPT", state: "unstarted", limit: 5, orderBy: "updatedAt"};
const wire = (data, extra = {}) => JSON.stringify({content: [{type: "text", text: JSON.stringify(data)}], ...extra});
const issue = () => structuredClone(fixture.issue);
const project = (data, options = {}) => projectLinearMcpResult({toolName: "get_issue", arguments: {id: "OPT-101"}, retrievedAt: fixture.retrievedAt, wireText: wire(data), ...options});
function noCanaries(value) { const text = JSON.stringify(value); for (const c of fixture.canaries) assert.ok(!text.includes(c), `leaked ${c}`); }
function setup(overrides = {}) {
  const calls = [];
  const baseline = loadBaseline();
  const invoke = createProjectedLinearReader({
    now: () => fixture.retrievedAt,
    getCatalogEntry: async name => ({...baseline.tools.find(t => t.toolName === name), status: "active", reviewedAt: fixture.retrievedAt, quarantinedAt: null, riskLevel: "read", isReadOnly: true, isWrite: false, isDestructive: false}),
    dispatch: async call => { calls.push(call); return wire(call.toolName === "get_team" ? {key: "OPT", name: "PERSON_CANARY"} : call.toolName === "list_issues" ? {issues: [issue()], hasNextPage: true, cursor: "TOKEN_CANARY"} : issue()); },
    ...overrides,
  });
  return {invoke, calls};
}
const value = result => JSON.parse(result.mcpResult.content[0].text);

test("metadata projection excludes people, narrative, slugs, resources and unknown fields", () => {
  const result = project(issue());
  noCanaries(result);
  assert.equal(result.schema, CONTRACT);
  assert.equal(result.semanticReviewAvailable, false);
  assert.equal(result.evidenceScope, "not_established_by_projection");
  assert.deepEqual(result.issue, {identifier: "OPT-101", url: "https://linear.app/optiak/issue/OPT-101", updatedAt: "2026-01-01T09:00:00.000Z", statusClass: "unstarted", priority: 2});
});
test("unknown status text and missing priority/time are explicit unknowns, not copied", () => {
  const raw = issue(); raw.status = "person-canary@example.invalid"; delete raw.priority; delete raw.updatedAt;
  const result = project(raw); noCanaries(result);
  assert.equal(result.issue.statusClass, "unknown"); assert.equal(result.issue.priority, null); assert.equal(result.issue.updatedAt, null);
});
test("reordered equivalent structured content accepted; provider metadata excluded", () => {
  const raw = issue(); const reordered = Object.fromEntries(Object.entries(raw).reverse());
  noCanaries(project(raw, {wireText: wire(raw, {structuredContent: reordered, _meta: {person: "PERSON_CANARY"}})}));
});
for (const [name, change] of [
  ["foreign workspace", r => { r.url = "https://linear.app/foreign/issue/OPT-101/private"; }],
  ["foreign team", r => { r.team.key = "OTHER"; }],
  ["wrong exact id", r => { r.identifier = "OPT-102"; r.url = "https://linear.app/optiak/issue/OPT-102/private"; }],
  ["foreign identifier", r => { r.identifier = "OTHER-101"; }],
  ["URL credentials", r => { r.url = "https://PERSON_CANARY@linear.app/optiak/issue/OPT-101"; }],
  ["URL query", r => { r.url += "?contact=person-canary@example.invalid"; }],
  ["URL fragment", r => { r.url += "#PERSON_CANARY"; }],
  ["bad date", r => { r.updatedAt = "2026-02-30T00:00:00Z"; }],
  ["future date", r => { r.updatedAt = "2027-01-01T00:00:00Z"; }],
  ["priority narrative", r => { r.priority = "PERSON_CANARY"; }],
  ["priority outside range", r => { r.priority = 8; }],
]) test(`projection rejects ${name}`, () => { const raw = issue(); change(raw); assert.throws(() => project(raw)); });

for (const [name, raw] of [
  ["provider error body", wire(issue(), {isError: true})],
  ["nonboolean error flag", wire(issue(), {isError: "false"})],
  ["ambiguous structured content", wire(issue(), {structuredContent: {person: "PERSON_CANARY"}})],
  ["already audited Paperclip wrapper", JSON.stringify({content: "{}", data: {person: "PERSON_CANARY"}})],
  ["resource", JSON.stringify({content: [{type: "resource", resource: {text: "PERSON_CANARY"}}]})],
  ["multiple content blocks", JSON.stringify({content: [{type: "text", text: "{}"}, {type: "text", text: "PERSON_CANARY"}]})],
  ["invalid JSON", "PERSON_CANARY"],
  ["oversized response", "X".repeat(262145)],
  ["non JSON text", JSON.stringify({content: [{type: "text", text: "PERSON_CANARY"}]})],
]) test(`wrapper rejects ${name} with a safe diagnostic`, async () => {
  const {invoke} = setup({dispatch: async () => raw});
  const result = await invoke("list_issues", listArgs); assert.equal(result.mcpResult.isError, true); noCanaries(result);
  assert.equal(result.audit.request.team, "OPT");
});
for (const [name, tool, args] of [
  ["mutation", "update_issue", {id: "OPT-101"}],
  ["new tool", "get_notifications", {}],
  ["free-text search", "list_issues", {...listArgs, query: "person-canary@example.invalid"}],
  ["cursor", "list_issues", {...listArgs, cursor: "TOKEN_CANARY"}],
  ["PII fields", "get_issue", {id: "OPT-101", includeCustomerNeeds: true}],
  ["unbounded count", "list_issues", {...listArgs, limit: 100}],
  ["foreign team", "get_team", {query: "PERSON_CANARY"}],
]) test(`request rejects ${name} before catalog or dispatch`, async () => {
  let touched = 0; const {invoke} = setup({getCatalogEntry: async () => { touched++; }, dispatch: async () => { touched++; }});
  const result = await invoke(tool, args); assert.equal(result.mcpResult.isError, true); assert.equal(touched, 0); noCanaries(result);
  assert.equal(result.audit.request, null);
});
test("metadata-only read receipts serialize without any raw hashes or canaries", async () => {
  const {invoke, calls} = setup();
  const first = await invoke("list_issues", listArgs);
  const detail = await invoke("get_issue", {id: "OPT-101"});
  for (const r of [first, detail]) {
    assert.equal(r.mcpResult.isError, false); noCanaries(r);
    assert.equal(r.audit.projectedSha256, createHash("sha256").update(r.mcpResult.content[0].text).digest("hex"));
    assert.equal(r.audit.projectedBytes, Buffer.byteLength(r.mcpResult.content[0].text));
  }
  assert.equal(value(first).hasMore, true); assert.ok(!("cursor" in value(first)));
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].arguments, {id: "OPT-101"});
});
test("exact detail must be in this session's sample; duplicate groups/details denied", async () => {
  const {invoke, calls} = setup();
  assert.equal(value(await invoke("get_issue", {id: "OPT-101"})).error, "detail_scope_denied");
  await invoke("list_issues", listArgs);
  assert.equal(value(await invoke("list_issues", listArgs)).error, "duplicate_group_denied");
  assert.equal(value(await invoke("get_issue", {id: "OPT-999"})).error, "detail_scope_denied");
  await invoke("get_issue", {id: "OPT-101"});
  assert.equal(value(await invoke("get_issue", {id: "OPT-101"})).error, "detail_scope_denied");
  assert.equal(calls.length, 2);
});
test("six-call budget and three-detail budget enforced without extra dispatch", async () => {
  let calls = 0;
  const {invoke} = setup({dispatch: async ({toolName, arguments: args}) => {
    calls++;
    const item = id => ({...issue(), identifier: id, url: `https://linear.app/optiak/issue/${id}`});
    return wire(toolName === "get_team" ? {key: "OPT"} : toolName === "get_issue" ? item(args.id) : {issues: [101, 102, 103, 104].map(n => ({...item(`OPT-${n}`), status: args.state === "started" ? "In Progress" : "Todo"}))});
  }});
  await invoke("get_team", {query: "OPT"}); await invoke("list_issues", listArgs);
  for (const id of [101, 102, 103]) assert.equal((await invoke("get_issue", {id: `OPT-${id}`})).mcpResult.isError, false);
  assert.equal(value(await invoke("get_issue", {id: "OPT-104"})).error, "detail_scope_denied");
  await invoke("list_issues", {...listArgs, state: "started"});
  assert.equal(value(await invoke("get_team", {query: "OPT"})).error, "call_budget_exhausted");
  assert.equal(calls, 6);
});
test("catalog drift denies dispatch and permanently closes this reader", async () => {
  const {invoke, calls} = setup({getCatalogEntry: async () => ({schemaHash: "changed"})});
  assert.equal(value(await invoke("list_issues", listArgs)).error, "catalog_drift_denied");
  assert.equal(value(await invoke("get_team", {query: "OPT"})).error, "session_disabled"); assert.equal(calls.length, 0);
});
test("upstream exceptions never expose message, stack, cause or response", async () => {
  const {invoke} = setup({dispatch: async () => { throw new Error(fixture.canaries.join(" "), {cause: issue()}); }});
  const result = await invoke("list_issues", listArgs); noCanaries(result); assert.equal(value(result).error, "upstream_or_contract_failure");
});
test("deadline bounds a hung callback and prevents late mutation or replay", async () => {
  let signal, resolve;
  const {invoke} = setup({timeoutMs: 15, dispatch: input => { signal = input.signal; return new Promise(r => {resolve = r;}); }});
  const result = await invoke("list_issues", listArgs); assert.equal(value(result).error, "upstream_timeout"); assert.equal(signal.aborted, true);
  resolve(wire({issues: [issue()]})); await new Promise(r => setImmediate(r));
  assert.equal(value(await invoke("get_issue", {id: "OPT-101"})).error, "session_disabled");
});
test("overlapping calls cannot bypass the single in-flight slot", async () => {
  let release; const {invoke} = setup({dispatch: () => new Promise(r => { release = r; })});
  const first = invoke("get_team", {query: "OPT"}); await new Promise(r => setImmediate(r));
  assert.equal(value(await invoke("get_team", {query: "OPT"})).error, "concurrent_call_denied");
  release(wire({key: "OPT"})); assert.equal((await first).mcpResult.isError, false);
});
test("mixed-tenant batch rejected entirely, never silently drops offending rows", async () => {
  const other = issue(); other.url = "https://linear.app/other/issue/OPT-101";
  const {invoke} = setup({dispatch: async () => wire({issues: [issue(), other]})});
  const result = await invoke("list_issues", listArgs); assert.equal(result.mcpResult.isError, true); noCanaries(result); assert.ok(!("issues" in value(result)));
});
test("oversize, duplicate, invalid pagination and deeply nested batches rejected", () => {
  for (const raw of [{issues: Array(6).fill(issue())}, {issues: [issue(), issue()]}, {issues: [issue()], hasNextPage: "PERSON_CANARY"}, {unexpected: []}]) {
    assert.throws(() => project(raw, {toolName: "list_issues", arguments: listArgs}));
  }
  let nested = {}; for (let i = 0; i < 20; i++) nested = {nested};
  assert.throws(() => project({...issue(), nested}));
});
test("unknown provider fields do not change the projected digest", () => {
  const first = project(issue()); const second = project({...issue(), extra: {deep: {person: "NEW_PRIVATE_CANARY"}}});
  assert.deepEqual(first, second);
});
test("request getters and extra prototype payloads cannot be serialized to audit", () => {
  assert.throws(() => normalizeRequest("get_issue", Object.defineProperty({}, "id", {get() { throw Error("PERSON_CANARY"); }})));
  assert.throws(() => normalizeRequest("get_issue", Object.assign(Object.create({secret: "PERSON_CANARY"}), {id: "OPT-101"})));
});
test("Proxy state is read once so audit cannot gain an unvalidated second value", async () => {
  let reads = 0;
  const args = new Proxy(listArgs, {get(target, key) { return key === "state" ? (++reads === 1 ? "unstarted" : "PERSON_CANARY") : target[key]; }});
  const {invoke} = setup(); const result = await invoke("list_issues", args);
  assert.equal(result.mcpResult.isError, false); noCanaries(result); assert.equal(reads, 1);
});
test("a callback cannot leak a mutated validation exception into reason codes", async () => {
  let error; try { normalizeRequest("unknown", {}); } catch (e) { error = e; }
  error.message = "PERSON_CANARY";
  const {invoke} = setup({dispatch: async () => { throw error; }});
  const result = await invoke("list_issues", listArgs); noCanaries(result); assert.equal(value(result).error, "upstream_or_contract_failure");
});
test("archived or known wrong-state rows fail the entire requested group", async () => {
  for (const patch of [{archivedAt: "2025-01-01T00:00:00Z"}, {status: "Done"}, {status: "In Progress"}]) {
    const {invoke} = setup({dispatch: async () => wire({issues: [{...issue(), ...patch}]})});
    const result = await invoke("list_issues", listArgs); assert.equal(result.mcpResult.isError, true); noCanaries(result);
  }
});
