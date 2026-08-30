#!/usr/bin/env node
import {createHash} from "node:crypto";
import {lstatSync, readFileSync, readdirSync, statSync} from "node:fs";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const symlinkPaths = [];

function filesBelow(root) {
  const found = [];
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "source-snapshots") continue;
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) symlinkPaths.push(path);
    else if (stats.isDirectory()) found.push(...filesBelow(path));
    else found.push(path);
  }
  return found;
}

function scalar(value) {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  if (cleaned === "null") return null;
  if (cleaned === "true") return true;
  if (cleaned === "false") return false;
  return cleaned;
}

function frontmatter(path) {
  const text = readFileSync(path, "utf8");
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return {};
  const parsed = {};
  let listKey = null;
  for (const line of text.slice(4, end).split("\n")) {
    const list = line.match(/^\s+-\s+(.+)$/);
    if (list && listKey) {
      parsed[listKey].push(scalar(list[1]));
      continue;
    }
    const item = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!item) continue;
    const [, key, value] = item;
    if (!value) {
      parsed[key] = [];
      listKey = key;
    } else {
      parsed[key] = scalar(value);
      listKey = null;
    }
  }
  return parsed;
}

function fail(message) {
  errors.push(message);
}

function jsonYaml(relativePath) {
  const path = join(packageDir, relativePath);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relativePath} must be valid JSON-compatible YAML: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

filesBelow(packageDir);
for (const path of symlinkPaths) fail(`Symlinks are not portable package inputs: ${relative(packageDir, path)}`);

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const company = frontmatter(join(packageDir, "COMPANY.md"));
if (company.schema !== "agentcompanies/v1") fail("COMPANY.md schema must be agentcompanies/v1");
if (company.slug !== "enki-hogar-ai-os") fail("Unexpected company slug");
if (company.version !== "0.1.0") fail("Unexpected package version");
if (company.license !== "MIT AND LicenseRef-Enki-Hogar-Internal") fail("Unexpected package license; mixed package scope must be explicit");
for (const required of [
  "LICENSE",
  "LICENSE-ENKI-INTERNAL.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "runtime/compatibility.lock.yaml",
  "runtime/skill-reference-mirrors.json",
  "policies/desired-state.yaml",
  "scripts/import-allowlist.txt",
]) if (!statSafe(join(packageDir, required))) fail(`Missing required governance file: ${required}`);

const expectedEnvExample = {
  WOO_BASE_URL: "https://www.example.invalid",
  WOO_CONSUMER_KEY: "change-me-read-only-key",
  WOO_CONSUMER_SECRET: "change-me-read-only-secret",
  WOO_MCP_TOKEN: "change-me-connector-token",
  GOOGLE_PROJECT_ID: "change-me-project",
  GOOGLE_ADS_DEVELOPER_TOKEN: "change-me-developer-token",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "0000000000",
  GOOGLE_MCP_TOKEN: "change-me-connector-token",
  GOOGLE_ADC_HOST_PATH: "/absolute/path/to/application-default-credentials.json",
  GOOGLE_OAUTH_CLIENT_HOST_PATH: "/absolute/path/to/oauth-client.json",
  GSC_TOKEN_HOST_DIR: "/absolute/path/to/gsc-token-directory",
};
const actualEnvExample = {};
for (const line of readFileSync(join(packageDir, ".env.example"), "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    fail(`Invalid .env.example line: ${trimmed}`);
    continue;
  }
  const key = trimmed.slice(0, separator);
  if (Object.prototype.hasOwnProperty.call(actualEnvExample, key)) fail(`Duplicate .env.example key: ${key}`);
  actualEnvExample[key] = trimmed.slice(separator + 1);
}
if (Object.keys(actualEnvExample).sort().join(",") !== Object.keys(expectedEnvExample).sort().join(",")) fail(".env.example must contain only the reviewed portable placeholder keys");
for (const [key, value] of Object.entries(expectedEnvExample)) if (actualEnvExample[key] !== value) fail(`.env.example must keep the reviewed placeholder value for ${key}`);

