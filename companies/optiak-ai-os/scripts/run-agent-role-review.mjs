#!/usr/bin/env node

import {existsSync, readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");
const contractPath = join(packageDir, "references", "agent-role-review-runner-contract.json");
const matrixPath = join(packageDir, "references", "agent-role-review-matrix.json");

export function loadAgentRoleReviewRunnerContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

function unique(values) {
  return [...new Set(values)];
}

export function evaluateAgentRoleReviewRun(evidence, contract = loadAgentRoleReviewRunnerContract()) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("evidence must be an object");
  }
  if (evidence.schema !== "optiak-agent-role-review-run-evidence/v1") {
    throw new Error("unsupported role-review evidence schema");
  }
  if (!Array.isArray(evidence.events) || !Array.isArray(evidence.runs) || !Array.isArray(evidence.comments)) {
    throw new Error("events, runs and comments must be arrays");
  }

  const violations = [];
  if (evidence.agentStatusBefore !== contract.preconditions.agentStatus) {
    violations.push("agent_did_not_start_paused");
  }
  if (evidence.issueAssigneeAtCreation !== null) violations.push("issue_must_be_created_unassigned");
  if (JSON.stringify(evidence.events) !== JSON.stringify(contract.sequence)) {
    violations.push("required_sequence_mismatch");
  }
  if (evidence.runs.length !== contract.run.exactRunCount) violations.push("exactly_one_run_required");

  const soleRun = evidence.runs.length === 1 ? evidence.runs[0] : null;
  if (soleRun?.invocationSource !== contract.run.requiredInvocationSource) {
    violations.push("assignment_invocation_required");
  }
  if (soleRun?.status !== contract.run.requiredTerminalStatus) {
    violations.push("successful_terminal_run_required");
  }
  if (soleRun?.retryOfRunId != null || evidence.recoveryRunCount !== 0) {
    violations.push("recovery_or_retry_forbidden");
  }

  const canonicalComments = evidence.comments.filter((comment) =>
    typeof comment?.body === "string" && comment.body.includes(contract.run.canonicalReportMarker));
  if (canonicalComments.length !== contract.run.canonicalReportCount) {
    violations.push("exactly_one_canonical_report_required");
  }
  const canonical = canonicalComments.length === 1 ? canonicalComments[0] : null;
  if (!soleRun || canonical?.createdByRunId !== soleRun.id || canonical?.authorAgentMatches !== true) {
    violations.push("canonical_report_must_be_bound_to_sole_agent_run");
  }
  if (canonical?.externalWritesDeclared !== 0) violations.push("zero_external_writes_declaration_required");
  if (evidence.issueStatus !== contract.run.requiredIssueDisposition) {
    violations.push("final_disposition_missing");
  }
  if (evidence.activeRunCount !== contract.postconditions.activeRunsForIssue) {
    violations.push("active_run_remains");
  }
  if (evidence.externalWrites !== contract.run.externalWrites) violations.push("external_writes_forbidden");
  if (evidence.agentStatusAfter !== contract.postconditions.agentStatus) {
    violations.push("agent_did_not_end_paused");
  }

  return {
    schema: "optiak-agent-role-review-run-result/v1",
    verdict: violations.length === 0 ? "pass" : "fail",
    agent: evidence.agent ?? null,
    violations: unique(violations),
    runCount: evidence.runs.length,
    recoveryRunCount: evidence.recoveryRunCount,
    activeRunCount: evidence.activeRunCount,
    doesNotAuthorizeActivation: true,
    doesNotAuthorizeExternalWrites: true,
  };
}

function cliInvocation() {
  const explicit = process.env.PAPERCLIP_CLI_BIN?.trim();
  if (explicit) return {command: explicit, prefix: [], cwd: process.cwd()};
  if (existsSync(join(repoRoot, "package.json")) && existsSync(join(repoRoot, "cli", "src", "index.ts"))) {
    return {command: "pnpm", prefix: ["--silent", "paperclipai"], cwd: repoRoot};
  }
  return {command: "paperclipai", prefix: [], cwd: process.cwd()};
}

