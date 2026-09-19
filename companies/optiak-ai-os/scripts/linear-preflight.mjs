#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve} from "node:path";
import {createApi, readJsonInput} from "../skills/optiak-durable-completion/scripts/complete-issue.mjs";

export function loadBaseline() {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../policies/linear-catalog-baseline.json"), "utf8"));
}
const exactEndpoint = "https://mcp.linear.app/mcp/readonly";
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export function evaluateLinearSnapshot(snapshot, baseline = loadBaseline(), {now = Date.now()} = {}) {
  const errors = [];
  const fail = (ok, code) => { if (!ok) errors.push(code); };
  fail(baseline.schema === "optiak-linear-catalog-baseline/v1" && baseline.endpoint === exactEndpoint && baseline.defaultDecision === "deny", "invalid_baseline");
  const known = new Map((baseline.tools ?? []).map(t => [t.toolName, t]));
  fail(known.size > 0 && known.size === baseline.tools?.length, "duplicate_or_empty_baseline");
  const c = snapshot.connection ?? {};
  fail(snapshot.schema === "optiak-linear-preflight/v1", "invalid_snapshot");
  fail(c.endpoint === exactEndpoint && c.transportEndpoint === exactEndpoint, "endpoint_mismatch");
  fail(c.quarantineNewEntries === true && c.transportQuarantineNewEntries === true, "automatic_catalog_inclusion");
  fail(c.status === "active" && c.enabled === true && c.healthStatus === "ok", "connection_unavailable");
  for (const [field, value] of [["snapshot", snapshot.observedAt], ["health", c.healthCheckedAt], ["catalog", c.lastCatalogRefreshAt]]) {
    const age = now - Date.parse(value);
    fail(Number.isFinite(age) && age >= 0 && age <= 900000, `${field}_stale_or_missing`);
  }
  const catalog = snapshot.catalog ?? [];
  const byName = new Map(catalog.map(t => [t.toolName, t]));
  fail(byName.size === catalog.length && catalog.length > 0, "duplicate_or_empty_catalog");
  const audience = snapshot.audience ?? [];
  fail(audience.length > 0 && audience.filter(a => a.isProduct).length === 1, "invalid_audience_snapshot");
  fail(snapshot.installs?.length === 1 && snapshot.installs[0].productOnly === true, "installation_scope_expanded");
  fail(snapshot.profileDefaultAction === "deny", "profile_default_not_deny");
  const observedNames = [...byName.keys()].sort();
  const visible = catalog.filter(t => t.status === "active" && !t.quarantinedAt);
  for (const agent of audience) {
    const tools = agent.tools ?? [];
    fail(tools.length === visible.length && new Set(tools.map(t => t.toolName)).size === tools.length && visible.every(t => tools.some(x => x.toolName === t.toolName)), "incomplete_effective_access");
    for (const tool of tools) {
      if (tool.decision === "off") continue;
      fail(agent.isProduct === true, "non_product_access");
      const entry = byName.get(tool.toolName), approved = known.get(tool.toolName);
      fail(Boolean(approved), "unreviewed_tool_access");
      fail(tool.decision === "allowed" && tool.risk === "read", "non_read_or_approval_access");
      fail(Boolean(entry?.reviewedAt) && entry.status === "active" && entry.riskLevel === "read" && entry.isReadOnly === true && entry.isWrite === false && entry.isDestructive === false, "unreviewed_or_unsafe_entry");
      fail(Boolean(approved) && entry?.schemaHash === approved.schemaHash && entry?.versionHash === approved.versionHash, "catalog_hash_drift");
    }
  }
  const productTools = audience.find(a => a.isProduct)?.tools ?? [];
  for (const name of ["get_team", "list_issues", "get_issue"]) fail(productTools.some(t => t.toolName === name && t.decision === "allowed"), "required_product_read_unavailable");
  return {
    schema: "optiak-linear-preflight-result/v1", status: errors.length ? "blocked" : "ready_for_bounded_read",
    errors: [...new Set(errors)].sort(), catalogCount: catalog.length,
    reviewedBaselineCount: known.size, productAllowedCount: productTools.filter(t => t.decision === "allowed").length,
    quarantinedOrExcludedCount: productTools.filter(t => t.decision === "off").length + catalog.length - visible.length,
    newToolNames: observedNames.filter(name => !known.has(name)),
    agentCount: audience.length, observedAt: snapshot.observedAt,
    limitations: ["not_a_live_data_query", "team_scope_requires_task_enforcement", "not_proof_of_revocation", "raw_paperclip_audit_not_redacted_by_this_helper"],
  };
}

