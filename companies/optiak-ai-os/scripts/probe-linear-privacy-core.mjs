#!/usr/bin/env node
// Optional repo integration probe: synthetic data, actual Paperclip guard,
// isolated in-memory SQLite sink. Never connects to a Paperclip instance or DB.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {createProjectedLinearReader} from "../connectors/linear-privacy/projection.mjs";
import {loadBaseline} from "./linear-preflight.mjs";

if (process.argv.length !== 4 || process.argv[2] !== "--paperclip-root") throw new Error("Usage: probe-linear-privacy-core.mjs --paperclip-root REPO");
const root = resolve(process.argv[3]);
const {validateToolContent} = await import(pathToFileURL(resolve(root, "server/src/services/tool-content-guards.ts")));
const fixture = JSON.parse(readFileSync(new URL("../connectors/linear-privacy/fixture.json", import.meta.url)));
const baseline = loadBaseline();
const raw = {content: [{type: "text", text: JSON.stringify({issues: [fixture.issue], hasNextPage: false})}]};
// Mirrors the normalization boundary in tool-gateway.ts, not a replacement for it.
function normalize(mcp) {
  return {content: mcp.content.map(c => c.text).join("\n"), data: {content: mcp.content, structuredContent: mcp.structuredContent ?? null, isError: mcp.isError === true, transport: "mcp_http", spawnedLocalProcess: false}, ...(mcp.isError ? {error: "MCP tool returned an error result"} : {})};
}
const guard = value => validateToolContent({value, direction: "result", sensitiveMode: "redact", promptInjectionMode: "block"});
const control = guard(normalize(raw));
assert.ok(JSON.stringify(control).includes("PERSON_CANARY"), "Baseline changed: re-evaluate whether this projection remains necessary");
const invoke = createProjectedLinearReader({
  now: () => fixture.retrievedAt,
  getCatalogEntry: async toolName => ({...baseline.tools.find(t => t.toolName === toolName), status: "active", reviewedAt: fixture.retrievedAt, isReadOnly: true, isWrite: false, isDestructive: false, riskLevel: "read"}),
  dispatch: async () => JSON.stringify(raw),
});
const receipt = await invoke("list_issues", {team: "OPT", state: "unstarted", limit: 5, orderBy: "updatedAt"});
assert.equal(receipt.mcpResult.isError, false);
const projected = guard(normalize(receipt.mcpResult));
const sinks = {
  agent_result: projected.value,
  invocation_result_summary: projected.summary,
  tool_call_event: {eventType: "call_completed", policyDecision: "allow", resultSummary: projected.summary},
  activity_event: {action: "tool_gateway.call_completed", resultSummary: projected.summary},
  projection_receipt: receipt.audit,
};
const db = new DatabaseSync(":memory:"); // No filesystem or instance DB access.
try {
  db.exec("CREATE TABLE privacy_probe (kind text PRIMARY KEY, payload text NOT NULL CHECK(json_valid(payload)))");
  const insert = db.prepare("INSERT INTO privacy_probe VALUES (?, ?)");
  for (const [kind, payload] of Object.entries(sinks)) insert.run(kind, JSON.stringify(payload));
  const rows = db.prepare("SELECT kind, payload FROM privacy_probe ORDER BY kind").all();
  assert.equal(rows.length, 5);
  for (const row of rows) {
    for (const canary of fixture.canaries) assert.ok(!row.payload.includes(canary), `canary in ${row.kind}`);
    assert.deepEqual(JSON.parse(row.payload), sinks[row.kind]);
  }
  console.log(JSON.stringify({status: "verified", evidenceScope: "fixture_only", actualPaperclipContentGuard: true, sink: "isolated_in_memory_sqlite", canariesExcluded: fixture.canaries.length, sinksChecked: rows.length, instanceChanged: false, liveProtectionEstablished: false}));
} finally { db.close(); }
