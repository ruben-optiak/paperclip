/** Opt-in fork boundary. Never import a private company package into the server. */
export const OPTIAK_LINEAR_CONTRACT = "optiak-linear-metadata/v1";
export const OPTIAK_LINEAR_ENDPOINT = "https://mcp.linear.app/mcp/readonly";
export const OPTIAK_LINEAR_TOOLS = ["get_team", "list_issues", "get_issue"] as const;
type ToolName = typeof OPTIAK_LINEAR_TOOLS[number];
type RecordValue = Record<string, unknown>;
export interface OptiakLinearPrivacyBinding {
  companyId: string;
  connectionId: string;
  tools: Record<ToolName, { schemaHash: string; versionHash: string }>;
}

// Fixed messages only: never interpolate provider text, field names or causes.
export class OptiakLinearPrivacyError extends Error {
  constructor() { super("Optiak Linear metadata boundary rejected the call"); }
}
function requireValue(value: unknown): asserts value {
  if (!value) throw new OptiakLinearPrivacyError();
}
function record(value: unknown): RecordValue {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as RecordValue;
}
function exact(value: unknown, keys: string[]): RecordValue {
  const result = record(value);
  requireValue(Object.getPrototypeOf(result) === Object.prototype);
  requireValue(Reflect.ownKeys(result).every(k => typeof k === "string" && keys.includes(k)
    && Object.getOwnPropertyDescriptor(result, k)?.get === undefined));
  requireValue(Object.keys(result).length === keys.length);
  return result;
}

/** Empty/unset is disabled; malformed configuration MUST fail server startup. */
export function parseOptiakLinearPrivacyBinding(value: string | undefined): OptiakLinearPrivacyBinding | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    const parsed = exact(JSON.parse(value), ["companyId", "connectionId", "tools"]);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    requireValue(typeof parsed.companyId === "string" && uuid.test(parsed.companyId));
    requireValue(typeof parsed.connectionId === "string" && uuid.test(parsed.connectionId));
    const tools = exact(parsed.tools, [...OPTIAK_LINEAR_TOOLS]);
    for (const name of OPTIAK_LINEAR_TOOLS) {
      const hashes = exact(tools[name], ["schemaHash", "versionHash"]);
      for (const hash of Object.values(hashes)) requireValue(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
    }
    return parsed as unknown as OptiakLinearPrivacyBinding;
  } catch { throw new Error("Invalid PAPERCLIP_OPTIAK_LINEAR_PRIVACY configuration"); }
}

export function normalizeOptiakLinearRequest(toolName: string | undefined, args: unknown): RecordValue {
  requireValue(OPTIAK_LINEAR_TOOLS.includes(toolName as ToolName));
  if (toolName === "get_team") {
    requireValue(exact(args, ["query"]).query === "OPT");
    return { query: "OPT" };
  }
  if (toolName === "list_issues") {
    const { team, state, limit, orderBy } = exact(args, ["team", "state", "limit", "orderBy"]);
    requireValue(team === "OPT" && (state === "started" || state === "unstarted") && limit === 5 && orderBy === "updatedAt");
    return { team: "OPT", state, limit: 5, orderBy: "updatedAt" };
  }
  return { id: identifier(exact(args, ["id"]).id) };
}

