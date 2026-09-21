import { createHash } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { heartbeatRuns, toolCallEvents, toolInvocations, type Db } from "@paperclipai/db";
import { canonicalToolArguments } from "./tool-content-guards.js";
import { normalizeOptiakLinearRequest, OptiakLinearPrivacyError, type OptiakLinearPrivacyBinding } from "./optiak-linear-privacy.js";

const CLAIM = "linear_sample_claimed_v1";
const SETTLE = "linear_sample_settled_v1";
const SCHEMA = "optiak-linear-sample/v1";
export interface LinearSampleClaim {
  companyId: string;
  connectionId: string;
  agentId: string;
  runId: string;
  invocationId: string;
  toolName: string;
  request: Record<string, unknown>;
  ordinal: number;
}
function requireValue(ok: unknown): asserts ok { if (!ok) throw new OptiakLinearPrivacyError(); }
function ids(value: unknown): string[] {
  requireValue(Array.isArray(value) && value.length <= 5 && value.every(id => typeof id === "string" && /^OPT-[1-9][0-9]{0,8}$/.test(id)));
  requireValue(new Set(value).size === value.length);
  return value;
}

/**
 * A bounded, append-only access receipt journal in existing tool_call_events.
 * Serialize short claim/settle transactions on the owning heartbeat row, never
 * hold a database transaction across a provider request. An unsettled claim is
 * deliberately not leased/reclaimed: a crashed run cannot silently retry.
 */
