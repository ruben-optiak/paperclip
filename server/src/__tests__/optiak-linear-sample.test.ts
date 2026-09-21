import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, toolApplications, toolConnections, toolInvocations, toolCallEvents } from "@paperclipai/db";
import { createOptiakLinearSampleGate } from "../services/optiak-linear-sample.js";
import { OptiakLinearPrivacyError, type OptiakLinearPrivacyBinding } from "../services/optiak-linear-privacy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("durable Linear sample receipts", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let otherDb: ReturnType<typeof createDb>;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("optiak-linear-sample-");
    db = createDb(tempDb.connectionString);
    otherDb = createDb(tempDb.connectionString);
  }, 20_000);
  afterEach(async () => { await db.execute(sql`TRUNCATE TABLE companies CASCADE`); });
  afterAll(async () => { await tempDb?.cleanup(); });

  async function fixture() {
    const [company] = await db.insert(companies).values({ name: "Synthetic sample", issuePrefix: "SAMPLE" }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Synthetic process", role: "engineer", adapterType: "process" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, status: "running", invocationSource: "on_demand" }).returning();
    const [app] = await db.insert(toolApplications).values({ companyId: company.id, name: "Synthetic Linear", type: "mcp_http" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: company.id, applicationId: app.id,
      name: "Synthetic", uid: randomUUID(), transport: "mcp_remote" }).returning();
    const binding: OptiakLinearPrivacyBinding = { companyId: company.id, connectionId: connection.id,
      tools: Object.fromEntries(["get_team", "list_issues", "get_issue"].map(name => [name, { schemaHash: "a".repeat(64), versionHash: "b".repeat(64) }])) as OptiakLinearPrivacyBinding["tools"] };
    const gate = createOptiakLinearSampleGate(db, binding);
    const scope = { companyId: company.id, agentId: agent.id, runId: run.id, connectionId: connection.id };
    async function invocation(toolName: string, runId = run.id) {
      const [row] = await db.insert(toolInvocations).values({ ...scope, runId, toolName: `linear:${toolName}`,
        upstreamToolName: toolName, status: "executing", argumentsHash: "synthetic" }).returning();
      return { ...scope, runId, toolName, invocationId: row.id };
    }
    return { binding, gate, scope, invocation, run };
  }
  const list = (state: string) => ({ team: "OPT", state, limit: 5, orderBy: "updatedAt" });
  const denied = (value: Promise<unknown>) => expect(value).rejects.toBeInstanceOf(OptiakLinearPrivacyError);

  it("serializes independent database clients and retains an unsettled crash receipt", async () => {
    const f = await fixture();
    const peer = createOptiakLinearSampleGate(otherDb, f.binding);
    const a = await f.invocation("list_issues"), b = await f.invocation("list_issues");
    const results = await Promise.allSettled([f.gate.claim(a, list("started")), peer.claim(b, list("unstarted"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(toolCallEvents)).toHaveLength(1);
    // Simulate a server crash: discard all in-memory objects, never settle.
    await denied(createOptiakLinearSampleGate(otherDb, f.binding).claim(await f.invocation("get_team"), { query: "OPT" }));
    expect(await db.select().from(toolCallEvents)).toHaveLength(1);
  });
  it("accepts at most two distinct groups and three distinct sampled details across reconstruction", async () => {
    const f = await fixture();
    await denied(f.gate.claim(await f.invocation("get_issue"), { id: "OPT-101" }));
    await f.gate.settle(await f.gate.claim(await f.invocation("list_issues"), list("started")), true, ["OPT-101", "OPT-102", "OPT-103", "OPT-104", "OPT-105"]);
    const restarted = createOptiakLinearSampleGate(otherDb, f.binding);
    await denied(restarted.claim(await f.invocation("list_issues"), list("started")));
    await denied(restarted.claim(await f.invocation("get_issue"), { id: "OPT-999" }));
    await restarted.settle(await restarted.claim(await f.invocation("list_issues"), list("unstarted")), true, ["OPT-201"]);
    for (const id of ["OPT-101", "OPT-102", "OPT-201"]) await restarted.settle(await restarted.claim(await f.invocation("get_issue"), { id }), true);
    await denied(restarted.claim(await f.invocation("get_issue"), { id: "OPT-103" }));
    await denied(restarted.claim(await f.invocation("get_issue"), { id: "OPT-101" }));
    await restarted.settle(await restarted.claim(await f.invocation("get_team"), { query: "OPT" }), true);
    await denied(restarted.claim(await f.invocation("get_team"), { query: "OPT" }));
    expect(await db.select().from(toolCallEvents)).toHaveLength(12);
  });
  it("latches provider failure across restart but does not contaminate a new run", async () => {
    const f = await fixture();
    await f.gate.settle(await f.gate.claim(await f.invocation("list_issues"), list("started")), false);
    const restarted = createOptiakLinearSampleGate(otherDb, f.binding);
    await denied(restarted.claim(await f.invocation("get_team"), { query: "OPT" }));
    const [newRun] = await db.insert(heartbeatRuns).values({ companyId: f.scope.companyId, agentId: f.scope.agentId,
      status: "running", invocationSource: "on_demand" }).returning();
    await expect(restarted.claim(await f.invocation("get_team", newRun.id), { query: "OPT" })).resolves.toMatchObject({ ordinal: 1 });
  });
  it("does not accept historical raw successes or a changed reviewed binding", async () => {
    const f = await fixture();
    const initial = await f.invocation("get_team");
    await f.gate.settle(await f.gate.claim(initial, { query: "OPT" }), true);
    const changed = structuredClone(f.binding); changed.tools.get_issue.schemaHash = "c".repeat(64);
    await denied(createOptiakLinearSampleGate(otherDb, changed).claim(await f.invocation("list_issues"), list("started")));
    const historical = await f.invocation("get_issue");
    await db.update(toolInvocations).set({ status: "succeeded" }).where(eq(toolInvocations.id, historical.invocationId));
    await denied(f.gate.claim(await f.invocation("list_issues"), list("started")));
  });
  it("rejects wrong scope, terminal runs and expired contexts", async () => {
    const f = await fixture(); const input = await f.invocation("get_team");
    for (const field of ["companyId", "agentId", "connectionId", "runId", "invocationId"]) {
      await denied(f.gate.claim({ ...input, [field]: randomUUID() }, { query: "OPT" }));
    }
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    await denied(f.gate.claim(input, { query: "OPT" }));
    await db.update(heartbeatRuns).set({ status: "running", startedAt: new Date(Date.now() - 3_600_001) }).where(eq(heartbeatRuns.id, f.run.id));
    await denied(f.gate.claim(input, { query: "OPT" }));
    expect(await db.select().from(toolCallEvents)).toHaveLength(0);
  });
  it("cannot forge a settlement, inject identifiers via a detail, or settle twice", async () => {
    const f = await fixture(); const claim = await f.gate.claim(await f.invocation("get_team"), { query: "OPT" });
    await denied(f.gate.settle({ ...claim, ordinal: 2 }, true));
    await denied(f.gate.settle({ ...claim, request: { query: "OTHER" } }, true));
    await denied(f.gate.settle(claim, true, ["OPT-101"]));
    await f.gate.settle(claim, true);
    await denied(f.gate.settle(claim, true));
  });
  it("fails closed on malformed receipts", async () => {
    const f = await fixture(); const claim = await f.gate.claim(await f.invocation("get_team"), { query: "OPT" });
    await f.gate.settle(claim, true);
    await db.update(toolCallEvents).set({ metadata: { schema: "invalid" } });
    await denied(f.gate.claim(await f.invocation("list_issues"), list("started")));
  });
});
