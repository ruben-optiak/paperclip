#!/usr/bin/env node
import {createHash} from "node:crypto";
import {lstatSync, readFileSync, readdirSync, statSync} from "node:fs";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

import {validateCatalogRegressionSuite} from "../skills/enki-catalog-qa/scripts/validate_catalog_regression.mjs";
import {validateCatalogReconciliationFixture} from "../skills/enki-catalog-qa/scripts/validate_catalog_reconciliation.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const symlinkPaths = [];

function filesBelow(root) {
  const found = [];
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === ".venv" || entry === "__pycache__" || entry === "source-snapshots" || entry === ".runtime-secrets") continue;
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
if (company.version !== "0.12.0") fail("Unexpected package version");
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
  PAPERCLIP_TOOL_ACTION_SIGNING_SECRET: "change-me-tool-action-signing-secret",
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
  SUPPORT_DB_ADMIN_PASSWORD: "change-me-admin-password",
  SUPPORT_DB_READER_PASSWORD: "change-me-reader-password",
  SUPPORT_MCP_TOKEN: "change-me-connector-token",
  SUPPORT_EMBEDDING_BASE_URL: "",
  SUPPORT_EMBEDDING_API_KEY: "",
  SUPPORT_EMBEDDING_MODEL: "",
  CONTENT_PUBLISHER_MCP_TOKEN: "change-me-connector-token",
  CONTENT_PUBLISH_WRITE_MODE: "disabled",
  WORDPRESS_BASE_URL: "",
  WORDPRESS_USERNAME: "",
  WORDPRESS_APP_PASSWORD: "",
  META_GRAPH_API_VERSION: "",
  META_GRAPH_BASE_URL: "https://graph.facebook.com",
  META_INSTAGRAM_GRAPH_BASE_URL: "",
  META_GRAPH_ACCESS_TOKEN: "",
  META_FACEBOOK_PAGE_ID: "",
  META_INSTAGRAM_USER_ID: "",
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
  if (filesBelow(join(skillDir, "examples")).length === 0) fail(`Skill has no example: ${doc.name}`);
  if (filesBelow(join(skillDir, "fixtures")).length === 0) fail(`Skill has no fixture: ${doc.name}`);

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
if (skillFiles.length !== 12) fail(`Expected 12 skills, found ${skillFiles.length}`);

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

const catalogRegression = validateCatalogRegressionSuite({
  manifestPath: join(packageDir, "skills", "enki-catalog-qa", "fixtures", "catalog-regression", "v1", "manifest.json"),
});
if (!catalogRegression.valid) {
  for (const error of catalogRegression.errors) fail(`Catalogue regression ${error.code} at ${error.path}: ${error.message}`);
}
if (catalogRegression.summary?.suiteVersion !== "1.0.0" || catalogRegression.summary?.fixtures !== 6 || catalogRegression.summary?.evidenceRecords !== 21) fail("Catalogue regression summary drift");
if ((catalogRegression.summary?.brands || []).join(",") !== "buades,chicandbath,enki-espejos,mundilite") fail("Catalogue regression brand coverage drift");
if ((catalogRegression.summary?.features || []).join(",") !== "columns,configurator,detail,finish_matrix,grid,multi_sku_price,table") fail("Catalogue regression feature coverage drift");
if (catalogRegression.summary?.duplicateWooHeaders !== 2) fail("Catalogue regression must preserve the two reviewed duplicate Woo headers");

const catalogReconciliation = validateCatalogReconciliationFixture({
  manifestPath: join(packageDir, "skills", "enki-catalog-qa", "fixtures", "catalog-reconciliation", "v1", "manifest.json"),
});
if (!catalogReconciliation.valid) {
  for (const error of catalogReconciliation.errors) fail(`Catalogue reconciliation ${error.code} at ${error.path}: ${error.message}`);
}
if (catalogReconciliation.summary?.files !== 5 || catalogReconciliation.summary?.entities !== 2 || catalogReconciliation.summary?.candidates !== 5 || catalogReconciliation.summary?.expectedChanges !== 3 || catalogReconciliation.summary?.expectedMatches !== 2) fail("Catalogue reconciliation fixture coverage drift");