const agentFiles = filesBelow(join(packageDir, "agents")).filter((path) => path.endsWith(`${sep}AGENTS.md`));
const agents = new Map();
for (const path of agentFiles) {
  const doc = frontmatter(path);
  if (!slugPattern.test(doc.slug || "")) fail(`Invalid agent slug in ${relative(packageDir, path)}`);
  if (agents.has(doc.slug)) fail(`Duplicate agent slug: ${doc.slug}`);
  if (doc.slug !== relative(join(packageDir, "agents"), dirname(path)).split(sep).pop()) fail(`Agent directory/slug mismatch: ${doc.slug}`);
  agents.set(doc.slug, doc);
}
if (agents.size !== 6) fail(`Expected 6 agents, found ${agents.size}`);
const roots = [...agents.values()].filter((agent) => agent.reportsTo === null);
if (roots.length !== 1 || roots[0]?.slug !== "director-operaciones") fail("Organization must have exactly one Director root");
for (const agent of agents.values()) {
  if (agent.reportsTo && !agents.has(agent.reportsTo)) fail(`Unknown manager ${agent.reportsTo} for ${agent.slug}`);
  for (const skill of agent.skills || []) {
    if (!statSafe(join(packageDir, "skills", skill, "SKILL.md"))) fail(`Unknown skill ${skill} for ${agent.slug}`);
  }
  const visited = new Set([agent.slug]);
  let current = agent;
  while (current?.reportsTo) {
    if (visited.has(current.reportsTo)) { fail(`Reporting cycle at ${agent.slug}`); break; }
    visited.add(current.reportsTo);
    current = agents.get(current.reportsTo);
  }
}

