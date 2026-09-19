// Offline candidate. No server, credentials, network client, storage or logging.
import {createHash} from "node:crypto";
import {loadBaseline} from "../../scripts/linear-preflight.mjs";

export const CONTRACT = "optiak-linear-metadata/v1";
const allowedTools = new Set(["get_team", "list_issues", "get_issue"]);
const maxBytes = 262144;
const reasonCodes = new Set([
  "invalid_request", "invalid_issue_identifier", "invalid_source_time", "response_too_complex",
  "response_too_large", "invalid_mcp_json", "unsupported_mcp_envelope", "upstream_tool_error",
  "unsupported_mcp_content", "invalid_provider_json", "unsupported_provider_shape", "ambiguous_mcp_content",
  "tool_denied", "team_denied", "state_denied", "unbounded_query_denied", "unsupported_issue_shape",
  "source_scope_mismatch", "invalid_priority", "future_source_time", "unbounded_or_unknown_response",
  "duplicate_issue", "invalid_pagination", "session_disabled", "concurrent_call_denied",
  "call_budget_exhausted", "duplicate_group_denied", "detail_scope_denied", "upstream_timeout",
  "catalog_drift_denied", "archived_issue_denied", "state_scope_mismatch",
]);
class Rejected extends Error {}
function requireValue(ok, code) { if (!ok) throw new Rejected(code); }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value, keys) {
  requireValue(record(value) && Object.getPrototypeOf(value) === Object.prototype, "invalid_request");
  requireValue(Reflect.ownKeys(value).every(k => keys.includes(k) && Object.getOwnPropertyDescriptor(value, k)?.get === undefined), "invalid_request");
}
function identifier(id) { requireValue(typeof id === "string" && /^OPT-[1-9][0-9]{0,8}$/.test(id), "invalid_issue_identifier"); return id; }
function utc(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value), "invalid_source_time");
  const t = Date.parse(value);
  requireValue(Number.isFinite(t) && new Date(t).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z"), "invalid_source_time");
  return new Date(t).toISOString();
}
function checkTree(value, depth = 0, budget = {nodes: 0}) {
  requireValue(depth <= 16 && ++budget.nodes <= 12000, "response_too_complex");
  if (value && typeof value === "object") for (const child of Object.values(value)) checkTree(child, depth + 1, budget);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function unpack(wireText) {
  requireValue(typeof wireText === "string" && Buffer.byteLength(wireText) <= maxBytes, "response_too_large");
  let mcp;
  try { mcp = JSON.parse(wireText); } catch { throw new Rejected("invalid_mcp_json"); }
  checkTree(mcp);
  requireValue(record(mcp) && Object.keys(mcp).every(k => ["content", "structuredContent", "isError", "_meta"].includes(k)), "unsupported_mcp_envelope");
  requireValue(mcp.isError === undefined || typeof mcp.isError === "boolean", "unsupported_mcp_envelope");
  requireValue(mcp.isError !== true, "upstream_tool_error");
  requireValue(Array.isArray(mcp.content) && mcp.content.length === 1 && mcp.content[0]?.type === "text" && typeof mcp.content[0].text === "string", "unsupported_mcp_content");
  let data;
  try { data = JSON.parse(mcp.content[0].text); } catch { throw new Rejected("invalid_provider_json"); }
  checkTree(data);
  requireValue(record(data), "unsupported_provider_shape");
  if (mcp.structuredContent !== undefined && mcp.structuredContent !== null) requireValue(canonical(data) === canonical(mcp.structuredContent), "ambiguous_mcp_content");
  return data;
}

export function normalizeRequest(toolName, args) {
  requireValue(allowedTools.has(toolName), "tool_denied");
  if (toolName === "get_team") {
    exact(args, ["query"]); requireValue(args.query === "OPT", "team_denied");
    return {query: "OPT"};
  }
  if (toolName === "list_issues") {
    exact(args, ["team", "state", "limit", "orderBy"]);
    const {team, state, limit, orderBy} = args; // Snapshot once, including Proxy-backed callers.
    requireValue(team === "OPT", "team_denied");
    requireValue(["started", "unstarted"].includes(state), "state_denied");
    requireValue(limit === 5 && orderBy === "updatedAt", "unbounded_query_denied");
    return {team: "OPT", state, limit: 5, orderBy: "updatedAt"};
  }
  exact(args, ["id"]);
  return {id: identifier(args.id)};
}

function projectIssue(raw, retrievedAt) {
  requireValue(record(raw), "unsupported_issue_shape");
  requireValue(raw.archivedAt === undefined || raw.archivedAt === null, "archived_issue_denied");
  const id = identifier(raw.identifier);
  requireValue(typeof raw.url === "string", "source_scope_mismatch");
  const url = new URL(raw.url);
  requireValue(url.origin === "https://linear.app" && !url.username && !url.password && !url.search && !url.hash && new RegExp(`^/optiak/issue/${id}(?:/[^/]+)?/?$`).test(url.pathname), "source_scope_mismatch");
  if (raw.team !== undefined) requireValue(record(raw.team) && raw.team.key === "OPT", "source_scope_mismatch");
  // Fixed vocabulary only. Never pass a custom status/priority label through.
  const statuses = new Map([["Todo", "unstarted"], ["Backlog", "backlog"], ["In Progress", "started"], ["Done", "completed"], ["Canceled", "canceled"], ["Cancelled", "canceled"]]);
  const priority = record(raw.priority) ? raw.priority.value : raw.priority;
  requireValue(priority === undefined || priority === null || (Number.isInteger(priority) && priority >= 0 && priority <= 4), "invalid_priority");
  const updatedAt = raw.updatedAt === undefined || raw.updatedAt === null ? null : utc(raw.updatedAt);
  requireValue(updatedAt === null || Date.parse(updatedAt) <= Date.parse(retrievedAt), "future_source_time");
  return {identifier: id, url: `https://linear.app/optiak/issue/${id}`, updatedAt, statusClass: statuses.get(raw.status) ?? "unknown", priority: priority ?? null};
}

// Input must be the MCP response BEFORE Paperclip sees or audits it. Rejects
// Paperclip-normalized {content, data} responses: that boundary is already late.
export function projectLinearMcpResult({toolName, arguments: args, wireText, retrievedAt}) {
  const request = normalizeRequest(toolName, args);
  const time = utc(retrievedAt), raw = unpack(wireText);
  let data;
  if (toolName === "get_team") {
    requireValue(raw.key === "OPT", "source_scope_mismatch");
    data = {teamKey: "OPT"};
  } else if (toolName === "get_issue") {
    const issue = projectIssue(raw, time);
    requireValue(issue.identifier === request.id, "source_scope_mismatch");
    data = {issue};
  } else {
    requireValue(Array.isArray(raw.issues) && raw.issues.length <= request.limit, "unbounded_or_unknown_response");
    const issues = raw.issues.map(i => projectIssue(i, time));
    requireValue(issues.every(i => i.statusClass === "unknown" || i.statusClass === request.state), "state_scope_mismatch");
    requireValue(new Set(issues.map(i => i.identifier)).size === issues.length, "duplicate_issue");
    requireValue(raw.hasNextPage === undefined || typeof raw.hasNextPage === "boolean", "invalid_pagination");
    data = {issues, hasMore: raw.hasNextPage ?? null, sampledGroup: request.state};
  }
  return {schema: CONTRACT, privacyMode: "metadata_only", evidenceScope: "not_established_by_projection", retrievedAt: time, source: "linear_opt_workspace", coverage: "bounded_sample_not_global_ranking", semanticReviewAvailable: false, ...data};
}

function finish(toolName, args, payload, code) {
  const value = code ? {schema: CONTRACT, error: code, retryAutomatically: false} : payload;
  const serialized = JSON.stringify(value);
  // Only projected bytes are hashed. No raw body, digest, exception or free-text
  // field name enters the diagnostic record. Paperclip adds run/issue identity.
  return {
    mcpResult: {content: [{type: "text", text: serialized}], isError: Boolean(code)},
    audit: {schema: "optiak-linear-projection-audit/v1", contract: CONTRACT, tool: allowedTools.has(toolName) ? toolName : "denied", outcome: code ? "denied_or_failed" : "projected", reason: code ?? "metadata_projected", request: args ?? null, projectedSha256: createHash("sha256").update(serialized).digest("hex"), projectedBytes: Buffer.byteLength(serialized)},
  };
}

// One factory per future authenticated run/session, NEVER one per tool call.
// Dispatch/catalog providers are trusted integration code, not tool arguments.
// This prototype deliberately supplies neither OAuth nor HTTP MCP hosting.
export function createProjectedLinearReader({dispatch, getCatalogEntry, baseline = loadBaseline(), now = () => new Date().toISOString(), timeoutMs = 10000}) {
  requireValue(typeof dispatch === "function" && typeof getCatalogEntry === "function" && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000, "invalid_adapter_config");
  requireValue(baseline.schema === "optiak-linear-catalog-baseline/v1" && baseline.endpoint === "https://mcp.linear.app/mcp/readonly" && baseline.defaultDecision === "deny", "invalid_baseline");
  const reviewed = new Map(baseline.tools.map(e => [e.toolName, {schemaHash: e.schemaHash, versionHash: e.versionHash}]));
  requireValue(reviewed.size === baseline.tools.length && [...allowedTools].every(t => /^[0-9a-f]{64}$/.test(reviewed.get(t)?.schemaHash ?? "") && /^[0-9a-f]{64}$/.test(reviewed.get(t)?.versionHash ?? "")), "invalid_baseline");
  const seen = new Set(), groups = new Set(), details = new Set();
  let attempts = 0, busy = false, disabled = false;
  return async function invoke(toolName, args) {
    let request, ownsLock = false, timer;
    const controller = new AbortController();
    try {
      request = normalizeRequest(toolName, args);
      requireValue(!disabled, "session_disabled");
      requireValue(!busy, "concurrent_call_denied");
      requireValue(attempts < 6, "call_budget_exhausted");
      if (toolName === "list_issues") requireValue(!groups.has(request.state), "duplicate_group_denied");
      if (toolName === "get_issue") requireValue(seen.has(request.id) && details.size < 3 && !details.has(request.id), "detail_scope_denied");
      attempts++; busy = true; ownsLock = true;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { disabled = true; controller.abort(); reject(new Rejected("upstream_timeout")); }, timeoutMs); });
      const work = async () => {
        const entry = await getCatalogEntry(toolName, {signal: controller.signal});
        requireValue(!controller.signal.aborted, "upstream_timeout");
        const approved = reviewed.get(toolName);
        requireValue(entry?.toolName === toolName && entry.status === "active" && entry.reviewedAt && !entry.quarantinedAt && entry.isReadOnly === true && entry.isWrite === false && entry.isDestructive === false && entry.riskLevel === "read" && entry.schemaHash === approved.schemaHash && entry.versionHash === approved.versionHash, "catalog_drift_denied");
        const wireText = await dispatch({toolName, arguments: structuredClone(request), signal: controller.signal});
        requireValue(!controller.signal.aborted, "upstream_timeout");
        return projectLinearMcpResult({toolName, arguments: request, wireText, retrievedAt: now()});
      };
      const projected = await Promise.race([work(), timeout]);
      if (toolName === "list_issues") { groups.add(request.state); projected.issues.forEach(i => seen.add(i.identifier)); }
      if (toolName === "get_issue") details.add(request.id);
      return finish(toolName, request, projected);
    } catch (error) {
      const message = error instanceof Rejected ? error.message : null;
      const code = reasonCodes.has(message) ? message : "upstream_or_contract_failure";
      if (ownsLock) disabled = true; // No fallback or retry after an upstream failure.
      return finish(toolName, request, null, code);
    } finally { clearTimeout(timer); if (ownsLock) busy = false; }
  };
}