const catalogAdapterRegistryPath = join(packageDir, "scripts", "catalog-pipeline", "adapters", "registry.json");
const catalogAdapterRegistry = jsonYaml("scripts/catalog-pipeline/adapters/registry.json");
if (catalogAdapterRegistry.schema !== "enki-catalog-adapter-registry/v1" || catalogAdapterRegistry.version !== "1.0.0" || catalogAdapterRegistry.coreVersion !== "0.2.0") fail("Catalogue adapter registry identity drift");
if (catalogAdapterRegistry.inputContract !== "classified_page_geometry/v1" || catalogAdapterRegistry.outputContract !== "enki-catalog-adapter-result/v1") fail("Catalogue adapter input/output contract drift");
if ((catalogAdapterRegistry.adapters || []).length !== 4) fail("Catalogue adapter registry must define exactly four adapters");
const catalogAdapterBrands = new Set();
const catalogAdapterFixtures = new Set();
let catalogAdapterExpectedPairs = 0;
for (const entry of catalogAdapterRegistry.adapters || []) {
  const definitionPath = join(dirname(catalogAdapterRegistryPath), entry.path || "");
  if (dirname(definitionPath) !== dirname(catalogAdapterRegistryPath) || !statSafe(definitionPath)) {
    fail(`Catalogue adapter definition path is not a direct portable file: ${entry.adapterKey || "unknown"}`);
    continue;
  }
  const definitionBytes = readFileSync(definitionPath);
  const definitionSha256 = createHash("sha256").update(definitionBytes).digest("hex");
  if (definitionSha256 !== entry.sha256) fail(`Catalogue adapter definition hash drift: ${entry.adapterKey || "unknown"}`);
  let definition = {};
  try { definition = JSON.parse(definitionBytes.toString("utf8")); } catch { fail(`Catalogue adapter definition must be JSON: ${entry.adapterKey || "unknown"}`); continue; }
  if (definition.schema !== "enki-catalog-adapter/v1" || definition.version !== "1.0.0" || definition.adapterKey !== entry.adapterKey || definition.brandSlug !== entry.brandSlug || definition.implementation !== entry.implementation) fail(`Catalogue adapter definition identity drift: ${entry.adapterKey || "unknown"}`);
  if (catalogAdapterBrands.has(entry.brandSlug)) fail(`Duplicate catalogue adapter brand: ${entry.brandSlug || "unknown"}`);
  catalogAdapterBrands.add(entry.brandSlug);
  if (definition.scope?.unknownSnapshots !== "deny" || definition.scope?.unknownPages !== "deny" || definition.scope?.inputStage !== "classified_page_geometry") fail(`Catalogue adapter must deny unknown scope: ${entry.adapterKey || "unknown"}`);
  const bindings = definition.fixtureBindings || [];
  if (definition.qualityGate?.expectedFixtureCount !== bindings.length || definition.qualityGate?.minimumFixturePassRate !== 1 || definition.qualityGate?.minimumSubjectCoverage !== 1 || definition.qualityGate?.maximumPairErrorRate !== 0) fail(`Catalogue adapter quality gate drift: ${entry.adapterKey || "unknown"}`);
  const expectedPairs = bindings.reduce((sum, binding) => sum + Number(binding.expectedPairCount || 0), 0);
  if (definition.qualityGate?.expectedPairCount !== expectedPairs) fail(`Catalogue adapter pair-count declaration drift: ${entry.adapterKey || "unknown"}`);
  catalogAdapterExpectedPairs += expectedPairs;
  for (const binding of bindings) {
    if (catalogAdapterFixtures.has(binding.fixtureKey)) fail(`Catalogue fixture has multiple adapter owners: ${binding.fixtureKey || "unknown"}`);
    catalogAdapterFixtures.add(binding.fixtureKey);
  }
  if (definition.authority?.isLiveCommercialTruth !== false || definition.authority?.isExternalMutationAuthority !== false || definition.authority?.canGenerateWooImport !== false || definition.authority?.outputMode !== "local_observation_only") fail(`Catalogue adapter authority drift: ${entry.adapterKey || "unknown"}`);
}
if ([...catalogAdapterBrands].sort().join(",") !== "buades,chicandbath,enki-espejos,mundilite") fail("Catalogue adapter brand coverage drift");
if (catalogAdapterFixtures.size !== 6 || catalogAdapterExpectedPairs !== 21) fail("Catalogue adapter fixture or pair coverage drift");
const corePromotions = catalogAdapterRegistry.corePromotions || [];
if (corePromotions.length !== 1 || corePromotions[0]?.strategy !== "row_left_to_right" || new Set(corePromotions[0]?.evidenceBrands || []).size < 2) fail("Catalogue core promotion must retain exact multi-brand evidence");

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
if (tasks.size !== 11) fail(`Expected 11 tasks, found ${tasks.size}`);
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
  if (!/- "permissions\.enki-readonly-network\.extends=\\":read-only\\""/.test(block)) fail(`${slug} must inherit the Codex read-only filesystem profile with a YAML-safe quoted scalar`);
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
if (compatibility.packageVersion !== "0.12.0") fail("Compatibility lock package version must match 0.12.0");
if (compatibility.paperclipBundleSchemaVersion !== 7) fail("Compatibility lock must target bundle schemaVersion 7");
if (compatibility.connectors?.woocommerce?.version !== "0.2.1") fail("Compatibility lock must pin WooCommerce connector 0.2.1");
if (compatibility.connectors?.google?.version !== "0.1.1") fail("Compatibility lock must pin Google connector runtime 0.1.1");
if (compatibility.connectors?.telegramGateway?.version !== "0.2.0") fail("Compatibility lock must pin Telegram gateway 0.2.0");
if (compatibility.connectors?.telegramGateway?.pluginApiVersion !== 1) fail("Telegram gateway must target plugin API v1");
if (compatibility.connectors?.productSupportKnowledge?.version !== "0.2.0") fail("Compatibility lock must pin product-support connector 0.2.0");
if (compatibility.connectors?.productSupportKnowledge?.postgresClient !== "3.4.9") fail("Compatibility lock must pin the support PostgreSQL client");
if (compatibility.connectors?.productSupportKnowledge?.databaseImageDigest !== "sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f") fail("Product-support pgvector image digest drift");
if (compatibility.connectors?.productSupportKnowledge?.agentDatabaseRoleStatus !== "verified_read_only_by_integration_test") fail("Support reader role must carry integration-test evidence");
if (compatibility.connectors?.contentPublisher?.version !== "0.1.0") fail("Compatibility lock must pin content publisher connector 0.1.0");
if (compatibility.connectors?.contentPublisher?.mcpSdk !== "1.30.0" || compatibility.connectors?.contentPublisher?.zod !== "4.4.3") fail("Compatibility lock must pin content publisher dependencies");
if (compatibility.paperclip?.upstreamBaseCommit !== "35fca95626a04f5a7ec42cf95989c3d779a1687e") fail("Compatibility lock must identify the reviewed Paperclip base commit");
if (compatibility.codex?.managedMcpDefaultToolsApprovalMode !== "approve") fail("Compatibility lock must delegate managed MCP dispatch approval to the Paperclip gateway");
if (!String(compatibility.codex?.managedMcpApprovalModeStatus || "").includes("verified")) fail("Managed MCP approval mode must carry verified runtime evidence");
if (compatibility.codex?.managedSkillDelivery !== "materialized_copy_inside_run_scoped_home") fail("Managed Codex skills must be materialized inside the sandbox-readable run-scoped home");
for (const [label, digest, status] of [
  ["Paperclip image", compatibility.paperclip?.imageDigest, compatibility.paperclip?.imageStatus],
  ["WooCommerce connector image", compatibility.connectors?.woocommerce?.imageDigest, compatibility.connectors?.woocommerce?.imageStatus],
  ["Google connector image", compatibility.connectors?.google?.imageDigest, compatibility.connectors?.google?.imageStatus],
  ["Product-support connector image", compatibility.connectors?.productSupportKnowledge?.imageDigest, compatibility.connectors?.productSupportKnowledge?.imageStatus],
  ["Content publisher connector image", compatibility.connectors?.contentPublisher?.imageDigest, compatibility.connectors?.contentPublisher?.imageStatus],
  ["Catalogue pipeline image", compatibility.runtimes?.catalogPipeline?.imageDigest, compatibility.runtimes?.catalogPipeline?.imageStatus],
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
const catalogRegressionLock = compatibility.runtimes?.catalogPipeline?.regression || {};
if (catalogRegressionLock.version !== "1.0.0" || catalogRegressionLock.schema !== "enki-catalog-regression-suite/v1" || catalogRegressionLock.validator !== "enki-catalog-qa/scripts/validate_catalog_regression.mjs") fail("Catalogue regression compatibility lock drift");
if ([...(catalogRegressionLock.brands || [])].sort().join(",") !== "buades,chicandbath,enki-espejos,mundilite") fail("Catalogue regression compatibility brand drift");
if ([...(catalogRegressionLock.features || [])].sort().join(",") !== "columns,configurator,detail,finish_matrix,grid,multi_sku_price,table") fail("Catalogue regression compatibility feature drift");
if (catalogRegressionLock.evidenceContract !== "enki-catalog-field-evidence/v1" || catalogRegressionLock.status !== "verified_with_hashed_sanitized_multibrand_fixtures") fail("Catalogue regression compatibility evidence status drift");
const catalogAdapterLock = compatibility.runtimes?.catalogPipeline?.adapterRegistry || {};
const catalogAdapterRegistrySha256 = createHash("sha256").update(readFileSync(catalogAdapterRegistryPath)).digest("hex");
if (catalogAdapterLock.version !== "1.0.0" || catalogAdapterLock.schema !== "enki-catalog-adapter-registry/v1" || catalogAdapterLock.definitionSchema !== "enki-catalog-adapter/v1" || catalogAdapterLock.resultSchema !== "enki-catalog-adapter-result/v1") fail("Catalogue adapter compatibility contract drift");
if (catalogAdapterLock.registrySha256 !== catalogAdapterRegistrySha256) fail("Catalogue adapter registry compatibility hash drift");
if ([...(catalogAdapterLock.brands || [])].sort().join(",") !== "buades,chicandbath,enki-espejos,mundilite" || catalogAdapterLock.fixtureCount !== 6 || catalogAdapterLock.pairCount !== 21) fail("Catalogue adapter compatibility coverage drift");
if (catalogAdapterLock.subjectCoverage !== 1 || catalogAdapterLock.pairErrorRate !== 0 || catalogAdapterLock.status !== "verified_independently_against_immutable_eai019_oracle") fail("Catalogue adapter compatibility metrics drift");
if ([...(catalogAdapterLock.coreStrategies || [])].join(",") !== "row_left_to_right" || [...(catalogAdapterLock.adapterLocalStrategies || [])].join(",") !== "matrix_by_headers") fail("Catalogue adapter strategy ownership drift");
const catalogReconciliationLock = compatibility.runtimes?.catalogPipeline?.reconciliation || {};
if (catalogReconciliationLock.version !== "1.0.0" || catalogReconciliationLock.schema !== "enki-catalog-reconciliation-profile/v1" || catalogReconciliationLock.fixtureManifest !== "enki-catalog-reconciliation-fixture-manifest/v1") fail("Catalogue reconciliation compatibility contract drift");
if (catalogReconciliationLock.positionalHeaders !== true || catalogReconciliationLock.parentVariationIdentity !== true || catalogReconciliationLock.idempotentChangeSets !== true || catalogReconciliationLock.postImportAudit !== true || catalogReconciliationLock.canGenerateWooImport !== false || catalogReconciliationLock.status !== "verified_with_sanitized_exports_and_bounded_historical_layout_replay") fail("Catalogue reconciliation compatibility evidence drift");
const historicalLayoutReplayLock = catalogReconciliationLock.historicalLayoutReplay || {};
if (
  historicalLayoutReplayLock.schema !== "enki-bounded-historical-layout-replay-receipt/v1" ||
  historicalLayoutReplayLock.receipt !== "references/replay-receipts/eai-021-buades-2026-04-26.json" ||
  historicalLayoutReplayLock.sourceSnapshotSha256 !== "9ca8155e25cf0b658cd3a2868e64639602af62f71aef63b48b19d0aa13dc4a59" ||
  historicalLayoutReplayLock.rows !== 1196 ||
  historicalLayoutReplayLock.columns !== 376 ||
  historicalLayoutReplayLock.duplicateHeaderGroups !== 4 ||
  historicalLayoutReplayLock.artifactFingerprintSha256 !== "d4ce6190c1abdd1d365ddd83e844852853354d52351f27eaa613392398b72911" ||
  historicalLayoutReplayLock.sourceValuesRetained !== false ||
  historicalLayoutReplayLock.artifactsPersisted !== false ||
  historicalLayoutReplayLock.isCurrentCommercialTruth !== false
) fail("Catalogue bounded historical layout replay lock drift");
const nodeImagePin = "node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57";
const uvImagePin = "ghcr.io/astral-sh/uv:0.8.15-python3.12-bookworm-slim@sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede";
const wooDockerfile = readFileSync(join(packageDir, "connectors", "woocommerce-readonly-mcp", "Dockerfile"), "utf8");
const googleDockerfile = readFileSync(join(packageDir, "connectors", "google-mcps", "Dockerfile"), "utf8");
const catalogDockerfile = readFileSync(join(packageDir, "connectors", "catalog-knowledge", "Dockerfile"), "utf8");
const publisherDockerfile = readFileSync(join(packageDir, "connectors", "content-publisher", "Dockerfile"), "utf8");
if (!wooDockerfile.includes(`FROM ${nodeImagePin}`) || !googleDockerfile.includes(`FROM ${nodeImagePin} AS node-runtime`) || !catalogDockerfile.includes(`FROM ${nodeImagePin}`) || !publisherDockerfile.includes(`FROM ${nodeImagePin}`)) fail("Connector Dockerfiles must consume the verified Node digest");
if (!googleDockerfile.includes(`FROM ${uvImagePin}`)) fail("Google connector Dockerfile must consume the verified uv digest");

const catalogPipeline = compatibility.runtimes?.catalogPipeline || {};
if (
  catalogPipeline.version !== "0.3.0" ||
  catalogPipeline.python !== "3.12" ||
  catalogPipeline.renderer !== "pdfium" ||
  catalogPipeline.extractor !== "pdfplumber" ||
  catalogPipeline.pdfplumber !== "0.11.10" ||
  catalogPipeline.pypdfium2 !== "5.13.0" ||
  catalogPipeline.pillow !== "12.3.0"
) fail("Catalogue pipeline runtime versions must stay exactly pinned");
if (catalogPipeline.baseImageDigest !== compatibility.runtimes?.uvImageDigest) fail("Catalogue pipeline must consume the verified uv base-image digest");
if (catalogPipeline.networkMode !== "none" || catalogPipeline.inputMount !== "read_only" || catalogPipeline.outputMount !== "separate_read_write" || catalogPipeline.defaultDpi !== 300) fail("Catalogue pipeline isolation contract drift");
if (catalogPipeline.dependencyStatus !== "verified_from_pyproject_uv_lock_and_unit_tests") fail("Catalogue pipeline dependency evidence is missing");
const catalogContracts = catalogPipeline.contracts || {};
if (
  catalogContracts.catalogRun !== "enki-catalog-run/v1" ||
  catalogContracts.catalogFieldEvidence !== "enki-catalog-field-evidence/v1" ||
  catalogContracts.catalogChangeSet !== "enki-catalog-change-set/v1" ||
  catalogContracts.catalogReconciliation !== "enki-catalog-reconciliation/v1" ||
  catalogContracts.jsonSchema !== "2020-12-strict" ||
  catalogContracts.semanticValidator !== "enki-catalog-qa/scripts/validate_catalog_contracts.mjs" ||
  catalogContracts.reconciliationFixtureValidator !== "enki-catalog-qa/scripts/validate_catalog_reconciliation.mjs" ||
  catalogContracts.status !== "verified_with_sanitized_positive_and_negative_fixtures"
) fail("Catalogue contract compatibility evidence drift");
const catalogPipelineRoot = join(packageDir, "scripts", "catalog-pipeline");
const catalogPipelineProject = readFileSync(join(catalogPipelineRoot, "pyproject.toml"), "utf8");
const catalogPipelineLock = readFileSync(join(catalogPipelineRoot, "uv.lock"), "utf8");
const catalogPipelineDockerfile = readFileSync(join(catalogPipelineRoot, "Dockerfile"), "utf8");
const catalogPipelineRunner = readFileSync(join(catalogPipelineRoot, "run-docker.sh"), "utf8");
if (
  !/^name = "enki-catalog-pipeline"$/m.test(catalogPipelineProject) ||
  !/^version = "0\.3\.0"$/m.test(catalogPipelineProject) ||
  !/^requires-python = ">=3\.12,<3\.13"$/m.test(catalogPipelineProject) ||
  !/"pdfplumber==0\.11\.10"/.test(catalogPipelineProject) ||
  !/"Pillow==12\.3\.0"/.test(catalogPipelineProject) ||
  !/"pypdfium2==5\.13\.0"/.test(catalogPipelineProject)
) fail("Catalogue pipeline pyproject identity or dependency pin drift");
for (const [dependency, version] of [["pdfplumber", "0.11.10"], ["pillow", "12.3.0"], ["pypdfium2", "5.13.0"]]) {
  const escapedVersion = version.replaceAll(".", "\\.");
  if (!new RegExp(`name = "${dependency}"\\nversion = "${escapedVersion}"`).test(catalogPipelineLock) || !new RegExp(`name = "${dependency}", specifier = "==${escapedVersion}"`).test(catalogPipelineLock)) fail(`Catalogue pipeline uv.lock must pin ${dependency} ${version}`);
}
if (!catalogPipelineDockerfile.includes(`FROM ${uvImagePin}`) || !/COPY adapters \.\/adapters/.test(catalogPipelineDockerfile) || !/USER 65532:65532/.test(catalogPipelineDockerfile) || !/ENTRYPOINT \["\/app\/\.venv\/bin\/python", "-m", "enki_catalog_pipeline"\]/.test(catalogPipelineDockerfile)) fail("Catalogue pipeline Dockerfile must consume the pinned image, include locked adapters and run unprivileged");
if (/^\s*(?:ARG|EXPOSE)\b/m.test(catalogPipelineDockerfile)) fail("Catalogue pipeline image must not declare credential args or network ports");
for (const requiredFlag of ["--network none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "dst=/input,readonly", "dst=/output"]) if (!catalogPipelineRunner.includes(requiredFlag)) fail(`Catalogue pipeline runner isolation flag missing: ${requiredFlag}`);
if (/--env(?:-file)?\b/.test(catalogPipelineRunner)) fail("Catalogue pipeline runner must never inject environment or credential files");
const catalogPipelineSource = filesBelow(join(catalogPipelineRoot, "src")).map((path) => readFileSync(path, "utf8")).join("\n");
if (/\b(?:requests|httpx|urllib|socket)\b/.test(catalogPipelineSource)) fail("Catalogue pipeline source must remain networkless");
for (const requiredContract of ["enki-catalog-runtime/v1", "enki-catalog-adapter-result/v1", "enki-catalog-reconciliation-profile/v1", "enki-catalog-reconciliation-report/v1", "enki-catalog-post-import-audit/v1", "source_sha256", "image_path", "x0", "y0", "x1", "y1", "refusing to overwrite an existing run directory", "refusing to overwrite an existing reconciliation run", "canGenerateWooImport"]) if (!catalogPipelineSource.includes(requiredContract)) fail(`Catalogue pipeline contract is missing: ${requiredContract}`);
for (const forbiddenDependency of ["pymupdf", "fitz"]) if (catalogPipelineSource.toLowerCase().includes(forbiddenDependency)) fail(`Catalogue pipeline must not depend on AGPL/commercial PDF runtime: ${forbiddenDependency}`);

const wooPackage = jsonYaml("connectors/woocommerce-readonly-mcp/package.json");
if (wooPackage.name !== "@enki-hogar/woocommerce-readonly-mcp" || wooPackage.version !== "0.2.1") fail("Unexpected WooCommerce connector package identity");
const wooTools = readFileSync(join(packageDir, "connectors", "woocommerce-readonly-mcp", "src", "tools.mjs"), "utf8");
for (const tool of ["woo_sales_summary", "woo_orders_summary", "woo_get_product", "woo_get_product_structure", "woo_low_stock", "woo_catalog_summary"]) {
  if (!wooTools.includes(`\"${tool}\"`)) fail(`WooCommerce connector is missing reviewed read tool: ${tool}`);
}

const publisherPackage = jsonYaml("connectors/content-publisher/package.json");
if (publisherPackage.name !== "@enki-hogar/content-publisher-mcp" || publisherPackage.version !== "0.1.0") fail("Unexpected content publisher connector package identity");
if (publisherPackage.dependencies?.["@modelcontextprotocol/sdk"] !== "1.30.0" || publisherPackage.dependencies?.zod !== "4.4.3") fail("Content publisher connector dependencies must be exactly pinned");
const publisherPackageLock = jsonYaml("connectors/content-publisher/package-lock.json");
if (publisherPackageLock.packages?.["node_modules/@modelcontextprotocol/sdk"]?.version !== "1.30.0" || publisherPackageLock.packages?.["node_modules/zod"]?.version !== "4.4.3") fail("Content publisher connector lock must preserve reviewed dependency versions");
const expectedPublisherTools = [
  "publisher_get_capabilities",
  "wordpress_list_posts",
  "wordpress_get_article",
  "wordpress_upsert_post",
  "facebook_list_page_posts",
  "facebook_publish_page_post",
  "instagram_list_media",
  "instagram_get_publishing_limit",
  "instagram_publish_image",
];
const expectedPublisherWriteTools = [
  "wordpress_upsert_post",
  "facebook_publish_page_post",
  "instagram_publish_image",
];
const publisherTools = readFileSync(join(packageDir, "connectors", "content-publisher", "src", "tools.mjs"), "utf8");
for (const tool of expectedPublisherTools) if (!publisherTools.includes(`\"${tool}\"`)) fail(`Content publisher connector is missing reviewed tool: ${tool}`);
for (const forbidden of ["delete", "comment", "direct_message", "refund", "upload_media", "publish_reel", "publish_story", "publish_carousel"]) if (publisherTools.includes(`\"${forbidden}`)) fail(`Content publisher MCP must not expose unsupported operation: ${forbidden}`);
if (!/readOnlyHint:\s*readOnly/.test(publisherTools) || !/idempotentHint:\s*idempotent/.test(publisherTools) || !/destructiveHint:\s*false/.test(publisherTools)) fail("Content publisher tools must declare reviewed MCP risk annotations");
if (!/assertWriteAllowed\(config,\s*"wordpress"/.test(publisherTools) || !/assertWriteAllowed\(config,\s*"facebook"/.test(publisherTools) || !/assertWriteAllowed\(config,\s*"instagram"/.test(publisherTools)) fail("Every content publisher write path must enforce the connector kill switch");
if ((publisherTools.match(/idempotency_key:/g) || []).length !== expectedPublisherWriteTools.length) fail("Every content publisher write tool must require exactly one idempotency key");

const catalogPackage = jsonYaml("connectors/catalog-knowledge/package.json");
if (catalogPackage.name !== "@enki-hogar/product-support-knowledge-mcp" || catalogPackage.version !== "0.2.0") fail("Unexpected product-support connector package identity");
if (catalogPackage.dependencies?.["@modelcontextprotocol/sdk"] !== "1.30.0" || catalogPackage.dependencies?.postgres !== "3.4.9" || catalogPackage.dependencies?.zod !== "4.4.3") fail("Product-support connector dependencies must be exactly pinned");
const catalogPackageLock = jsonYaml("connectors/catalog-knowledge/package-lock.json");
if (catalogPackageLock.packages?.["node_modules/postgres"]?.version !== "3.4.9") fail("Catalogue connector lock must pin postgres 3.4.9");
const catalogTools = readFileSync(join(packageDir, "connectors", "catalog-knowledge", "src", "tools.mjs"), "utf8");
const expectedCatalogTools = [
  "knowledge_resolve_product",
  "knowledge_get_technical_profile",
  "knowledge_check_compatibility",
  "knowledge_list_allowed_options",
  "knowledge_get_configuration_model",
  "knowledge_search_support",
  "knowledge_get_evidence",
  "knowledge_coverage",
];
for (const tool of expectedCatalogTools) if (!catalogTools.includes(`\"${tool}\"`)) fail(`Product-support connector is missing read tool: ${tool}`);
if (!/readOnlyHint:\s*true/.test(catalogTools) || !/destructiveHint:\s*false/.test(catalogTools) || !/openWorldHint:\s*false/.test(catalogTools)) fail("Product-support tools must be closed-world, read-only and non-destructive");
for (const forbidden of ["knowledge_create", "knowledge_update", "knowledge_delete", "knowledge_archive", "knowledge_restore", "knowledge_purge", "knowledge_import", "knowledge_reindex"]) if (catalogTools.includes(`\"${forbidden}`)) fail(`Product-support MCP must not expose administrative tool: ${forbidden}`);
const catalogCompose = readFileSync(join(packageDir, "runtime", "docker-compose.integrations.yml"), "utf8");
if (!catalogCompose.includes("pgvector/pgvector:0.8.6-pg17-bookworm@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f")) fail("Compose must consume the verified pgvector image digest");
const catalogMcpComposeBlock = catalogCompose.match(/\n  enki-product-support-knowledge:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|\nvolumes:)/)?.[1] || "";
if (!catalogMcpComposeBlock || /SUPPORT_DB_ADMIN_PASSWORD/.test(catalogMcpComposeBlock)) fail("Product-support MCP service must never receive the database admin password");
if (!/SUPPORT_DB_USER:\s*enki_support_reader/.test(catalogMcpComposeBlock)) fail("Product-support MCP must connect with the dedicated reader role");
const catalogMigration = readFileSync(join(packageDir, "connectors", "catalog-knowledge", "src", "migrations.mjs"), "utf8");
if (!/default_transaction_read_only = on/.test(catalogMigration)) fail("Support migration must enforce read-only transactions on the MCP database role");
if (/GRANT SELECT ON ALL TABLES/.test(catalogMigration)) fail("Support reader must not receive administrative tables through a blanket grant");
const catalogSchema = readFileSync(join(packageDir, "connectors", "catalog-knowledge", "migrations", "001_product_support_knowledge.sql"), "utf8");
if (!catalogSchema.includes("source_revision_kind")) fail("Product-support packs must preserve whether source provenance is a Git commit or source snapshot digest");
for (const indexName of [
  "support_packs_one_active_domain_idx",
  "support_entities_lookup_idx",
  "support_relations_from_idx",
  "support_rules_entity_idx",
  "support_crosswalk_variation_sku_idx",
  "support_chunks_search_idx",
]) if (!catalogSchema.includes(indexName)) fail(`Product-support index missing: ${indexName}`);

const telegramPackage = jsonYaml("connectors/telegram-gateway/package.json");
if (telegramPackage.name !== "@enki-hogar/telegram-gateway" || telegramPackage.version !== "0.2.0") fail("Unexpected Telegram plugin package identity");
const telegramManifest = readFileSync(join(packageDir, "connectors", "telegram-gateway", "src", "manifest.ts"), "utf8");
for (const capability of [
  "issues.read",
  "issues.create",
  "issues.wakeup",
  "issue.comments.read",
  "issue.comments.create",
  "issue.comments.create_human_attributed",
  "agents.read",
  "access.members.read",
  "events.subscribe",
  "plugin.state.read",
  "plugin.state.write",
  "secrets.read-ref",
  "http.outbound",
]) if (!telegramManifest.includes(`\"${capability}\"`)) fail(`Telegram manifest is missing capability: ${capability}`);
for (const forbiddenCapability of [
  "approvals.respond",
  "issue.interactions.respond",
  "agents.invoke",
  "agents.resume",
  "issues.update",
]) if (telegramManifest.includes(`\"${forbiddenCapability}\"`)) fail(`Telegram manifest must not declare capability: ${forbiddenCapability}`);
if (!/botToken:\s*\{[\s\S]{0,480}?type:\s*"object"[\s\S]{0,240}?format:\s*"secret-ref"/.test(telegramManifest)) fail("Telegram bot token must use an object-shaped Paperclip secret-ref config field");
const telegramWorker = readFileSync(join(packageDir, "connectors", "telegram-gateway", "src", "worker.ts"), "utf8");
if (!/multiCompanyConfig:\s*true/.test(telegramWorker)) fail("Telegram gateway must keep company-scoped multi-company configuration");
if (!/events\.on\(eventType,\s*\{ companyId \}/.test(telegramWorker)) fail("Telegram event subscriptions must be filtered by configured company");
const telegramCompose = readFileSync(join(packageDir, "runtime", "docker-compose.integrations.yml"), "utf8");
if (!/\/plugins\/enki-telegram-gateway:ro/.test(telegramCompose)) fail("Compose must mount the Telegram plugin read-only");

const desired = jsonYaml("policies/desired-state.yaml");
if (desired.schema !== "enki-runtime-desired-state/v1" || desired.mode !== "governed-publishing") fail("Desired state must be governed-publishing enki-runtime-desired-state/v1");
if (desired.packageVersion !== "0.12.0") fail("Desired state package version must match 0.12.0");
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
if (desired.plugins?.length !== 1 || desired.plugins[0]?.pluginId !== "enki-hogar.telegram-gateway" || desired.plugins[0]?.version !== "0.2.0") fail("Desired state must pin the Enki Telegram gateway plugin");
if (desired.plugins?.[0]?.approvalDecisions !== "ui_only" || desired.plugins?.[0]?.requireActiveHumanAttribution !== true) fail("Telegram desired state must keep approval decisions in the UI and require human attribution");
for (const forbiddenCapability of ["approvals.respond", "issue.interactions.respond", "agents.invoke", "agents.resume", "issues.update"]) {
  if (!(desired.plugins?.[0]?.forbiddenCapabilities || []).includes(forbiddenCapability)) fail(`Telegram desired state must forbid capability: ${forbiddenCapability}`);
}
if (desired.connections?.length !== 6 || desired.profiles?.length !== 6 || desired.policies?.length !== 2 || desired.gateways?.length !== 6) fail("Desired state must define 6 connections, 6 profiles, 2 publishing policies, and 6 governed gateways");
const desiredCatalogConnection = desired.connections?.find((connection) => connection.key === "product_support_knowledge");
if (desiredCatalogConnection?.endpoint !== "http://enki-product-support-knowledge:8030/mcp" || (desiredCatalogConnection?.tools || []).sort().join(",") !== [...expectedCatalogTools].sort().join(",")) fail("Desired support connection must expose the exact reviewed eight-tool catalog");
const desiredPublisherConnection = desired.connections?.find((connection) => connection.key === "content_publisher");
if (desiredPublisherConnection?.endpoint !== "http://enki-content-publisher:8040/mcp" || [...(desiredPublisherConnection?.tools || [])].sort().join(",") !== [...expectedPublisherTools].sort().join(",")) fail("Desired content publisher connection must expose the exact reviewed nine-tool catalog");
if ([...(desiredPublisherConnection?.writeTools || [])].sort().join(",") !== [...expectedPublisherWriteTools].sort().join(",")) fail("Desired content publisher connection must identify exactly the three governed write tools");
if (desiredPublisherConnection?.quarantineNewEntries !== true) fail("Desired content publisher connection must quarantine newly discovered or changed tools");
const desiredToolNames = new Set((desired.connections || []).flatMap((connection) => connection.tools || []));
const analyticsProxy = jsonYaml("connectors/google-mcps/config/analytics-proxy.json");
if (analyticsProxy.mcpServers?.default?.tools?.list_google_ads_links?.enabled !== false) fail("GA4 proxy must quarantine list_google_ads_links because its upstream response exposes creator email PII");
if (desiredToolNames.has("list_google_ads_links")) fail("Desired connection catalogs must exclude the PII-bearing list_google_ads_links tool");
const desiredProfileAgents = new Set();
for (const profile of desired.profiles || []) {
  if (profile.defaultAction !== "deny" || profile.strictAllowedTools !== true) fail(`Profile ${profile.profileKey || "unknown"} must be strict default-deny`);
  if (!agents.has(profile.agentSlug)) fail(`Desired profile references unknown agent: ${profile.agentSlug || "unknown"}`);
  if (desiredProfileAgents.has(profile.agentSlug)) fail(`Desired state has multiple profiles for agent: ${profile.agentSlug}`);
  desiredProfileAgents.add(profile.agentSlug);
  if ((profile.allowedTools || []).includes("list_google_ads_links")) fail(`Profile ${profile.profileKey || "unknown"} must not expose list_google_ads_links`);
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
const approvalPolicy = desired.policies?.find((policy) => policy.name === "Enki require Board approval for publishing") || {};
if (approvalPolicy.policyType !== "require_approval" || approvalPolicy.priority !== 100 || approvalPolicy.enabled !== true || [...(approvalPolicy.requiredToolNames || [])].sort().join(",") !== [...expectedPublisherWriteTools].sort().join(",")) fail("Desired state must require Board approval for the exact three publication tools before the global block");
const blockPolicy = desired.policies?.find((policy) => policy.name === "Enki block write and destructive tools") || {};
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
if ((inventory.internalDocuments || []).length !== 18) fail("Knowledge inventory must include metric, evidence, content-ledger, editorial planning/feedback/retrospective/learning, catalogue processing/reconciliation contracts and replay receipt, catalogue regression and adapter contracts, legacy workflow, and both product-support contracts");
const historicalReplayReceipt = jsonYaml("references/replay-receipts/eai-021-buades-2026-04-26.json");
if (
  historicalReplayReceipt.schema !== "enki-bounded-historical-layout-replay-receipt/v1" ||
  historicalReplayReceipt.sourceSnapshot?.sha256 !== "9ca8155e25cf0b658cd3a2868e64639602af62f71aef63b48b19d0aa13dc4a59" ||
  historicalReplayReceipt.sourceSnapshot?.rows !== 1196 ||
  historicalReplayReceipt.sourceSnapshot?.columns !== 376 ||
  historicalReplayReceipt.sourceSnapshot?.widthAnomalies !== 0 ||
  historicalReplayReceipt.sourceSnapshot?.duplicateIds !== 0 ||
  historicalReplayReceipt.sourceSnapshot?.duplicateSkus !== 0 ||
  historicalReplayReceipt.sourceSnapshot?.rowKinds?.unknown !== 0 ||
  historicalReplayReceipt.sourceSnapshot?.orphanVariations !== 0 ||
  historicalReplayReceipt.sanitizedReplay?.candidateFields !== 4 ||
  historicalReplayReceipt.sanitizedReplay?.matches !== 2 ||
  historicalReplayReceipt.sanitizedReplay?.changes !== 2 ||
  historicalReplayReceipt.authority?.sourceValuesRetained !== false ||
  historicalReplayReceipt.authority?.artifactsPersisted !== false ||
  historicalReplayReceipt.authority?.isCurrentCommercialTruth !== false ||
  historicalReplayReceipt.authority?.isExternalMutationAuthority !== false ||
  historicalReplayReceipt.authority?.canGenerateWooImport !== false
) fail("Bounded historical Woo layout replay receipt drift");
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