function statSafe(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

const skillFiles = filesBelow(join(packageDir, "skills")).filter((path) => path.endsWith(`${sep}SKILL.md`));
for (const path of skillFiles) {
  const doc = frontmatter(path);
  const skillDir = dirname(path);
  const folder = relative(join(packageDir, "skills"), skillDir).split(sep)[0];
  if (doc.name !== folder || !slugPattern.test(doc.name || "")) fail(`Skill name/path mismatch in ${relative(packageDir, path)}`);
  if (!statSafe(join(skillDir, "examples", readdirSync(join(skillDir, "examples"))[0] || "missing"))) fail(`Skill has no example: ${doc.name}`);
  if (!statSafe(join(skillDir, "fixtures", readdirSync(join(skillDir, "fixtures"))[0] || "missing"))) fail(`Skill has no fixture: ${doc.name}`);

  const skillText = readFileSync(path, "utf8");
  if (/(?:^|[\s('"`])\.\.\//m.test(skillText)) fail(`Skill path escapes its portable subtree: ${doc.name}`);
  for (const link of skillText.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = link[1].trim().replace(/^<|>$/g, "");
    const target = rawTarget.split(/\s+/)[0].split("#")[0];
    if (!target || target.startsWith("#") || /^(?:https?:|mailto:)/i.test(target)) continue;
    const resolvedTarget = resolve(skillDir, target);
    if (resolvedTarget !== skillDir && !resolvedTarget.startsWith(`${skillDir}${sep}`)) {
      fail(`Skill link escapes its portable subtree: ${doc.name} -> ${target}`);
    } else if (!statSafe(resolvedTarget)) {
      fail(`Skill link target is missing: ${doc.name} -> ${target}`);
    }
  }
}
if (skillFiles.length !== 8) fail(`Expected 8 skills, found ${skillFiles.length}`);

const mirrorContract = jsonYaml("runtime/skill-reference-mirrors.json");
if (mirrorContract.schema !== "enki-skill-reference-mirrors/v1") fail("Unexpected skill reference mirror schema");
const declaredMirrors = new Set();
for (const [canonical, mirrors] of Object.entries(mirrorContract.mirrors || {})) {
  const canonicalPath = join(packageDir, canonical);
  if (!statSafe(canonicalPath)) {
    fail(`Canonical skill reference is missing: ${canonical}`);
    continue;
  }
  const canonicalSha256 = createHash("sha256").update(readFileSync(canonicalPath)).digest("hex");
  if (!Array.isArray(mirrors) || mirrors.length === 0) fail(`Canonical skill reference has no declared runtime mirror: ${canonical}`);
  for (const mirror of mirrors || []) {
    if (declaredMirrors.has(mirror)) fail(`Runtime skill reference mirror is declared more than once: ${mirror}`);
    declaredMirrors.add(mirror);
    const mirrorPath = join(packageDir, mirror);
    if (!statSafe(mirrorPath)) {
      fail(`Runtime skill reference mirror is missing: ${mirror}`);
      continue;
    }
    const mirrorSha256 = createHash("sha256").update(readFileSync(mirrorPath)).digest("hex");
    if (mirrorSha256 !== canonicalSha256) fail(`Runtime skill reference mirror hash drift: ${mirror}`);
  }
}
const actualMirrors = filesBelow(join(packageDir, "skills"))
  .map((path) => relative(packageDir, path).split(sep).join("/"))
  .filter((path) => /^skills\/[^/]+\/references\//.test(path));
for (const mirror of actualMirrors) if (!declaredMirrors.has(mirror)) fail(`Runtime skill reference mirror is not governed by the hash matrix: ${mirror}`);
for (const mirror of declaredMirrors) if (!actualMirrors.includes(mirror)) fail(`Declared runtime skill reference mirror is not present: ${mirror}`);

const projectFiles = filesBelow(join(packageDir, "projects")).filter((path) => path.endsWith(`${sep}PROJECT.md`));
const projects = new Set();
for (const path of projectFiles) {
  const doc = frontmatter(path);
  if (!slugPattern.test(doc.slug || "")) fail(`Invalid project slug in ${relative(packageDir, path)}`);
  if (!agents.has(doc.owner)) fail(`Unknown project owner ${doc.owner}`);
  projects.add(doc.slug);
}
if (projects.size !== 4) fail(`Expected 4 projects, found ${projects.size}`);

const taskFiles = filesBelow(join(packageDir, "projects")).filter((path) => path.endsWith(`${sep}TASK.md`));
const tasks = new Map();
for (const path of taskFiles) {
  const doc = frontmatter(path);
  if (!slugPattern.test(doc.slug || "")) fail(`Invalid task slug in ${relative(packageDir, path)}`);
  if (tasks.has(doc.slug)) fail(`Duplicate task slug: ${doc.slug}`);
  if (!projects.has(doc.project)) fail(`Unknown project ${doc.project} for ${doc.slug}`);
  if (!agents.has(doc.assignee)) fail(`Unknown assignee ${doc.assignee} for ${doc.slug}`);
  if (doc.slug !== basename(dirname(path))) fail(`Task directory/slug mismatch: ${doc.slug}`);
  tasks.set(doc.slug, doc);
}
if (tasks.size !== 9) fail(`Expected 9 tasks, found ${tasks.size}`);
const recurring = [...tasks.values()].filter((task) => task.recurring === true).map((task) => task.slug).sort();
if (recurring.join(",") !== "daily-operating-brief,weekly-operating-review") fail("Unexpected recurring task set");

const extension = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
if (!/^schema: paperclip\/v1$/m.test(extension)) fail(".paperclip.yaml must use paperclip/v1");
if (!/^schemaVersion: 7$/m.test(extension)) fail(".paperclip.yaml must target bundle schemaVersion 7");
const agentsSection = extension.match(/\nagents:\n([\s\S]*?)\ntasks:\n/)?.[1] || "";
const configuredAgentSlugs = [...agentsSection.matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]).sort();
if (configuredAgentSlugs.join(",") !== [...agents.keys()].sort().join(",")) fail(".paperclip.yaml agent set must exactly match agents/");
for (const slug of agents.keys()) {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = agentsSection.match(new RegExp(`(?:^|\\n)  ${escaped}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`))?.[1] || "";
  if (!block.includes("type: codex_local")) fail(`${slug} is not configured with codex_local`);
  if (!/engine: cli/.test(block)) fail(`${slug} must use the Codex CLI engine`);
  if (!/model: gpt-5\.6-sol/.test(block)) fail(`${slug} must pin model gpt-5.6-sol`);
  if (!/dangerouslyBypassApprovalsAndSandbox: false/.test(block)) fail(`${slug} must keep sandbox bypass disabled`);
  if ((block.match(/- --skip-git-repo-check/g) || []).length !== 1) fail(`${slug} must carry exactly one --skip-git-repo-check for generated non-git workspaces`);
  if (/- --sandbox\n/.test(block)) fail(`${slug} must not mix legacy --sandbox selection with its named permission profile`);
  if (!/- approval_policy="never"/.test(block)) fail(`${slug} must enforce approval_policy=never`);
  if (!/- default_permissions="enki-readonly-network"/.test(block)) fail(`${slug} must select the Enki read-only network permission profile`);
  if (!/- permissions\.enki-readonly-network\.extends=":read-only"/.test(block)) fail(`${slug} must inherit the Codex read-only filesystem profile`);
  if (!/- permissions\.enki-readonly-network\.network\.enabled=true/.test(block)) fail(`${slug} must enable the network path required for Paperclip API calls`);
  if (!/- features\.use_legacy_landlock=true/.test(block)) fail(`${slug} must use the Landlock fallback required by the restrictive Docker runtime`);
  if (/sandbox_workspace_write\./.test(block)) fail(`${slug} must not carry workspace-write settings in the read-only v1 profile`);
  if (!/heartbeat:\n\s+enabled: false/.test(block)) fail(`${slug} heartbeat must be disabled`);
  if (!/maxConcurrentRuns: 1/.test(block)) fail(`${slug} maxConcurrentRuns must be 1`);
  if (!/runtime:\n\s+managedMcpOnly: true/.test(block)) fail(`${slug} must accept MCP servers only through Paperclip-managed runtime delivery`);
  if (!/canCreateAgents: false/.test(block)) fail(`${slug} must not be able to create agents`);
  if (/\benv:/.test(block)) fail(`${slug} must not embed environment values; managed CODEX_HOME is assigned during import`);
}
for (const expected of [
  'cronExpression: "0 8 * * 1-5"',
  'cronExpression: "0 9 * * 1"',
  "timezone: Europe/Madrid",
  "enabled: false",
  "concurrencyPolicy: coalesce_if_active",
  "catchUpPolicy: skip_missed",
]) if (!extension.includes(expected)) fail(`Missing routine setting: ${expected}`);

const compatibility = jsonYaml("runtime/compatibility.lock.yaml");
if (compatibility.schema !== "enki-runtime-compatibility/v1") fail("Unexpected runtime compatibility schema");
if (compatibility.packageVersion !== "0.1.0") fail("Compatibility lock package version must match 0.1.0");
if (compatibility.paperclipBundleSchemaVersion !== 7) fail("Compatibility lock must target bundle schemaVersion 7");
if (compatibility.paperclip?.upstreamBaseCommit !== "35fca95626a04f5a7ec42cf95989c3d779a1687e") fail("Compatibility lock must identify the reviewed Paperclip base commit");
if (compatibility.codex?.managedMcpDefaultToolsApprovalMode !== "approve") fail("Compatibility lock must delegate managed MCP dispatch approval to the Paperclip gateway");
if (!String(compatibility.codex?.managedMcpApprovalModeStatus || "").includes("verified")) fail("Managed MCP approval mode must carry verified runtime evidence");
for (const [label, digest, status] of [
  ["Paperclip image", compatibility.paperclip?.imageDigest, compatibility.paperclip?.imageStatus],
  ["WooCommerce connector image", compatibility.connectors?.woocommerce?.imageDigest, compatibility.connectors?.woocommerce?.imageStatus],
  ["Google connector image", compatibility.connectors?.google?.imageDigest, compatibility.connectors?.google?.imageStatus],
]) {
  if (digest !== null) fail(`${label} digest must remain null until independently verified`);
  if (typeof status !== "string" || !status.includes("pending")) fail(`${label} status must explicitly remain pending`);
}
for (const [label, digest, status] of [
  ["connector Node base image", compatibility.runtimes?.connectorNodeImageDigest, compatibility.runtimes?.connectorNodeImageStatus],
  ["uv base image", compatibility.runtimes?.uvImageDigest, compatibility.runtimes?.uvImageStatus],
]) {
  const pending = digest === null && typeof status === "string" && status.includes("pending");
  const verified = /^sha256:[0-9a-f]{64}$/.test(digest || "") && typeof status === "string" && status.includes("verified") && !status.includes("pending");
  if (!pending && !verified) fail(`${label} must be either null/pending or a verified sha256 digest`);
}
if (compatibility.runtimes?.connectorNodeImageDigest !== "sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57") fail("Connector Node base image digest drift");
if (compatibility.runtimes?.uvImageDigest !== "sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede") fail("uv base image digest drift");
const nodeImagePin = "node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57";
const uvImagePin = "ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm-slim@sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede";
const wooDockerfile = readFileSync(join(packageDir, "connectors", "woocommerce-readonly-mcp", "Dockerfile"), "utf8");
const googleDockerfile = readFileSync(join(packageDir, "connectors", "google-mcps", "Dockerfile"), "utf8");
if (!wooDockerfile.includes(`FROM ${nodeImagePin}`) || !googleDockerfile.includes(`FROM ${nodeImagePin} AS node-runtime`)) fail("Connector Dockerfiles must consume the verified Node digest");
if (!googleDockerfile.includes(`FROM ${uvImagePin}`)) fail("Google connector Dockerfile must consume the verified uv digest");

const desired = jsonYaml("policies/desired-state.yaml");
if (desired.schema !== "enki-runtime-desired-state/v1" || desired.mode !== "audit-only") fail("Desired state must be audit-only enki-runtime-desired-state/v1");
if (desired.rejectUnexpectedActiveConnections !== true) fail("Desired state must reject unexpected active connections");
if (desired.rejectUnexpectedAgents !== true) fail("Desired state must reject unexpected agents");
if (desired.rejectUnexpectedProfiles !== true) fail("Desired state must reject unexpected profiles");
if (desired.rejectUnexpectedPolicies !== true) fail("Desired state must reject unexpected policies");
if (desired.rejectUnexpectedGateways !== true) fail("Desired state must reject unexpected gateways");
if (desired.rejectUnexpectedGatewayProfileBindings !== true) fail("Desired state must reject unexpected gateway profile bindings");
if (desired.rejectPersistentGatewayTokens !== true) fail("Desired state must reject persistent gateway client tokens");
if (desired.rejectUnexpectedRoutines !== true) fail("Desired state must reject unexpected routines");
if (desired.requirePositiveMonthlyBudget !== true) fail("Desired state must require positive agent budget hard caps");
if (desired.requirePositiveCompanyMonthlyBudget !== true) fail("Desired state must require a positive company budget hard cap");
if (desired.connections?.length !== 4 || desired.profiles?.length !== 6 || desired.policies?.length !== 1 || desired.gateways?.length !== 6) fail("Desired state must define 4 connections, 6 profiles, 1 global block policy, and 6 governed gateways");
const desiredToolNames = new Set((desired.connections || []).flatMap((connection) => connection.tools || []));
const desiredProfileAgents = new Set();
for (const profile of desired.profiles || []) {
  if (profile.defaultAction !== "deny" || profile.strictAllowedTools !== true) fail(`Profile ${profile.profileKey || "unknown"} must be strict default-deny`);
  if (!agents.has(profile.agentSlug)) fail(`Desired profile references unknown agent: ${profile.agentSlug || "unknown"}`);
  if (desiredProfileAgents.has(profile.agentSlug)) fail(`Desired state has multiple profiles for agent: ${profile.agentSlug}`);
  desiredProfileAgents.add(profile.agentSlug);
  for (const tool of profile.allowedTools || []) if (!desiredToolNames.has(tool)) fail(`Profile ${profile.profileKey || "unknown"} references tool outside strict catalogs: ${tool}`);
}
for (const connection of desired.connections || []) {
  const credential = connection.requiredCredential || {};
  if (connection.transport !== "mcp_remote" || connection.authKind !== "api_key") fail(`Connection ${connection.key || "unknown"} must use authenticated remote MCP transport`);
  if (credential.placement !== "header" || credential.key !== "Authorization" || credential.prefix !== "Bearer ") fail(`Connection ${connection.key || "unknown"} must require a secret-backed Bearer header`);
}
const desiredProfilesByKey = new Map((desired.profiles || []).map((profile) => [profile.profileKey, profile]));
const gatewayKeys = new Set();
const gatewayNames = new Set();
const gatewaySlugs = new Set();
const gatewayAgents = new Set();
const gatewayProfiles = new Set();
for (const gateway of desired.gateways || []) {
  if (!slugPattern.test(gateway.key || "")) fail(`Invalid desired gateway key: ${gateway.key || "unknown"}`);
  if (!slugPattern.test(gateway.slug || "")) fail(`Invalid desired gateway slug: ${gateway.slug || "unknown"}`);
  if (typeof gateway.name !== "string" || gateway.name.trim().length === 0) fail(`Desired gateway ${gateway.key || "unknown"} must have a name`);
  for (const [label, value, seen] of [
    ["key", gateway.key, gatewayKeys],
    ["name", gateway.name, gatewayNames],
    ["slug", gateway.slug, gatewaySlugs],
    ["agent", gateway.agentSlug, gatewayAgents],
    ["profile", gateway.profileKey, gatewayProfiles],
  ]) {
    if (seen.has(value)) fail(`Duplicate desired gateway ${label}: ${value || "unknown"}`);
    seen.add(value);
  }
  const profile = desiredProfilesByKey.get(gateway.profileKey);
  if (!agents.has(gateway.agentSlug)) fail(`Desired gateway references unknown agent: ${gateway.agentSlug || "unknown"}`);
  if (!profile) fail(`Desired gateway references unknown profile: ${gateway.profileKey || "unknown"}`);
  else if (profile.agentSlug !== gateway.agentSlug) fail(`Desired gateway ${gateway.key || "unknown"} profile does not belong to ${gateway.agentSlug || "unknown"}`);
  if (gateway.status !== "active" || gateway.defaultProfileMode !== "gateway_only" || gateway.contextScopeType !== "agent") fail(`Desired gateway ${gateway.key || "unknown"} must be active, gateway-only, and agent-scoped`);
}
if (gatewayAgents.size !== agents.size || gatewayProfiles.size !== desiredProfilesByKey.size) fail("Desired gateways must cover every Enki agent and profile exactly once");
const blockPolicy = desired.policies?.[0] || {};
if (blockPolicy.name !== "Enki block write and destructive tools" || blockPolicy.policyType !== "block" || blockPolicy.priority !== 1000 || blockPolicy.enabled !== true || [...(blockPolicy.requiredRiskLevels || [])].sort().join(",") !== "destructive,write") fail("Desired state must contain the exact global write/destructive block policy");
const desiredRuntime = desired.agentRuntime || {};
for (const [key, value] of Object.entries({
  adapterType: "codex_local",
  engine: "cli",
  model: "gpt-5.6-sol",
  dangerouslyBypassApprovalsAndSandbox: false,
  skipGitRepoCheck: true,
  sandbox: "read-only",
  permissionProfile: "enki-readonly-network",
  permissionProfileExtends: ":read-only",
  approvalPolicy: "never",
  managedMcpDefaultToolsApprovalMode: "approve",
  networkAccess: true,
  useLegacyLandlock: true,
  heartbeatEnabled: false,
  maxConcurrentRuns: 1,
  managedMcpOnly: true,
  requireUniqueManagedCodexHome: true,
  requireEmptyOpenAiApiKey: true,
})) if (desiredRuntime[key] !== value) fail(`Unexpected desired agent runtime value: ${key}`);
const desiredRoutines = new Map((desired.routines || []).map((routine) => [routine.key, routine]));
for (const [key, cronExpression] of [["daily-operating-brief", "0 8 * * 1-5"], ["weekly-operating-review", "0 9 * * 1"]]) {
  const routine = desiredRoutines.get(key);
  if (!routine || routine.status !== "paused" || routine.concurrencyPolicy !== "coalesce_if_active" || routine.catchUpPolicy !== "skip_missed" || routine.strictTriggers !== true) fail(`Unexpected desired routine settings: ${key}`);
  const triggers = routine?.triggers || [];
  if (triggers.length !== 1 || triggers[0]?.kind !== "schedule" || triggers[0]?.enabled !== false || triggers[0]?.cronExpression !== cronExpression || triggers[0]?.timezone !== "Europe/Madrid") fail(`Unexpected desired routine trigger: ${key}`);
}
if (desiredRoutines.size !== 2) fail("Desired state must contain exactly the daily and weekly routines");

const inventory = jsonYaml("references/inventory.yaml");
if (inventory.schema !== "enki-knowledge/v1" || inventory.source?.license !== "LicenseRef-Enki-Hogar-Internal") fail("Knowledge inventory must identify its schema and internal license");
if (inventory.source?.revision !== null || !String(inventory.source?.revisionStatus || "").startsWith("pending_")) fail("Unverified source revision must remain null and explicitly pending");
for (const document of inventory.documents || []) {
  const targetPath = join(packageDir, "references", document.target || "");
  if (!statSafe(targetPath)) {
    fail(`Knowledge inventory target is missing: ${document.target || "unknown"}`);
    continue;
  }
  const actualSha256 = createHash("sha256").update(readFileSync(targetPath)).digest("hex");
  if (document.targetSha256 !== actualSha256) fail(`Knowledge inventory hash drift: ${document.target}`);
  if (!Array.isArray(document.sourcePaths) || document.sourcePaths.length === 0) fail(`Knowledge inventory lacks sources: ${document.target}`);
  if (document.sensitivity !== "enki_internal") fail(`Knowledge inventory sensitivity must be enki_internal: ${document.target}`);
}
for (const document of inventory.internalDocuments || []) {
  const targetPath = join(packageDir, "references", document.target || "");
  if (!statSafe(targetPath)) {
    fail(`Internal knowledge target is missing: ${document.target || "unknown"}`);
    continue;
  }
  const actualSha256 = createHash("sha256").update(readFileSync(targetPath)).digest("hex");
  if (document.targetSha256 !== actualSha256) fail(`Internal knowledge hash drift: ${document.target}`);
  if (document.origin !== "package-authored" || document.license !== "LicenseRef-Enki-Hogar-Internal" || document.sensitivity !== "enki_internal") fail(`Unexpected internal document provenance: ${document.target}`);
}
if ((inventory.internalDocuments || []).length !== 2) fail("Knowledge inventory must include both package-authored metric and evidence contracts");
const wordpressImplementationPath = join(packageDir, "skills", "wordpress-publisher", "scripts", "wordpress_publisher.py");
const wordpressImplementationSha256 = statSafe(wordpressImplementationPath)
  ? createHash("sha256").update(readFileSync(wordpressImplementationPath)).digest("hex")
  : null;
if (wordpressImplementationSha256 !== "656486d82ad1d293354824bede2947730c74f9e5fc855fbfedaa47b2e9a0580e") fail("WordPress restricted adaptation hash drift; update provenance before release");

const allFiles = filesBelow(packageDir);
for (const path of allFiles) {
  const portable = relative(packageDir, path).split(sep).join("/");
  if (/^(?:auth_.*\.json|google-ads\.yaml|application_default_credentials\.json|tokens\.json)$/i.test(portable.split("/").pop())) fail(`Forbidden credential file: ${portable}`);
  if (/\.(?:pdf|png|jpe?g|zip|sqlite|db)$/i.test(portable)) fail(`Forbidden binary/export file: ${portable}`);
  const text = readFileSync(path, "utf8");
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(text)) fail(`Database-like UUID found in ${portable}`);
  if (!portable.startsWith("scripts/") && /(?:\/Users\/[^\s`"']+|\/home\/[^\s`"']+|[A-Za-z]:\\\\Users\\\\)/.test(text)) fail(`Machine-specific absolute path found in ${portable}`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Package valid: ${agents.size} agents, ${skillFiles.length} skills, ${projects.size} projects, ${tasks.size} tasks, ${recurring.length} routines.`);
