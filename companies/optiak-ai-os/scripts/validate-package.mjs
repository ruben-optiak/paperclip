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
  "runbooks/local-setup.md",
  "runbooks/connections.md",
  "runbooks/execution-budgets.md",
  "runbooks/security.md",
  "runbooks/smoke-test.md",
  "runtime/docker-compose.paperclip.yml",
  "scripts/scan-secrets.sh",
  "scripts/build-import-zip.sh",
  "scripts/import-allowlist.txt",
  "scripts/local-instance.sh",
  "scripts/summarize-run-usage.mjs",
  "scripts/validate-result-envelopes.mjs",
  "skills/optiak-durable-completion/references/contracts/result-envelope-v1.schema.json",
  "skills/optiak-durable-completion/references/result-taxonomy.md",
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
if (company.version !== "0.1.3") fail("Unexpected company version");
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
for (const marker of ["expected: 10", "expected: 4", "importedPaused: true", "companyMonthlyBilledCents: 15000", "warnPercent: 80", "hardStopPercent: 100", "productionMutation: deny"]) {
  if (!desired.includes(marker)) fail(`Desired-state marker missing: ${marker}`);
}
const allowlist = readFileSync(join(packageDir, "policies", "tool-allowlist.yaml"), "utf8");
for (const marker of ["defaultDecision: quarantine", "productionMutation: deny", "merge: deny", "deploy: deny", "secretAdministration: deny"]) {
  if (!allowlist.includes(marker)) fail(`Tool policy marker missing: ${marker}`);
}
const sourceMap = readFileSync(join(packageDir, "references", "source-map.yaml"), "utf8");
if (!sourceMap.includes("wholeSiteSnapshotsAllowed: false")) fail("Source map must deny whole-site snapshots");
if ((sourceMap.match(/status: disconnected/g) || []).length !== 7) fail("Future source disconnection state drift");

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Package valid: ${agents.size} agents, ${skillFiles.length} skills, ${projects.size} projects, ${tasks.size} tasks, ${recurringTasks.size} paused routines.`);