export function createOptiakLinearSampleGate(db: Db, binding: OptiakLinearPrivacyBinding, now = Date.now) {
  const fingerprint = createHash("sha256").update(canonicalToolArguments(binding)).digest("hex");
  type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
  async function lockRun(tx: Tx, scope: Pick<LinearSampleClaim, "companyId" | "connectionId" | "runId" | "agentId">) {
    requireValue(scope.companyId === binding.companyId && scope.connectionId === binding.connectionId);
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.id, scope.runId), eq(heartbeatRuns.companyId, scope.companyId), eq(heartbeatRuns.agentId, scope.agentId),
    )).for("update").limit(1);
    requireValue(run);
    return run;
  }
  async function journal(tx: Tx, scope: Pick<LinearSampleClaim, "companyId" | "connectionId" | "runId" | "agentId">) {
    const events = await tx.select().from(toolCallEvents).where(and(
      eq(toolCallEvents.companyId, scope.companyId), eq(toolCallEvents.runId, scope.runId),
      eq(toolCallEvents.connectionId, scope.connectionId), inArray(toolCallEvents.reasonCode, [CLAIM, SETTLE]),
    )).limit(13);
    requireValue(events.length <= 12);
    const claims = events.filter(e => e.reasonCode === CLAIM);
    const settlements = events.filter(e => e.reasonCode === SETTLE);
    requireValue(claims.length <= 6 && new Set(claims.map(e => e.invocationId)).size === claims.length);
    for (const event of events) {
      requireValue(event.invocationId && event.agentId === scope.agentId
        && event.metadata?.schema === SCHEMA && event.metadata?.fingerprint === fingerprint);
      const ordinal = event.metadata.ordinal;
      requireValue(typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 6);
    }
    requireValue(new Set(claims.map(e => e.metadata!.ordinal)).size === claims.length);
    requireValue(claims.every(e => (e.metadata!.ordinal as number) <= claims.length));
    requireValue(new Set(settlements.map(e => e.invocationId)).size === settlements.length);
    for (const settlement of settlements) {
      const claim = claims.find(c => c.invocationId === settlement.invocationId && c.metadata!.ordinal === settlement.metadata!.ordinal);
      requireValue(claim && claim.toolName === settlement.toolName);
      requireValue(settlement.outcome === "success" || settlement.outcome === "failure");
      const sampleIds = ids(settlement.metadata!.sampleIds);
      requireValue(sampleIds.length === 0 || (claim.toolName === "list_issues" && settlement.outcome === "success"));
    }
    return { claims, settlements };
  }
  return {
    async claim(scope: Omit<LinearSampleClaim, "request" | "ordinal">, parameters: unknown): Promise<LinearSampleClaim> {
      const request = normalizeOptiakLinearRequest(scope.toolName, parameters);
      return db.transaction(async tx => {
        const run = await lockRun(tx, scope);
        // Receipts must outlive a usable run. Refuse ancient contexts even if an
        // operator's retention process has already removed their audit history.
        const age = now() - (run.startedAt ?? run.createdAt).getTime();
        requireValue(run.status === "running" && age >= 0 && age < 60 * 60 * 1000);
        const [invocation] = await tx.select().from(toolInvocations).where(and(
          eq(toolInvocations.id, scope.invocationId), eq(toolInvocations.companyId, scope.companyId),
          eq(toolInvocations.runId, scope.runId), eq(toolInvocations.agentId, scope.agentId),
          eq(toolInvocations.connectionId, scope.connectionId), eq(toolInvocations.status, "executing"),
        )).limit(1);
        requireValue(invocation && invocation.upstreamToolName === scope.toolName);
        const { claims, settlements } = await journal(tx, scope);
        requireValue(claims.length < 6 && claims.length === settlements.length);
        requireValue(settlements.every(s => s.outcome === "success"));
        requireValue(!claims.some(c => c.invocationId === scope.invocationId));
        const [historical] = await tx.select({ id: toolInvocations.id }).from(toolInvocations).where(and(
          eq(toolInvocations.companyId, scope.companyId), eq(toolInvocations.runId, scope.runId),
          eq(toolInvocations.connectionId, scope.connectionId), eq(toolInvocations.status, "succeeded"),
          notInArray(toolInvocations.id, [scope.invocationId, ...claims.map(c => c.invocationId!)]),
        )).limit(1);
        requireValue(!historical); // No pre-activation response can become sample authority.
        const previous = claims.map(c => ({ tool: c.toolName, request: normalizeOptiakLinearRequest(c.toolName ?? undefined, c.metadata!.request) }));
        if (scope.toolName === "get_team") requireValue(!previous.some(p => p.tool === "get_team"));
        if (scope.toolName === "list_issues") requireValue(!previous.some(p => p.tool === "list_issues" && p.request.state === request.state));
        if (scope.toolName === "get_issue") {
          const details = previous.filter(p => p.tool === "get_issue");
          const sampled = new Set(settlements.flatMap(s => ids(s.metadata!.sampleIds)));
          requireValue(details.length < 3 && !details.some(p => p.request.id === request.id) && sampled.has(request.id as string));
        }
        const claim = { ...scope, request, ordinal: claims.length + 1 };
        await tx.insert(toolCallEvents).values({ ...scope, toolName: scope.toolName,
          actorType: "system", actorId: "optiak-linear-sample", eventType: "call_started", outcome: "pending", reasonCode: CLAIM,
          metadata: { schema: SCHEMA, fingerprint, ordinal: claim.ordinal, request },
        });
        return claim;
      });
    },
    async settle(claim: LinearSampleClaim, success: boolean, sampledIds: string[] = []) {
      const sampleIds = ids(sampledIds);
      requireValue(claim.toolName === "list_issues" || sampleIds.length === 0);
      requireValue(success || sampleIds.length === 0);
      await db.transaction(async tx => {
        const run = await lockRun(tx, claim);
        const { claims, settlements } = await journal(tx, claim);
        const original = claims.find(c => c.invocationId === claim.invocationId);
        requireValue(original && original.metadata!.ordinal === claim.ordinal && original.toolName === claim.toolName);
        requireValue(canonicalToolArguments(original.metadata!.request) === canonicalToolArguments(claim.request));
        requireValue(!settlements.some(s => s.invocationId === claim.invocationId));
        if (success) requireValue(run.status === "running");
        await tx.insert(toolCallEvents).values({ companyId: claim.companyId, connectionId: claim.connectionId,
          runId: claim.runId, agentId: claim.agentId, invocationId: claim.invocationId, toolName: claim.toolName,
          actorType: "system", actorId: "optiak-linear-sample", eventType: success ? "call_completed" : "call_failed",
          outcome: success ? "success" : "failure", reasonCode: SETTLE,
          metadata: { schema: SCHEMA, fingerprint, ordinal: claim.ordinal, sampleIds },
        });
      });
    },
  };
}