/** Bound actual streamed bytes, including JSON-RPC overhead, not just Content-Length. */
export async function readOptiakLinearResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  requireValue(reader);
  const chunks: Uint8Array[] = [];
  let size = 0, complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      requireValue(size <= 262144);
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { throw new OptiakLinearPrivacyError(); }
  finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function identifier(value: unknown): string {
  requireValue(typeof value === "string" && /^OPT-[1-9][0-9]{0,8}$/.test(value));
  return value;
}
function utc(value: unknown): string {
  requireValue(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value));
  const time = Date.parse(value);
  requireValue(Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z"));
  return new Date(time).toISOString();
}
function checkTree(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  requireValue(depth <= 16 && ++budget.nodes <= 12000);
  if (value && typeof value === "object") for (const child of Object.values(value)) checkTree(child, depth + 1, budget);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function projectIssue(value: unknown, retrievedAt: string) {
  const raw = record(value), id = identifier(raw.identifier);
  requireValue(raw.archivedAt === undefined || raw.archivedAt === null);
  requireValue(typeof raw.url === "string");
  const url = new URL(raw.url);
  requireValue(url.origin === "https://linear.app" && !url.username && !url.password && !url.search && !url.hash
    && new RegExp(`^/optiak/issue/${id}(?:/[^/]+)?/?$`).test(url.pathname));
  if (raw.team !== undefined) requireValue(record(raw.team).key === "OPT");
  const statuses = new Map<unknown, string>([["Todo", "unstarted"], ["Backlog", "backlog"], ["In Progress", "started"],
    ["Done", "completed"], ["Canceled", "canceled"], ["Cancelled", "canceled"]]);
  const priority = raw.priority && typeof raw.priority === "object" ? record(raw.priority).value : raw.priority;
  requireValue(priority === undefined || priority === null || (typeof priority === "number" && Number.isInteger(priority) && priority >= 0 && priority <= 4));
  const updatedAt = raw.updatedAt === undefined || raw.updatedAt === null ? null : utc(raw.updatedAt);
  requireValue(updatedAt === null || Date.parse(updatedAt) <= Date.parse(retrievedAt));
  return { identifier: id, url: `https://linear.app/optiak/issue/${id}`, updatedAt,
    statusClass: statuses.get(raw.status) ?? "unknown", priority: priority ?? null };
}

/** Takes the raw tools/call result, before normalization, elicitation or audit. */
export function projectOptiakLinearResult(toolName: string, args: unknown, result: unknown, now: number) {
  try {
    const request = normalizeOptiakLinearRequest(toolName, args);
    requireValue(Buffer.byteLength(JSON.stringify(result)) <= 262144);
    checkTree(result);
    const mcp = record(result);
    requireValue(Object.keys(mcp).every(k => ["content", "structuredContent", "isError", "_meta"].includes(k)));
    requireValue(mcp.isError === undefined || mcp.isError === false);
    requireValue(Array.isArray(mcp.content) && mcp.content.length === 1);
    const block = record(mcp.content[0]);
    requireValue(block.type === "text" && typeof block.text === "string");
    const raw = record(JSON.parse(block.text));
    checkTree(raw);
    if (mcp.structuredContent !== undefined && mcp.structuredContent !== null) requireValue(canonical(raw) === canonical(mcp.structuredContent));
    const retrievedAt = utc(new Date(now).toISOString());
    let data: RecordValue;
    if (toolName === "get_team") {
      requireValue(raw.key === "OPT");
      data = { teamKey: "OPT" };
    } else if (toolName === "get_issue") {
      const issue = projectIssue(raw, retrievedAt);
      requireValue(issue.identifier === request.id);
      data = { issue };
    } else {
      requireValue(Array.isArray(raw.issues) && raw.issues.length <= 5);
      const issues = raw.issues.map(i => projectIssue(i, retrievedAt));
      requireValue(issues.every(i => i.statusClass === "unknown" || i.statusClass === request.state));
      requireValue(new Set(issues.map(i => i.identifier)).size === issues.length);
      requireValue(raw.hasNextPage === undefined || typeof raw.hasNextPage === "boolean");
      data = { issues, hasMore: raw.hasNextPage ?? null, sampledGroup: request.state };
    }
    const projected = { schema: OPTIAK_LINEAR_CONTRACT, privacyMode: "metadata_only",
      evidenceScope: "not_established_by_projection", retrievedAt, source: "linear_opt_workspace",
      coverage: "bounded_sample_not_global_ranking", semanticReviewAvailable: false, ...data };
    return { content: [{ type: "text", text: JSON.stringify(projected) }], isError: false };
  } catch { throw new OptiakLinearPrivacyError(); }
}
