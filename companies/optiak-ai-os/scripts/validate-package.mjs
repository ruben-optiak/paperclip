#!/usr/bin/env node

import {lstatSync, readFileSync, readdirSync, statSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const symlinks = [];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message) {
  errors.push(message);
}

function statSafe(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function filesBelow(root) {
  const found = [];
  for (const entry of readdirSync(root)) {
    if (["node_modules", "dist", ".paperclip-sdk", ".runtime-secrets", "source-snapshots"].includes(entry)) continue;
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) symlinks.push(path);
    else if (stats.isDirectory()) found.push(...filesBelow(path));
    else found.push(path);
  }
  return found;
}

function scalar(raw) {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function frontmatter(path) {
  const text = readFileSync(path, "utf8");
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return {};
  const result = {};
  let arrayKey = null;
  for (const line of text.slice(4, end).split("\n")) {
    const item = line.match(/^  - (.+)$/);
    if (item && arrayKey) {
      result[arrayKey].push(scalar(item[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
    if (!pair) {
      arrayKey = null;
      continue;
    }
    if (!pair[2]) {
      result[pair[1]] = [];
      arrayKey = pair[1];
    } else {
      result[pair[1]] = scalar(pair[2]);
      arrayKey = null;
    }
  }
  return result;
}

function directKeys(yaml, start, end) {
  const startIndex = yaml.indexOf(`${start}:\n`);
  if (startIndex < 0) return [];
  const from = startIndex + start.length + 2;
  const endIndex = end ? yaml.indexOf(`\n${end}:\n`, from) : -1;
  const section = yaml.slice(from, endIndex < 0 ? undefined : endIndex);
  return [...section.matchAll(/^  ([a-z0-9]+(?:-[a-z0-9]+)*):\n/gm)].map((match) => match[1]);
}

const requiredFiles = [
  "COMPANY.md",
  "README.md",
  "LICENSE",
  ".paperclip.yaml",
  "policies/access-matrix.md",
  "policies/desired-state.yaml",
  "policies/execution-budget.yaml",
  "policies/secrets-matrix.md",
  "policies/tool-allowlist.yaml",
  "references/product-boundary.md",
  "references/source-map.yaml",
  "references/quality-model.md",
  "references/run-efficiency-baseline.json",
  "runbooks/observability-and-oncall.md",
  "runbooks/local-setup.md",
  "runbooks/test-environment.md",
  "runbooks/connections.md",
  "runbooks/execution-budgets.md",
  "runbooks/sandbox-migration.md",
  "runbooks/security.md",
  "runbooks/smoke-test.md",
  "runtime/compatibility.lock.json",
  "runtime/docker-compose.paperclip.yml",
  "scripts/scan-secrets.sh",
  "scripts/build-import-zip.sh",
  "scripts/check-sandbox-compat.mjs",
  "scripts/evaluate-promotion-readiness.mjs",
  "scripts/evaluate-prd-readiness.mjs",
  "scripts/evaluate-postmortem.mjs",
  "scripts/import-allowlist.txt",
  "scripts/local-instance.sh",
  "scripts/probe-test-environment.mjs",
  "scripts/summarize-run-usage.mjs",
  "scripts/validate-result-envelopes.mjs",
  "skills/optiak-durable-completion/references/contracts/result-envelope-v1.schema.json",
  "skills/optiak-durable-completion/references/result-taxonomy.md",
  "skills/optiak-product-triage/references/product-authority.yaml",
  "skills/optiak-pr-review/references/repository-authority.yaml",
  "skills/optiak-e2e-validation/references/test-environment-contract.json",
  "skills/optiak-e2e-validation/references/golden-journey-matrix.json",
  "skills/optiak-incident-triage/references/observability-source-contract.json",
  "skills/optiak-release-readiness/references/ai-os-promotion-contract.json",
  "skills/optiak-architecture-review/references/architecture-authority-map.json",
  "skills/optiak-docs-drift/references/documentation-authority-map.json",
  "skills/optiak-prd-review/references/prd-readiness-contract.json",
  "skills/optiak-incident-triage/references/postmortem-contract.json",
];
for (const path of requiredFiles) if (!statSafe(join(packageDir, path))) fail(`Missing required file: ${path}`);

const allFiles = filesBelow(packageDir);
if (symlinks.length > 0) fail(`Symlinks are not portable: ${symlinks.map((path) => relative(packageDir, path)).join(", ")}`);
for (const path of allFiles.filter((candidate) => candidate.endsWith(".json"))) {
  try {
    JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${relative(packageDir, path)}: ${error.message}`);
  }
}

const company = frontmatter(join(packageDir, "COMPANY.md"));
if (company.schema !== "agentcompanies/v1") fail("COMPANY.md must declare agentcompanies/v1");
if (company.slug !== "optiak-ai-os") fail("Unexpected company slug");
if (company.version !== "0.1.11") fail("Unexpected company version");
if (company.license !== "LicenseRef-Optiak-Internal") fail("Unexpected company license");

const agentFiles = allFiles.filter((path) => path.endsWith(`${sep}AGENTS.md`) && path.includes(`${sep}agents${sep}`));
const agents = new Map();
for (const path of agentFiles) {
  const doc = frontmatter(path);
  const folder = relative(join(packageDir, "agents"), dirname(path)).split(sep)[0];
  if (!slugPattern.test(doc.slug || "")) fail(`Invalid agent slug in ${relative(packageDir, path)}`);
  if (doc.slug !== folder) fail(`Agent folder/slug mismatch: ${folder}`);
  if (agents.has(doc.slug)) fail(`Duplicate agent slug: ${doc.slug}`);
  agents.set(doc.slug, doc);
}
if (agents.size !== 10) fail(`Expected 10 agents, found ${agents.size}`);
const roots = [...agents.values()].filter((agent) => agent.reportsTo === null);
if (roots.length !== 1 || roots[0]?.slug !== "director-optiak") fail("Organization must have one director-optiak root");
for (const agent of agents.values()) {
  if (agent.reportsTo && !agents.has(agent.reportsTo)) fail(`Unknown manager ${agent.reportsTo} for ${agent.slug}`);
  const visited = new Set([agent.slug]);
  let current = agent;
  while (current?.reportsTo) {
    if (visited.has(current.reportsTo)) {
      fail(`Reporting cycle at ${agent.slug}`);
      break;
    }
    visited.add(current.reportsTo);
    current = agents.get(current.reportsTo);
  }
  for (const skill of agent.skills || []) {
    if (!statSafe(join(packageDir, "skills", skill, "SKILL.md"))) fail(`Unknown skill ${skill} for ${agent.slug}`);
  }
  if (!(agent.skills || []).includes("optiak-durable-completion")) {
    fail(`Agent ${agent.slug} is missing optiak-durable-completion`);
  }
}

const skillFiles = allFiles.filter((path) => path.endsWith(`${sep}SKILL.md`) && path.includes(`${sep}skills${sep}`));
if (skillFiles.length !== 13) fail(`Expected 13 skills, found ${skillFiles.length}`);
for (const path of skillFiles) {
  const doc = frontmatter(path);
  const skillDir = dirname(path);
  const folder = relative(join(packageDir, "skills"), skillDir).split(sep)[0];
  if (doc.name !== folder || !slugPattern.test(doc.name || "")) fail(`Skill name/folder mismatch: ${folder}`);
  if (!statSafe(join(skillDir, "examples", readdirSync(join(skillDir, "examples"))[0] || ""))) fail(`Skill has no example: ${folder}`);
  const text = readFileSync(path, "utf8");
  const fixtureDir = join(skillDir, "references", "fixtures");
  let fixtureFiles = [];
  try {
    fixtureFiles = readdirSync(fixtureDir).filter((fixture) => fixture.endsWith(".md"));
  } catch {
    fail(`Skill has no portable references/fixtures directory: ${folder}`);
  }
  if (fixtureFiles.length === 0) fail(`Skill has no portable Markdown fixture: ${folder}`);
  for (const fixture of fixtureFiles) {
    const fixtureText = readFileSync(join(fixtureDir, fixture), "utf8");
    const fencedJson = fixtureText.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    if (!fencedJson) {
      fail(`Skill fixture has no fenced JSON object: ${folder}/${fixture}`);
      continue;
    }
    try {
      JSON.parse(fencedJson[1]);
    } catch (error) {
      fail(`Invalid fenced JSON in ${folder}/${fixture}: ${error.message}`);
    }
    if (!text.includes(`references/fixtures/${fixture}`)) fail(`Skill does not reference fixture: ${folder}/${fixture}`);
  }
  if (/(?:^|[\s('"`])\.\.\//m.test(text)) fail(`Skill escapes its portable subtree: ${folder}`);
}

const projectFiles = allFiles.filter((path) => path.endsWith(`${sep}PROJECT.md`));
const projects = new Map(projectFiles.map((path) => {
  const doc = frontmatter(path);
  return [doc.slug, doc];
}));
if (projects.size !== 6) fail(`Expected 6 projects, found ${projects.size}`);
for (const [slug, project] of projects) {
  if (!slugPattern.test(slug || "")) fail(`Invalid project slug: ${slug}`);
  if (!agents.has(project.owner)) fail(`Unknown project owner ${project.owner} for ${slug}`);
}

const taskFiles = allFiles.filter((path) => path.endsWith(`${sep}TASK.md`));
const tasks = new Map();
for (const path of taskFiles) {
  const doc = frontmatter(path);
  if (!slugPattern.test(doc.slug || "")) fail(`Invalid task slug in ${relative(packageDir, path)}`);
  if (tasks.has(doc.slug)) fail(`Duplicate task slug: ${doc.slug}`);
  if (!agents.has(doc.assignee)) fail(`Unknown task assignee ${doc.assignee} for ${doc.slug}`);
  if (!projects.has(doc.project)) fail(`Unknown task project ${doc.project} for ${doc.slug}`);
  tasks.set(doc.slug, doc);
}
if (tasks.size !== 21) fail(`Expected 21 tasks, found ${tasks.size}`);
const recurringTasks = new Set([...tasks.values()].filter((task) => task.recurring === true).map((task) => task.slug));
const expectedRecurring = new Set([
  "public-docs-drift-review",
  "staging-golden-journey-smoke",
  "weekly-architecture-health-review",
  "weekly-engineering-assurance-review",
]);
if ([...expectedRecurring].some((slug) => !recurringTasks.has(slug)) || recurringTasks.size !== expectedRecurring.size) fail("Recurring task set drift");

const paperclip = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
const configuredAgents = directKeys(paperclip, "agents", "tasks");
if (configuredAgents.length !== 10 || configuredAgents.some((slug) => !agents.has(slug))) fail(".paperclip.yaml agent set drift");
const configuredTasks = directKeys(paperclip, "tasks", "routines");
const configuredRoutines = directKeys(paperclip, "routines", null);
for (const configured of [configuredTasks, configuredRoutines]) {
  if (configured.length !== 4 || configured.some((slug) => !expectedRecurring.has(slug))) fail(".paperclip.yaml recurring set drift");
}
if ((paperclip.match(/type: codex_local/g) || []).length !== 10) fail("Every agent must use codex_local in v0.1");
if ((paperclip.match(/dangerouslyBypassApprovalsAndSandbox: false/g) || []).length !== 10) fail("Every agent must keep sandbox bypass disabled");
if ((paperclip.match(/managedMcpOnly: true/g) || []).length !== 10) fail("Every agent must use managed MCP only");
if ((paperclip.match(/enabled: false/g) || []).length !== 14) fail("All agent heartbeats and four routine triggers must be disabled");
const agentBudgets = [...paperclip.matchAll(/^    budgetMonthlyCents: (\d+)$/gm)].map((match) => Number(match[1]));
if (agentBudgets.length !== 10 || agentBudgets.reduce((total, value) => total + value, 0) !== 10000) {
  fail("Agent monthly budgets must contain ten values totaling 10000 cents");
}
if ((paperclip.match(/timeoutSec: 300/g) || []).length !== 10) fail("Every agent must use the fixture-phase 300 second timeout");
if ((paperclip.match(/maxDailyRuns: /g) || []).length !== 10) fail("Every agent must have a daily run cap");
if ((paperclip.match(/maxDailyCostCents: /g) || []).length !== 10) fail("Every agent must have a daily cost cap");

const compatibility = JSON.parse(readFileSync(join(packageDir, "runtime", "compatibility.lock.json"), "utf8"));
if (compatibility.schema !== "optiak-runtime-compatibility/v1") fail("Unexpected runtime compatibility schema");
if (compatibility.packageVersion !== company.version) fail("Runtime compatibility package version drift");
if (compatibility.codex?.targetBackendStatus !== "blocked") fail("Modern sandbox must remain blocked until live migration evidence exists");
const expectedLegacyFlags = compatibility.codex?.expectedLegacyFlagOccurrences;
if ((paperclip.match(/features\.use_legacy_landlock=true/g) || []).length !== expectedLegacyFlags) {
  fail("Legacy sandbox flag count does not match the compatibility lock");
}
const compose = readFileSync(join(packageDir, "runtime", "docker-compose.paperclip.yml"), "utf8");
for (const pattern of [/privileged:\s*true/i, /SYS_ADMIN/i, /seccomp\s*[:=]\s*unconfined/i, /apparmor\s*[:=]\s*unconfined/i]) {
  if (pattern.test(compose)) fail("Control-plane Compose must not weaken Docker isolation for Bubblewrap");
}

const executionBudget = readFileSync(join(packageDir, "policies", "execution-budget.yaml"), "utf8");
for (const marker of [
  "monthlyBilledCents: 15000",
  "currency: USD",
  "warnPercent: 80",
  "hardStopPercent: 100",
  "timeoutSeconds: 300",
  "basis: uncached_input_tokens",
  "nativeEnforcement: false",
  "rawInputTokensAre: cumulative_usage_not_prompt_size",
]) {
  if (!executionBudget.includes(marker)) fail(`Execution-budget marker missing: ${marker}`);
}

const runBaseline = JSON.parse(readFileSync(join(packageDir, "references", "run-efficiency-baseline.json"), "utf8"));
if (runBaseline.summary?.runCount !== 17) fail("Unexpected run-efficiency baseline count");
const baselineTotals = runBaseline.summary?.totals ?? {};
if (baselineTotals.rawInputTokens - baselineTotals.cachedInputTokens !== baselineTotals.uncachedInputTokens) {
  fail("Run-efficiency baseline token arithmetic drift");
}
const directorBaseline = runBaseline.directorSynthesis ?? {};
if (directorBaseline.rawInputTokens - directorBaseline.cachedInputTokens !== directorBaseline.uncachedInputTokens) {
  fail("Director synthesis token arithmetic drift");
}
if (runBaseline.summary?.billingModes?.[0]?.costStatus !== "unpriced") {
  fail("Baseline must preserve unpriced subscription cost semantics");
}

const resultContract = readFileSync(
  join(packageDir, "skills", "optiak-durable-completion", "references", "result-taxonomy.md"),
  "utf8",
);
for (const marker of [
  "paperclip.issueDisposition",
  "report.canonical",
  "object.verdict",
  "operations.readiness",
  "evidence.scope",
  "At most one report is canonical",
  "Do not delete history",
]) {
  if (!resultContract.includes(marker)) fail(`Result-taxonomy marker missing: ${marker}`);
}

const desired = readFileSync(join(packageDir, "policies", "desired-state.yaml"), "utf8");
for (const marker of [
  "expected: 10",
  "expected: 4",
  "importedPaused: true",
  "companyMonthlyBilledCents: 15000",
  "warnPercent: 80",
  "hardStopPercent: 100",
  "inference: deliberately_deferred_until_deployed_environment",
  "state: offline_contract_defined_connection_disconnected",
  "automaticOncallCoverage: false",
  "state: offline_contract_defined_not_deployed",
  "infrastructureProvider: undecided",
  "directLocalToProduction: deny",
  "sameImmutableCandidateAcrossEnvironments: true",
  "evaluatorMayExecute: false",
  "state: offline_defined_sources_not_assumed_connected",
  "state: offline_defined_live_pages_remain_canonical",
  "readyVerdictAuthorizesImplementation: false",
  "evaluatorMayExecuteCorrectiveAction: false",
  "productionMutation: deny",
  "migrationStatus: blocked",
  "controlPlanePrivilegeExpansion: deny",
]) {
  if (!desired.includes(marker)) fail(`Desired-state marker missing: ${marker}`);
}
const allowlist = readFileSync(join(packageDir, "policies", "tool-allowlist.yaml"), "utf8");
for (const marker of ["defaultDecision: quarantine", "productionMutation: deny", "merge: deny", "deploy: deny", "secretAdministration: deny", "follow_versioned_observability_source_contract", "capability: raw_events_read", "capability: application_logs_read", "capability: sentry_session_replay_read", "decision: pending_connection_and_tabletop", "capability: promotion_evidence_read", "capability: promotion_readiness_evaluate", "output_is_advice_not_authority", "capability: promotion_deploy_import_restore_or_activate"]) {
  if (!allowlist.includes(marker)) fail(`Tool policy marker missing: ${marker}`);
}
const sourceMap = readFileSync(join(packageDir, "references", "source-map.yaml"), "utf8");
if (!sourceMap.includes("wholeSiteSnapshotsAllowed: false")) fail("Source map must deny whole-site snapshots");
if (!sourceMap.includes("promotionAuthorityRef: skills/optiak-release-readiness/references/ai-os-promotion-contract.json")) {
  fail("Promotion source-map authority reference missing");
}
for (const marker of [
  "architectureAuthorityRef: skills/optiak-architecture-review/references/architecture-authority-map.json",
  "documentationAuthorityRef: skills/optiak-docs-drift/references/documentation-authority-map.json",
]) {
  if (!sourceMap.includes(marker)) fail(`Source-map authority reference missing: ${marker}`);
}
if ((sourceMap.match(/status: disconnected/g) || []).length !== 4) fail("Future source disconnection state drift");
for (const marker of ["status: authorized_pending_connection", "provider: Linear", "team: OPT", "https://mcp.linear.app/mcp/readonly"]) {
  if (!sourceMap.includes(marker)) fail(`Product source-map marker missing: ${marker}`);
}
for (const marker of [
  "repositoryAuthorityRef: skills/optiak-pr-review/references/repository-authority.yaml",
  "provider: GitHub",
  "optiak/optiak",
  "optiak/optiak-frontend",
  "https://api.githubcopilot.com/mcp/readonly",
]) {
  if (!sourceMap.includes(marker)) fail(`Repository source-map marker missing: ${marker}`);
}
for (const marker of [
  "observabilityAuthorityRef: skills/optiak-incident-triage/references/observability-source-contract.json",
  "authority: runtime_health_only_after_source_specific_smoke",
  "raw_events_logs_and_session_replay_denied",
  "no_automatic_oncall_until_signed_alert_tabletop",
]) {
  if (!sourceMap.includes(marker)) fail(`Observability source-map marker missing: ${marker}`);
}
const productAuthority = readFileSync(
  join(packageDir, "skills", "optiak-product-triage", "references", "product-authority.yaml"),
  "utf8",
);
for (const marker of [
  "schema: optiak-product-authority/v1",
  "humanConflictOwner: board",
  "url: https://linear.app/optiak/team/OPT/",
  "endpoint: https://mcp.linear.app/mcp/readonly",
  "writeToolsAllowed: false",
  "copyWholeBacklog: false",
  "maximumAgeMinutesForCurrentClaim: 15",
  "winner: release_and_deployment_evidence",
]) {
  if (!productAuthority.includes(marker)) fail(`Product-authority marker missing: ${marker}`);
}
const repositoryAuthority = readFileSync(
  join(packageDir, "skills", "optiak-pr-review", "references", "repository-authority.yaml"),
  "utf8",
);
for (const marker of [
  "schema: optiak-repository-authority/v1",
  "humanConflictOwner: board",
  "endpoint: https://api.githubcopilot.com/mcp/readonly",
  "authentication: fine_grained_personal_access_token",
  "maximumCredentialLifetimeDays: 30",
  "- independent-code-reviewer",
  "- slug: optiak/optiak",
  "- slug: optiak/optiak-frontend",
  "- optiak/optiak-tests",
  "defaultDecision: deny",
  "writeToolsAllowed: false",
  "recheckHeadBeforeVerdict: true",
  "cloneWholeOrganization: false",
]) {
  if (!repositoryAuthority.includes(marker)) fail(`Repository-authority marker missing: ${marker}`);
}
if ((repositoryAuthority.match(/^    - slug: optiak\//gm) || []).length !== 2) {
  fail("Repository authority must contain exactly two approved Optiak repositories");
}

const architectureAuthority = JSON.parse(readFileSync(
  join(
    packageDir,
    "skills",
    "optiak-architecture-review",
    "references",
    "architecture-authority-map.json",
  ),
  "utf8",
));
if (architectureAuthority.schema !== "optiak-architecture-authority-map/v1") {
  fail("Unexpected architecture authority-map schema");
}
if (architectureAuthority.status !== "offline_defined_sources_not_assumed_connected"
  || architectureAuthority.humanConflictOwner !== "board"
  || architectureAuthority.globalPolicy?.defaultDecision !== "blocked_on_authority") {
  fail("Architecture authority map must remain offline and fail closed");
}
for (const policy of [
  "publicDocsProveImplementation",
  "sourceCodeProvesDeployment",
  "healthEndpointProvesReadiness",
  "fixtureProvesLiveBehavior",
  "architectureReviewerMayCreateProductIntent",
  "architectureReviewerMayApproveOwnImplementation",
]) {
  if (architectureAuthority.globalPolicy?.[policy] !== false) {
    fail(`Architecture authority prohibition drift: ${policy}`);
  }
}
const architectureSourceClasses = new Map(
  (architectureAuthority.sourceClasses ?? []).map((source) => [source.id, source]),
);
const architectureDomains = new Map(
  (architectureAuthority.domains ?? []).map((domain) => [domain.id, domain]),
);
if (architectureSourceClasses.size !== 8) fail("Expected eight architecture source classes");
if (architectureDomains.size !== 8) fail("Expected eight architecture authority domains");
for (const sourceId of [
  "explicit_board_decision",
  "approved_product_contract",
  "versioned_api_or_data_contract",
  "exact_source_revision",
  "approved_adr_or_rfc_revision",
  "release_and_deployment_evidence",
  "fresh_runtime_evidence",
  "public_documentation",
]) {
  if (!architectureSourceClasses.has(sourceId)) fail(`Missing architecture source class: ${sourceId}`);
}
for (const domain of architectureDomains.values()) {
  if (!agents.has(domain.owner) || !agents.has(domain.reviewer)) {
    fail(`Unknown architecture domain owner or reviewer: ${domain.id}`);
  }
  if (!domain.freshness || !domain.unavailableBehavior) {
    fail(`Incomplete architecture authority domain: ${domain.id}`);
  }
  for (const sourceId of domain.strongestSources ?? []) {
    if (!architectureSourceClasses.has(sourceId)) {
      fail(`Unknown architecture source ${sourceId} in ${domain.id}`);
    }
  }
}

const documentationAuthority = JSON.parse(readFileSync(
  join(
    packageDir,
    "skills",
    "optiak-docs-drift",
    "references",
    "documentation-authority-map.json",
  ),
  "utf8",
));
if (documentationAuthority.schema !== "optiak-documentation-authority-map/v1") {
  fail("Unexpected documentation authority-map schema");
}
if (documentationAuthority.status !== "offline_defined_live_pages_remain_canonical"
  || documentationAuthority.humanConflictOwner !== "board"
  || documentationAuthority.globalPolicy?.wholeSiteSnapshotsAllowed !== false
  || documentationAuthority.globalPolicy?.documentationAgentMayPublish !== false
  || documentationAuthority.globalPolicy?.publicPageProvesImplementation !== false
  || documentationAuthority.globalPolicy?.publicPageProvesReleaseAvailability !== false) {
  fail("Documentation authority map safety policy drift");
}
const documentationDomains = documentationAuthority.domains ?? [];
if (documentationDomains.length !== 8) fail("Expected eight documentation authority domains");
const mappedDocumentationSources = documentationDomains.flatMap((domain) => domain.sourceIds ?? []);
if (mappedDocumentationSources.length !== 14
  || new Set(mappedDocumentationSources).size !== mappedDocumentationSources.length) {
  fail("Documentation authority map must cover fourteen unique approved source ids");
}
const sourceMapIds = new Set([...sourceMap.matchAll(/^  - id: ([a-z0-9-]+)$/gm)].map((match) => match[1]));
for (const sourceId of mappedDocumentationSources) {
  if (!sourceMapIds.has(sourceId)) fail(`Unknown documentation source id: ${sourceId}`);
}
for (const domain of documentationDomains) {
  for (const ownerField of ["productOwner", "implementationOwner", "documentationOwner"]) {
    if (!agents.has(domain[ownerField])) {
      fail(`Unknown documentation ${ownerField} for ${domain.id}`);
    }
  }
  if (!domain.reviewCadence || !domain.escalation || !(domain.comparisonAuthorities?.length > 0)) {
    fail(`Incomplete documentation authority domain: ${domain.id}`);
  }
}

const prdReadinessContract = JSON.parse(readFileSync(
  join(
    packageDir,
    "skills",
    "optiak-prd-review",
    "references",
    "prd-readiness-contract.json",
  ),
  "utf8",
));
if (prdReadinessContract.schema !== "optiak-prd-readiness-contract/v1"
  || prdReadinessContract.status !== "offline_defined_no_product_decision_implied"
  || prdReadinessContract.humanConflictOwner !== "board") {
  fail("Unexpected PRD readiness contract identity or authority");
}
if (JSON.stringify(prdReadinessContract.verdicts)
    !== JSON.stringify(["ready_for_architecture", "changes_required", "blocked_on_evidence"])) {
  fail("PRD readiness verdict vocabulary drift");
}
if (prdReadinessContract.globalPolicy?.readyVerdictAuthorizesImplementation !== false
  || prdReadinessContract.globalPolicy?.publicDocsOrBacklogCreateProductIntent !== false
  || prdReadinessContract.globalPolicy?.reviewerMayResolveBoardDecision !== false
  || prdReadinessContract.globalPolicy?.notApplicableRequiresEvidenceAndRationale !== true) {
  fail("PRD readiness safety policy drift");
}
const prdGates = prdReadinessContract.gates ?? [];
const prdGateIds = new Set(prdGates.map((gate) => gate.id));
if (prdGates.length !== 16 || prdGateIds.size !== prdGates.length) {
  fail("PRD readiness contract must contain sixteen unique gates");
}
for (const gate of prdGates) {
  if (!agents.has(gate.owner) || !agents.has(gate.reviewer)) {
    fail(`Unknown PRD gate owner or reviewer: ${gate.id}`);
  }
  if (!(gate.evidence?.length > 0) || typeof gate.notApplicableAllowed !== "boolean") {
    fail(`Incomplete PRD readiness gate: ${gate.id}`);
  }
}
for (const requiredGate of [
  "immutable_prd_revision",
  "platform_boundary_and_non_goals",
  "roles_permissions_and_tenancy",
  "ui_states_brand_and_accessibility",
  "documentation_and_support_impact",
  "security_privacy_and_abuse",
  "rollout_rollback_and_release",
  "measurement_and_learning",
]) {
  if (!prdGateIds.has(requiredGate)) fail(`Missing PRD readiness gate: ${requiredGate}`);
}

const postmortemContract = JSON.parse(readFileSync(
  join(
    packageDir,
    "skills",
    "optiak-incident-triage",
    "references",
    "postmortem-contract.json",
  ),
  "utf8",
));
if (postmortemContract.schema !== "optiak-postmortem-contract/v1"
  || postmortemContract.status !== "offline_defined_no_incident_or_action_implied"
  || postmortemContract.humanConflictOwner !== "board") {
  fail("Unexpected postmortem contract identity or authority");
}
if (!postmortemContract.requirementPolicy?.alwaysRequiredSeverities?.includes("SEV0")
  || !postmortemContract.requirementPolicy?.alwaysRequiredSeverities?.includes("SEV1")
  || postmortemContract.blamelessPolicy?.unknownRootCauseAllowed !== true
  || postmortemContract.evidencePolicy?.verifiedRootCauseMinimumIndependentRefs !== 2) {
  fail("Postmortem requirement, blamelessness, or certainty policy drift");
}
for (const field of ["blame", "culprit", "personAtFault", "individualFault"]) {
  if (!postmortemContract.blamelessPolicy?.prohibitedFields?.includes(field)) {
    fail(`Postmortem prohibited blame field missing: ${field}`);
  }
}
if (postmortemContract.requiredSections?.length !== 11
  || new Set(postmortemContract.requiredSections).size !== 11) {
  fail("Postmortem contract must contain eleven unique required sections");
}
if (postmortemContract.correctiveActionPolicy?.minimumDistinctTypesForMaterialIncident !== 2
  || postmortemContract.correctiveActionPolicy?.unknownRootCauseRequiresInvestigationAction !== true
  || postmortemContract.correctiveActionPolicy?.acceptedOrLaterRequiresHumanDecisionRef !== true) {
  fail("Postmortem corrective-action policy drift");
}
if (postmortemContract.reviewPolicy?.independentReviewerMustDifferFromIncidentOwner !== true
  || postmortemContract.reviewPolicy?.boardOwnsRiskAcceptance !== true
  || postmortemContract.executionPolicy?.evaluatorMayExecuteCorrectiveAction !== false
  || postmortemContract.executionPolicy?.agentMayChangeProduction !== false
  || postmortemContract.executionPolicy?.agentMayCloseIncident !== false) {
  fail("Postmortem review or execution boundary drift");
}

const observabilityContract = JSON.parse(readFileSync(
  join(
    packageDir,
    "skills",
    "optiak-incident-triage",
    "references",
    "observability-source-contract.json",
  ),
  "utf8",
));
if (observabilityContract.schema !== "optiak-observability-source-contract/v1") {
  fail("Unexpected observability source contract schema");
}
if (observabilityContract.status !== "offline_contract_defined_connections_disconnected") {
  fail("Observability contract must not imply a live connection");
}
if (observabilityContract.globalPolicy?.defaultDecision !== "deny"
  || observabilityContract.globalPolicy?.readOnly !== true
  || observabilityContract.globalPolicy?.missingOrStaleSignal !== "unknown_not_healthy"
  || observabilityContract.globalPolicy?.noConnectedAlertIngress !== "no_automatic_oncall_coverage") {
  fail("Observability global fail-closed policy drift");
}
if (observabilityContract.initialTriageEnvelope?.initialQueryWindowMinutes !== 15
  || observabilityContract.initialTriageEnvelope?.maximumApplicationsPerQuery !== 1
  || observabilityContract.initialTriageEnvelope?.maximumExactTracesPerApproval !== 1) {
  fail("Observability initial query bounds drift");
}
if (observabilityContract.correlation?.timestampOnlyCorrelation !== "deny") {
  fail("Observability correlation must reject timestamp-only claims");
}
const observabilitySources = new Map(
  (observabilityContract.sources ?? []).map((source) => [source.id, source]),
);
for (const sourceId of [
  "optiak_admin_aggregate_analytics",
  "prometheus_metrics",
  "tempo_exact_trace",
  "sentry_backend_issue_index",
  "sentry_frontend_issue_index",
  "github_and_runtime_deploy_metadata",
  "service_health_endpoints",
  "application_logs",
  "raw_events_api",
  "paperclip_incident_history",
]) {
  if (!observabilitySources.has(sourceId)) fail(`Missing observability source: ${sourceId}`);
}
if (observabilitySources.get("optiak_admin_aggregate_analytics")?.initialSource !== true) {
  fail("Aggregate analytics must remain the initial observability source");
}
if (observabilitySources.get("tempo_exact_trace")?.maximumResults !== 1) {
  fail("Exact trace access must remain limited to one result per approval");
}
for (const sourceId of ["application_logs", "raw_events_api"]) {
  if (observabilitySources.get(sourceId)?.decision !== "deny") {
    fail(`${sourceId} must remain denied initially`);
  }
}
if (observabilityContract.alertRouting?.status !== "disconnected"
  || observabilityContract.alertRouting?.automaticWakeAllowed !== false) {
  fail("Alert routing must remain disconnected with automatic wake disabled");
}
for (const field of [
  "authorization_headers",
  "application_api_keys",
  "prompt_or_request_bodies",
  "model_response_bodies",
  "session_replays",
]) {
  if (!observabilityContract.redaction?.neverReturn?.includes(field)) {
    fail(`Observability redaction marker missing: ${field}`);
  }
}

const promotionContract = JSON.parse(readFileSync(
  join(
    packageDir,
    "skills",
    "optiak-release-readiness",
    "references",
    "ai-os-promotion-contract.json",
  ),
  "utf8",
));
if (promotionContract.schema !== "optiak-ai-os-promotion-contract/v1") {
  fail("Unexpected AI OS promotion contract schema");
}
if (promotionContract.packageVersion !== company.version) {
  fail("AI OS promotion contract package version drift");
}
if (promotionContract.status !== "offline_defined_not_deployed") {
  fail("AI OS promotion contract must not imply a deployed environment");
}
if (promotionContract.providerPolicy?.infrastructureProvider !== "undecided"
  || promotionContract.providerPolicy?.portableRequirementsOnly !== true
  || promotionContract.providerPolicy?.requiredImageIdentity !== "immutable_registry_digest"
  || promotionContract.providerPolicy?.mutableImageTagIsEvidence !== false) {
  fail("AI OS promotion provider-neutral or immutable-image policy drift");
}
if (promotionContract.environmentPolicy?.directLocalToProduction !== "deny"
  || promotionContract.environmentPolicy?.requiredValidationEnvironment !== "preproduction"
  || promotionContract.environmentPolicy?.localEvidenceMaySupportProductionReadiness !== false) {
  fail("AI OS promotion environment policy drift");
}
if (promotionContract.environmentPolicy?.requiredEvidenceScopes?.preproduction
    !== "connected_non_production"
  || promotionContract.environmentPolicy?.requiredEvidenceScopes?.production !== "production") {
  fail("AI OS promotion evidence-scope policy drift");
}
if (promotionContract.environmentPolicy?.finalEnvironment !== "production"
  || promotionContract.environmentPolicy?.authoring !== "local") {
  fail("AI OS promotion environment sequence drift");
}
const expectedPromotionStages = ["paused_import", "limited_agent_activation", "routine_activation"];
if (JSON.stringify(promotionContract.stageOrder) !== JSON.stringify(expectedPromotionStages)) {
  fail("AI OS promotion stage order drift");
}
if (promotionContract.gates?.length !== 22) {
  fail(`Expected 22 AI OS promotion gates, found ${promotionContract.gates?.length ?? 0}`);
}
const promotionGateIds = new Set((promotionContract.gates ?? []).map((gate) => gate.id));
if (promotionGateIds.size !== promotionContract.gates?.length) fail("Duplicate AI OS promotion gate id");
for (const requiredGate of [
  "package_archive_reproducible",
  "paperclip_image_pinned",
  "complete_backup_set_ready",
  "restore_rehearsal_passed",
  "import_preview_collision_free",
  "rollback_rehearsal_passed",
  "same_candidate_passed_preproduction",
  "production_prechange_backup_fresh",
]) {
  if (!promotionGateIds.has(requiredGate)) fail(`Missing AI OS promotion gate: ${requiredGate}`);
}
for (const backupItem of [
  "object_or_local_disk_attachments_and_artifacts",
  "registered_project_and_execution_workspace_data_required_for_recovery",
  "secret_provider_metadata_and_the_separately_protected_master_key_or_provider_bootstrap",
]) {
  if (!promotionContract.completeBackupSet?.includes(backupItem)) {
    fail(`AI OS complete backup-set item missing: ${backupItem}`);
  }
}
const promotionExecution = promotionContract.executionPolicy ?? {};
if (promotionExecution.evaluatorMayDeploy !== false
  || promotionExecution.agentMayDeploy !== false
  || promotionExecution.agentMayRollback !== false
  || promotionExecution.agentMayActivateAgentOrRoutine !== false
  || promotionExecution.boardDecisionRequiredForEveryStage !== true
  || promotionExecution.successfulEvaluation !== "ready_for_board_decision_only") {
  fail("AI OS promotion execution authority drift");
}

const testEnvironment = JSON.parse(readFileSync(
  join(packageDir, "skills", "optiak-e2e-validation", "references", "test-environment-contract.json"),
  "utf8",
));
if (testEnvironment.schema !== "optiak-test-environment-contract/v1") {
  fail("Unexpected test-environment contract schema");
}
if (testEnvironment.defaultDecision !== "deny") fail("Test environment must fail closed");
if (testEnvironment.humanConflictOwner !== "board") fail("Board must own test-environment conflicts");
const localTarget = testEnvironment.targets?.localDevelopment ?? {};
if (localTarget.authorizationState !== "read_only_reachability_observed_writes_denied") {
  fail("Local target must remain reachability-only");
}
if (localTarget.browser?.state !== "disconnected") fail("Browser must remain disconnected until live setup");
if (localTarget.tenant?.state !== "unclassified") fail("Local tenant must remain unclassified until operator approval");
if (localTarget.endpoints?.some((endpoint) => endpoint.method !== "GET" || !endpoint.url.startsWith("http://localhost:"))) {
  fail("Local probes must be GET-only on exact localhost endpoints");
}
if (testEnvironment.targets?.staging?.authorizationState !== "disconnected") {
  fail("Staging must remain disconnected until provisioned");
}
const productionTarget = testEnvironment.targets?.production ?? {};
if (productionTarget.authorizationState !== "deny" || productionTarget.networkRequests !== "deny" || productionTarget.mutations !== "deny") {
  fail("Production testing must be denied");
}
if (testEnvironment.syntheticData?.completionRequiresCleanup !== true) fail("Synthetic cleanup must gate completion");
if (testEnvironment.syntheticData?.configuredCredentialLifetimeHours !== 168) {
  fail("The initial application credential must use the seven-day UI minimum");
}
if (testEnvironment.syntheticData?.revokeEveryCredentialAtRunEnd !== true) {
  fail("Credential expiration must not replace terminal revocation");
}
if (testEnvironment.syntheticData?.applicationRetention?.boardApprovedReusableFixture !== "retain_allowed") {
  fail("Reusable application retention must require explicit Board approval");
}
if (testEnvironment.providerBudget?.authorizationState !== "proposed_pending_board_approval") {
  fail("Provider spend must remain pending Board approval");
}
if (testEnvironment.providerBudget?.maximumProviderSpendPerSmoke !== 1
  || testEnvironment.providerBudget?.maximumInferenceRequests !== 12
  || testEnvironment.providerBudget?.maximumOutputTokensPerRequest !== 128
  || testEnvironment.providerBudget?.automaticRetries !== 0) {
  fail("Unexpected initial smoke budget envelope");
}

const goldenJourneyMatrix = JSON.parse(readFileSync(
  join(packageDir, "skills", "optiak-e2e-validation", "references", "golden-journey-matrix.json"),
  "utf8",
));
if (goldenJourneyMatrix.schema !== "optiak-golden-journey-matrix/v1") {
  fail("Unexpected golden-journey matrix schema");
}
if (goldenJourneyMatrix.journeys?.length !== 13) {
  fail(`Expected 13 golden journeys, found ${goldenJourneyMatrix.journeys?.length ?? 0}`);
}
const journeyIds = new Set(goldenJourneyMatrix.journeys?.map((journey) => journey.id));
if (journeyIds.size !== goldenJourneyMatrix.journeys?.length) fail("Duplicate golden-journey id");
for (const requiredJourney of [
  "public-entry-and-auth-boundary",
  "application-key-lifecycle",
  "chat-completions-streaming",
  "responses-non-streaming-and-streaming",
  "cross-tenant-isolation",
  "credential-revocation-and-cleanup",
]) {
  if (!journeyIds.has(requiredJourney)) fail(`Missing golden journey: ${requiredJourney}`);
}
if (goldenJourneyMatrix.initialSmokeBudget?.plannedInferenceRequests !== 4
  || goldenJourneyMatrix.initialSmokeBudget?.maximumInferenceRequests !== 12
  || goldenJourneyMatrix.initialSmokeBudget?.automaticRetries !== 0) {
  fail("Golden-journey budget drift");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Package valid: ${agents.size} agents, ${skillFiles.length} skills, ${projects.size} projects, ${tasks.size} tasks, ${recurringTasks.size} paused routines.`);