function runCliJson(args, label) {
  const invocation = cliInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, ...args, "--json"], {
    cwd: invocation.cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = String(result.stderr ?? "")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/(--api-key(?:=|\s+))\S+/gi, "$1[REDACTED]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    throw new Error(
      `Paperclip CLI ${label} failed with exit ${result.status ?? "unknown"}${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Paperclip CLI ${label} returned non-JSON output`);
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseArgs(argv) {
  const result = {pretty: false, execute: false, timeoutSec: 360, pollMs: 3000};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--api-base") result.apiBase = argv[++index];
    else if (argument === "--company-id") result.companyId = argv[++index];
    else if (argument === "--agent") result.agent = argv[++index];
    else if (argument === "--all") result.all = true;
    else if (argument === "--execute") result.execute = true;
    else if (argument === "--timeout-sec") result.timeoutSec = Number(argv[++index]);
    else if (argument === "--poll-ms") result.pollMs = Number(argv[++index]);
    else if (argument === "--pretty") result.pretty = true;
    else if (argument === "--evidence") result.evidence = argv[++index];
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function usage() {
  return [
    "Usage:",
    "  run-agent-role-review.mjs --evidence FILE|- [--pretty]",
    "  run-agent-role-review.mjs --api-base URL --company-id ID (--agent SLUG|--all) [--execute] [--pretty]",
    "",
    "Without --execute the live form prints the mutation-free execution plan.",
    "Execution creates unassigned fixture issues and always pauses the agent in a finally block.",
  ].join("\n");
}

export function reviewPrompt(reviewCase) {
  return [
    "Controlled fixture-only role review. Do not browse, call connected sources, create child issues, or perform external writes.",
    `Lead request class: ${reviewCase.requestClass}.`,
    `Scenario: ${reviewCase.scenario}`,
    `Return exactly one canonical output of type: ${reviewCase.canonicalOutput}.`,
    `Do not: ${reviewCase.mustNotDo.join(", ")}.`,
    `Required handoff: ${reviewCase.expectedHandoff}.`,
    "Your only final update must start with ROLE_REVIEW_FINAL, state exactly External writes: 0, include evidence scope and freshness, and set this issue to done in that same run.",
    "Do not post a report while leaving the issue open. Do not request or trigger a recovery run.",
  ].join("\n\n");
}

export function roleReviewFixtureTitle(reviewCase, suiteId) {
  return `[Role review ${suiteId}] ${reviewCase.agent}`;
}

function portableAgent(liveAgents, slug) {
  return liveAgents.find((agent) => agent?.urlKey === slug || agent?.metadata?.portableSlug === slug);
}

export function heartbeatRunId(run) {
  return run?.runId ?? run?.id ?? null;
}

function reportComment(comment, runId, agentId, marker) {
  const effectiveRunId = comment?.createdByRunId ?? comment?.derivedCreatedByRunId ?? null;
  const effectiveAgentId = comment?.authorAgentId ?? comment?.derivedAuthorAgentId ?? null;
  return typeof comment?.body === "string" && comment.body.includes(marker)
    ? {
        body: marker,
        createdByRunId: effectiveRunId,
        authorAgentMatches: effectiveAgentId === agentId,
        externalWritesDeclared: /External writes:\s*0\b/i.test(comment.body) ? 0 : null,
      }
    : null;
}

async function executeCase({apiBase, companyId, reviewCase, suiteId, timeoutSec, pollMs, contract}) {
  const common = ["--api-base", apiBase];
  const liveAgents = runCliJson(["agent", "list", "--company-id", companyId, ...common], "agent list");
  const agent = portableAgent(liveAgents, reviewCase.agent);
  if (!agent?.id) throw new Error(`Agent ${reviewCase.agent} was not found`);
  if (agent.status !== "paused") throw new Error(`Agent ${reviewCase.agent} must start paused`);

  const events = [];
  const issue = runCliJson([
    "issue", "create", "--company-id", companyId,
    "--title", roleReviewFixtureTitle(reviewCase, suiteId),
    "--description", reviewPrompt(reviewCase),
    "--status", contract.fixtureIssue.status, "--priority", contract.fixtureIssue.priority, ...common,
  ], "unassigned issue create");
  events.push("issue_created_unassigned");

  let finalAgentStatus = null;
  let finalIssue = issue;
  let runs = [];
  let comments = [];
  let liveRuns = [];
  try {
    runCliJson(["agent", "resume", agent.id, ...common], "agent resume");
    events.push("agent_resumed");
    runCliJson(["issue", "update", issue.id, "--assignee-agent-id", agent.id, ...common], "issue assignment");
    events.push("issue_assigned");

    const deadline = Date.now() + timeoutSec * 1000;
    let sawRun = false;
    while (Date.now() < deadline) {
      runs = runCliJson(["issue", "runs", issue.id, ...common], "issue runs");
      liveRuns = runCliJson(["issue", "live-runs", issue.id, ...common], "issue live runs");
      finalIssue = runCliJson(["issue", "get", issue.id, ...common], "issue get");
      if (runs.length > 1) break;
      if (!sawRun && runs.length === 1) {
        sawRun = true;
        events.push("assignment_run_started");
      }
      if (sawRun && liveRuns.length === 0 && runs[0]?.status && !["queued", "scheduled_retry", "running"].includes(runs[0].status)) break;
      await sleep(pollMs);
    }
    if (runs.length === 0) throw new Error(`No run started for ${reviewCase.agent}`);
    comments = runCliJson(["issue", "comments", issue.id, "--limit", "50", ...common], "issue comments");
    const soleRunId = heartbeatRunId(runs[0]);
    const canonical = comments
      .map((comment) => reportComment(comment, soleRunId, agent.id, contract.run.canonicalReportMarker))
      .filter(Boolean);
    if (canonical.length > 0 && finalIssue.status === contract.run.requiredIssueDisposition) {
      events.push("canonical_report_and_disposition_persisted");
    }
    if (liveRuns.length === 0) events.push("assignment_run_finished");
    events.push("result_inspected");
  } finally {
    runCliJson(["agent", "pause", agent.id, ...common], "agent pause");
    events.push("agent_paused");
    const refreshed = runCliJson(["agent", "get", agent.id, ...common], "agent final state");
    finalAgentStatus = refreshed.status;
  }

  const evidence = {
    schema: "optiak-agent-role-review-run-evidence/v1",
    evidenceScope: "connected_local",
    agent: reviewCase.agent,
    issueIdentifier: finalIssue.identifier ?? null,
    agentStatusBefore: agent.status,
    issueAssigneeAtCreation: issue.assigneeAgentId ?? null,
    events,
    runs: runs.map((run) => ({
      id: heartbeatRunId(run),
      invocationSource: run.invocationSource,
      status: run.status,
      retryOfRunId: run.retryOfRunId ?? null,
    })),
    comments: comments.map((comment) =>
      reportComment(comment, heartbeatRunId(runs[0]), agent.id, contract.run.canonicalReportMarker)).filter(Boolean),
    issueStatus: finalIssue.status,
    activeRunCount: liveRuns.length,
    recoveryRunCount: runs.filter((run) => run.retryOfRunId != null || run.invocationSource === "recovery").length,
    externalWrites: comments
      .map((comment) => reportComment(
        comment,
        heartbeatRunId(runs[0]),
        agent.id,
        contract.run.canonicalReportMarker,
      ))
      .filter(Boolean)
      .every((comment) => comment.externalWritesDeclared === 0) ? 0 : null,
    agentStatusAfter: finalAgentStatus,
  };
  return {evidence, result: evaluateAgentRoleReviewRun(evidence, contract)};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const contract = loadAgentRoleReviewRunnerContract();
  if (args.evidence) {
    const raw = args.evidence === "-" ? readFileSync(0, "utf8") : readFileSync(args.evidence, "utf8");
    const result = evaluateAgentRoleReviewRun(JSON.parse(raw), contract);
    console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
    if (result.verdict !== "pass") process.exitCode = 1;
    return;
  }
  if (!args.apiBase || !args.companyId || (Boolean(args.agent) === Boolean(args.all))) {
    throw new Error("--api-base, --company-id and exactly one of --agent or --all are required");
  }
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const cases = args.all ? matrix.cases : matrix.cases.filter((reviewCase) => reviewCase.agent === args.agent);
  if (cases.length === 0) throw new Error(`No review case found for ${args.agent}`);
  if (!args.execute) {
    console.log(JSON.stringify({
      schema: "optiak-agent-role-review-plan/v1",
      mode: "dry_run",
      fixtureIssue: contract.fixtureIssue,
      cases: cases.map((reviewCase) => ({agent: reviewCase.agent, sequence: contract.sequence})),
      mutations: 0,
    }, null, args.pretty ? 2 : 0));
    return;
  }

  const results = [];
  const suiteId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  for (const reviewCase of cases) {
    const outcome = await executeCase({
      apiBase: args.apiBase.replace(/\/$/, ""),
      companyId: args.companyId,
      reviewCase,
      suiteId,
      timeoutSec: args.timeoutSec,
      pollMs: args.pollMs,
      contract,
    });
    results.push(outcome);
    if (outcome.result.verdict !== "pass") break;
  }
  const output = {
    schema: "optiak-agent-role-review-suite-result/v1",
    verdict: results.length === cases.length && results.every((item) => item.result.verdict === "pass") ? "pass" : "fail",
    results,
  };
  console.log(JSON.stringify(output, null, args.pretty ? 2 : 0));
  if (output.verdict !== "pass") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      schema: "optiak-agent-role-review-suite-result/v1",
      verdict: "invalid_or_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 2;
  });
}