// This collector reads metadata only. No tool calls, writes, health refresh, tokens or
// raw provider responses in its returned snapshot. GET catalog may refresh the cache,
// so inspect quarantine first and fail BEFORE touching it if auto-inclusion is on.
export async function collectLinearSnapshot(api, {companyId, connectionId, productAgentId}, {now = () => new Date().toISOString()} = {}) {
  for (const id of [companyId, connectionId, productAgentId]) if (!idPattern.test(id ?? "")) throw new Error("invalid_identity");
  const path = `/tool-connections/${connectionId}`;
  const c = await api(path);
  if (c.companyId !== companyId || c.config?.url !== exactEndpoint || c.transportConfig?.url !== exactEndpoint || c.config?.quarantineNewEntries !== true || c.transportConfig?.quarantineNewEntries !== true) throw new Error("unsafe_connection_metadata_no_catalog_read");
  const [{catalog}, {agents}, {profiles}, companyAgents] = await Promise.all([
    api(`${path}/catalog`), api(`${path}/test-agents`), api(`/companies/${companyId}/tools/profiles`), api(`/companies/${companyId}/agents`),
  ]);
  if (!Array.isArray(agents) || !Array.isArray(companyAgents) || new Set(agents.map(a => a.id)).size !== companyAgents.length || companyAgents.some(a => !agents.some(x => x.id === a.id))) throw new Error("incomplete_company_audience");
  const profile = profiles.find(p => p.profileKey === `app:${connectionId}`);
  // Re-read metadata after the possible cache refresh; health never inferred from GET 200.
  const latest = await api(path);
  return {
    schema: "optiak-linear-preflight/v1", observedAt: now(),
    connection: {endpoint: latest.config?.url, transportEndpoint: latest.transportConfig?.url, quarantineNewEntries: latest.config?.quarantineNewEntries, transportQuarantineNewEntries: latest.transportConfig?.quarantineNewEntries, status: latest.status, enabled: latest.enabled, healthStatus: latest.healthStatus, healthCheckedAt: latest.healthCheckedAt, lastCatalogRefreshAt: latest.lastCatalogRefreshAt},
    profileDefaultAction: profile?.defaultAction,
    installs: (latest.installs ?? []).map(i => ({productOnly: i.targetType === "agent" && i.targetId === productAgentId})),
    catalog: catalog.map(e => Object.fromEntries(["toolName", "versionHash", "schemaHash", "reviewedAt", "quarantinedAt", "status", "riskLevel", "isReadOnly", "isWrite", "isDestructive"].map(key => [key, e[key]]))),
    audience: agents.map(a => ({isProduct: a.id === productAgentId, tools: a.effectiveAccess.tools.map(t => ({toolName: t.toolName, risk: t.risk, decision: t.decision}))})),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length > 3 || process.argv.slice(2).some(arg => arg !== "--live")) throw new Error("unsupported_arguments");
    const snapshot = process.argv.includes("--live") ? await collectLinearSnapshot(
      createApi({baseUrl: process.env.OPTIAK_PAPERCLIP_URL, token: process.env.OPTIAK_BOARD_TOKEN}),
      {companyId: process.env.OPTIAK_COMPANY_ID, connectionId: process.env.OPTIAK_LINEAR_CONNECTION_ID, productAgentId: process.env.OPTIAK_PRODUCT_AGENT_ID},
    ) : await readJsonInput();
    const result = evaluateLinearSnapshot(snapshot);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "ready_for_bounded_read") process.exitCode = 1;
  } catch { console.error("Linear preflight blocked. Inspect instance metadata; no permissions were changed."); process.exitCode = 1; }
}
