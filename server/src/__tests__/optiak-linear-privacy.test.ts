import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeOptiakLinearRequest, parseOptiakLinearPrivacyBinding, projectOptiakLinearResult, readOptiakLinearResponse } from "../services/optiak-linear-privacy.js";

const fixture = JSON.parse(readFileSync(new URL("../../../companies/optiak-ai-os/connectors/linear-privacy/fixture.json", import.meta.url), "utf8"));
const args = { team: "OPT", state: "unstarted", limit: 5, orderBy: "updatedAt" };
const now = Date.parse(fixture.retrievedAt);
const mcp = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const project = (result: unknown) => projectOptiakLinearResult("list_issues", args, result, now);

describe("Optiak Linear operator binding", () => {
  it("defaults off and clones validated scope", () => {
    expect(parseOptiakLinearPrivacyBinding(undefined)).toBeUndefined();
    const binding = { companyId: randomUUID(), connectionId: randomUUID(), tools: Object.fromEntries(
      ["get_team", "get_issue", "list_issues"].map(name => [name, { schemaHash: "a".repeat(64), versionHash: "b".repeat(64) }])) };
    expect(parseOptiakLinearPrivacyBinding(JSON.stringify(binding))).toEqual(binding);
  });
  it.each([" ", "null", "{}", "[]", '{"token":"PERSON_CANARY"}'])("fails closed without echoing invalid config: %s", value => {
    expect(() => parseOptiakLinearPrivacyBinding(value)).toThrow("Invalid PAPERCLIP_OPTIAK_LINEAR_PRIVACY configuration");
  });
});
describe("Optiak Linear metadata projection", () => {
  it("bounds streaming bodies even with missing or false Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(65536)); },
      cancel() { cancelled = true; },
    });
    await expect(readOptiakLinearResponse(new Response(body, { headers: { "content-length": "1" } }))).rejects.toThrow("metadata boundary rejected");
    expect(cancelled).toBe(true);
  });
  it("rejects invalid UTF-8 without reflecting bytes", async () => {
    await expect(readOptiakLinearResponse(new Response(new Uint8Array([255, 255])))).rejects.toThrow("metadata boundary rejected");
  });
  it("matches the portable offline contract and excludes all synthetic canaries", async () => {
    const raw = mcp({ issues: [fixture.issue], hasNextPage: true });
    const projected = project(raw);
    for (const canary of fixture.canaries) expect(JSON.stringify(projected)).not.toContain(canary);
    // Dynamic test-only import; the production server never depends on companies/.
    const candidatePath = new URL("../../../companies/optiak-ai-os/connectors/linear-privacy/projection.mjs", import.meta.url).href;
    const { projectLinearMcpResult } = await import(candidatePath);
    expect(JSON.parse(projected.content[0].text)).toEqual(projectLinearMcpResult({
      toolName: "list_issues", arguments: args, wireText: JSON.stringify(raw), retrievedAt: fixture.retrievedAt,
    }));
  });
  it.each([
    ["delete_issue", { id: "OPT-1" }], ["list_issues", { ...args, cursor: "PERSON_CANARY" }],
    ["list_issues", { ...args, limit: 100 }], ["list_issues", { ...args, team: "OTHER" }],
    ["get_issue", { id: "OTHER-1" }], ["get_team", { query: "PERSON_CANARY" }],
  ])("denies expanded request %s", (tool, params) => {
    expect(() => normalizeOptiakLinearRequest(tool as string, params)).toThrow("metadata boundary rejected");
  });
  it.each([
    { ...mcp({ issues: [fixture.issue] }), isError: true },
    { ...mcp({ issues: [fixture.issue] }), structuredContent: { issues: [] } },
    { content: [{ type: "resource", resource: { text: "PERSON_CANARY" } }] },
    { content: [{ type: "text", text: "PERSON_CANARY" }] },
    mcp({ issues: Array(6).fill(fixture.issue) }),
    mcp({ issues: [fixture.issue, fixture.issue] }),
    mcp({ issues: [{ ...fixture.issue, url: "https://linear.app/other/issue/OPT-101" }] }),
    mcp({ issues: [{ ...fixture.issue, updatedAt: "2099-01-01T00:00:00Z" }] }),
    mcp({ issues: [{ ...fixture.issue, archivedAt: "2026-01-01T00:00:00Z" }] }),
    mcp({ issues: [{ ...fixture.issue, status: "Done" }] }),
    mcp({ issues: [{ ...fixture.issue, priority: "PERSON_CANARY" }] }),
    mcp({ issues: [], extra: "x".repeat(262144) }),
  ])("returns only a fixed error for unsafe response %#", result => {
    expect(() => project(result)).toThrow("Optiak Linear metadata boundary rejected the call");
  });
  it("drops custom status labels without inventing their semantic mapping", () => {
    expect(JSON.parse(project(mcp({ issues: [{ ...fixture.issue, status: "PERSON_CANARY" }] })).content[0].text).issues[0].statusClass).toBe("unknown");
  });
});
