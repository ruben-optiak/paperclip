import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, companyMemberships, createDb, connectionGrants, toolApplications, toolConnections, toolCatalogEntries,
  toolPolicies, toolProfiles, toolProfileEntries, toolProfileBindings, toolInvocations, toolCallEvents,
  toolAccessAuditEvents, heartbeatRunEvents, activityLog, issueThreadInteractions } from "@paperclipai/db";
import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import { heartbeatService } from "../services/heartbeat.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
import { OPTIAK_LINEAR_ENDPOINT, type OptiakLinearPrivacyBinding } from "../services/optiak-linear-privacy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Linear privacy through a real process heartbeat", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService> | undefined;
  let server: Server | undefined, provider: Server | undefined;
  let scratch: string;
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "optiak-linear-heartbeat-"));
    vi.stubEnv("RUN_LOG_BASE_PATH", join(scratch, "run-logs"));
    vi.stubEnv("RUN_LOG_S3_BUCKET", "");
    vi.stubEnv("PAPERCLIP_HOME", join(scratch, "paperclip"));
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "synthetic-linear");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "synthetic-linear-heartbeat-secret");
    tempDb = await startEmbeddedPostgresTestDatabase("optiak-linear-heartbeat-db-");
    db = createDb(tempDb.connectionString);
  }, 20_000);
  afterAll(async () => {
    await heartbeat?.drainActiveRunExecutions();
    for (const listener of [server, provider]) if (listener) await new Promise<void>((resolve, reject) => listener.close(err => err ? reject(err) : resolve()));
    await tempDb?.cleanup();
    vi.unstubAllEnvs();
  });
  async function listen(listener: Server) {
    await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address();
    if (!address || typeof address === "string") throw Error("Synthetic address unavailable");
    return `http://127.0.0.1:${address.port}`;
  }
  it("keeps provider canaries out of the response, audit, heartbeat events and durable run log", async () => {
    const canaries = ["PERSON_CANARY", "person-canary@example.invalid", "PHONE_CANARY", "ADDRESS_CANARY", "TOKEN_CANARY", "ATTACHMENT_CANARY"];
    const [company] = await db.insert(companies).values({ name: "Synthetic Optiak", issuePrefix: "SYN",
      defaultResponsibleUserId: "synthetic-board", requireBoardApprovalForNewAgents: false }).returning();
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: "synthetic-board", status: "active" });
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Synthetic process", role: "engineer", status: "idle", adapterType: "process" }).returning();
    const [application] = await db.insert(toolApplications).values({ companyId: company.id, applicationKey: "synthetic-linear", name: "Synthetic Linear", type: "mcp_http" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: company.id, applicationId: application.id,
      name: "Synthetic Linear", uid: randomUUID(), transport: "mcp_remote", enabled: true, status: "active", healthStatus: "ok",
      config: { url: OPTIAK_LINEAR_ENDPOINT } }).returning();
    await db.insert(connectionGrants).values({ companyId: company.id, connectionId: connection.id, kind: "organization", status: "active", isDefault: true });
    const names = ["get_team", "list_issues", "get_issue"];
    const catalog = await db.insert(toolCatalogEntries).values(names.map(name => ({ companyId: company.id, applicationId: application.id,
      connectionId: connection.id, name, toolName: name, entryKind: "tool" as const, riskLevel: "read" as const, status: "active" as const,
      reviewedAt: new Date(), isReadOnly: true, isWrite: false, isDestructive: false, schemaHash: "a".repeat(64), versionHash: "b".repeat(64) }))).returning();
    await db.insert(toolPolicies).values({ companyId: company.id, name: "Synthetic reads", policyType: "allow", selectors: { riskLevel: "read" } });
    const [profile] = await db.insert(toolProfiles).values({ companyId: company.id, profileKey: "synthetic-linear", name: "Synthetic reads", defaultAction: "deny" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: company.id, profileId: profile.id, targetType: "agent", targetId: agent.id });
    await db.insert(toolProfileEntries).values(catalog.map(entry => ({ companyId: company.id, profileId: profile.id,
      selectorType: "catalog_entry" as const, effect: "include" as const, catalogEntryId: entry.id })));
    const binding: OptiakLinearPrivacyBinding = { companyId: company.id, connectionId: connection.id,
      tools: Object.fromEntries(names.map(name => [name, { schemaHash: "a".repeat(64), versionHash: "b".repeat(64) }])) as OptiakLinearPrivacyBinding["tools"] };
    let upstreamCalls = 0;
    provider = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const call = JSON.parse(Buffer.concat(chunks).toString()); upstreamCalls++;
      const issue = (id: string, started = false) => ({ identifier: id, url: `https://linear.app/optiak/issue/${id}/PERSON_CANARY`,
        status: started ? "In Progress" : "Todo", priority: 2, updatedAt: "2026-01-01T00:00:00Z", description: canaries.join(" ") });
      const args = call.params.arguments;
      const data = call.params.name === "get_team" ? { key: "OPT", name: canaries.join(" ") }
        : call.params.name === "get_issue" ? issue(args.id)
          : { issues: Array.from({ length: 5 }, (_, i) => issue(`OPT-${(args.state === "started" ? 101 : 201) + i}`, args.state === "started")) };
      res.setHeader("content-type", "application/json; synthetic=PERSON_CANARY");
      res.setHeader("x-request-id", "TOKEN_CANARY");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } }));
    });
    const providerOrigin = await listen(provider);
    const gateway = createToolGatewayService(db, { optiakLinearPrivacy: binding, toolActionSigningSecret: "synthetic-signing-secret",
      remoteHttpRequest: async (url, init) => { expect(url).toBe(OPTIAK_LINEAR_ENDPOINT); return fetch(providerOrigin, init); } });
    const named = await gateway.createNamedGateway({ companyId: company.id, body: { name: "Synthetic run gateway", profileId: profile.id,
      agentId: agent.id, defaultProfileMode: "gateway_only" } });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(gateway));
    // Test-only credential delivery: verifies the real heartbeat JWT before
    // minting the normal short-lived, run-bound MCP token. Not a product route.
    const mintedTokens: string[] = [];
    app.get("/fixture/runtime", async (req, res) => {
      const claims = verifyLocalAgentJwt(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
      if (!claims || claims.company_id !== company.id || claims.sub !== agent.id) { res.sendStatus(401); return; }
      const token = await gateway.createNamedGatewayToken({ companyId: company.id, gatewayId: named.id,
        body: { name: "Synthetic run", subjectType: "heartbeat_run", subjectId: claims.run_id, clientLabel: "Synthetic process",
          ownerNote: "Synthetic proof only", allowedActions: ["tools/list", "tools/call"], expiresAt: new Date(Date.now() + 60_000) }, actor: { agentId: agent.id } });
      mintedTokens.push(token.token);
      const session = await gateway.createSession({ companyId: company.id, agentId: agent.id, runId: claims.run_id });
      const tools = (await gateway.listToolsForSession(session.token)).filter(t => t.connectionId === connection.id);
      res.json({ endpoint: `/mcp/gateways/${named.gatewayPublicId}`, token: token.token,
        tools: Object.fromEntries(tools.map(t => [t.upstreamToolName!, t.name])) });
    });
    server = createServer(app); const origin = await listen(server);
    const runless = await gateway.createNamedGatewayToken({ companyId: company.id, gatewayId: named.id, body: {
      name: "Synthetic unbound client", clientLabel: "Synthetic", ownerNote: "Negative test", allowedActions: ["tools/list", "tools/call"],
      expiresAt: new Date(Date.now() + 60_000) } });
    const listing = await fetch(`${origin}/mcp/gateways/${named.gatewayPublicId}`, { method: "POST",
      headers: { authorization: `Bearer ${runless.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then(r => r.json());
    const getTeam = listing.result.tools.find((t: { title?: string }) => t.title === "get_team");
    expect(getTeam).toBeDefined();
    const noRunCall = await fetch(`${origin}/mcp/gateways/${named.gatewayPublicId}`, { method: "POST",
      headers: { authorization: `Bearer ${runless.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: getTeam.name, arguments: { query: "OPT" } } }) });
    expect(noRunCall.status).toBe(403); expect(upstreamCalls).toBe(0);
    await gateway.revokeNamedGatewayToken({ companyId: company.id, tokenId: runless.id });
    mintedTokens.push(runless.token);
    await db.update(agents).set({ adapterConfig: { command: process.execPath, cwd: scratch, timeoutSec: 30,
      args: [fileURLToPath(new URL("./fixtures/optiak-linear-process-agent.mjs", import.meta.url)), origin] } }).where(eq(agents.id, agent.id));
    heartbeat = heartbeatService(db);
    const queued = await heartbeat.invoke(agent.id, "on_demand", {}, "manual");
    expect(queued).toBeDefined();
    const deadline = Date.now() + 30_000;
    let finished = await heartbeat.getRun(queued!.id);
    while (finished && ["running", "queued"].includes(finished.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50)); finished = await heartbeat.getRun(queued!.id);
    }
    await heartbeat.drainActiveRunExecutions();
    expect(finished?.status, JSON.stringify({ result: finished?.resultJson, upstreamCalls,
      invocations: await db.select().from(toolInvocations), events: await db.select().from(toolCallEvents) })).toBe("succeeded");
    expect(finished?.stdoutExcerpt).toContain("SYNTHETIC_LINEAR_SAMPLE_PASSED");
    expect(upstreamCalls).toBe(6);
    expect(finished?.logRef).toBeTruthy();
    const runLog = await readFile(join(scratch, "run-logs", finished!.logRef!), "utf8");
    const sinks = { run: finished, runLog, runEvents: await db.select().from(heartbeatRunEvents),
      invocations: await db.select().from(toolInvocations), callEvents: await db.select().from(toolCallEvents),
      accessAudit: await db.select().from(toolAccessAuditEvents), activity: await db.select().from(activityLog),
      interactions: await db.select().from(issueThreadInteractions) };
    expect(sinks.runEvents.length).toBeGreaterThan(0);
    expect(sinks.invocations.filter(i => i.status === "succeeded")).toHaveLength(6);
    expect(sinks.callEvents.filter(e => e.reasonCode === "linear_sample_settled_v1")).toHaveLength(6);
    for (const [name, value] of Object.entries(sinks)) for (const marker of [...canaries, ...mintedTokens]) expect(JSON.stringify(value), name).not.toContain(marker);
    // Completed heartbeat credentials cannot reopen the sample.
    const replay = await fetch(`${origin}/mcp/gateways/${named.gatewayPublicId}`, { method: "POST",
      headers: { authorization: `Bearer ${mintedTokens.at(-1)}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }) });
    expect(replay.status).toBe(401); expect(upstreamCalls).toBe(6);
  }, 40_000);
});
