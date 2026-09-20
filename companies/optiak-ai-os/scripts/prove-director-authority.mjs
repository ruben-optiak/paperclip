#!/usr/bin/env node

import {existsSync, readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");

function parseArgs(argv) {
  const result = {apiBase: null, companyId: null, agent: "director-optiak", pretty: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--api-base") result.apiBase = argv[++index];
    else if (argument === "--company-id") result.companyId = argv[++index];
    else if (argument === "--agent") result.agent = argv[++index];
    else if (argument === "--pretty") result.pretty = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function usage() {
  return [
    "Usage: prove-director-authority.mjs --api-base URL --company-id ID [--agent SLUG] [--pretty]",
    "",
    "Creates one short-lived agent API key, performs a read-only authorization probe,",
    "revokes the key in a finally block, and emits only sanitized pass/fail evidence.",
    "The Paperclip Board CLI must already be authenticated.",
  ].join("\n");
}

function cliInvocation() {
  const explicit = process.env.PAPERCLIP_CLI_BIN?.trim();
  if (explicit) return {command: explicit, prefix: [], cwd: process.cwd()};
  if (existsSync(join(repoRoot, "package.json")) && existsSync(join(repoRoot, "cli", "src", "index.ts"))) {
    return {command: "pnpm", prefix: ["--silent", "paperclipai"], cwd: repoRoot};
  }
  return {command: "paperclipai", prefix: [], cwd: process.cwd()};
}

function runCliJson(args, label = "command") {
  const invocation = cliInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, ...args, "--json"], {
    cwd: invocation.cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Paperclip CLI ${label} failed with exit ${result.status ?? "unknown"}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Paperclip CLI ${label} returned non-JSON output`);
  }
}

function permissionKeys(agentDetail) {
  return new Set((agentDetail?.access?.grants ?? [])
    .map((grant) => grant?.permissionKey)
    .filter((key) => typeof key === "string"));
}

export function evaluateDirectorAuthority({agentDetail, probe, keyRevoked, policy}) {
  const grants = permissionKeys(agentDetail);
  const checks = {
    roleIsNonLegacyRoot: agentDetail?.role === policy.expectedRole,
    createAgentsStoredFalse:
      agentDetail?.permissions?.canCreateAgents === policy.requiredStoredPermissions.canCreateAgents,
    taskAssignmentEffective: agentDetail?.access?.canAssignTasks === true,
    taskAssignmentUsesExplicitGrant: agentDetail?.access?.taskAssignSource === "explicit_grant",
    requiredGrantsPresent: policy.requiredPermissionGrants.every((key) => grants.has(key)),
    forbiddenGrantsAbsent: policy.forbiddenPermissionGrants.every((key) => !grants.has(key)),
    readOnlyProbeUsed:
      probe?.method === policy.negativeProbe.method && policy.negativeProbe.readOnly === true,
    agentCreationDenied: probe?.status === policy.negativeProbe.expectedStatus,
    denialNamesCapability:
      typeof probe?.error === "string"
      && probe.error.includes(policy.negativeProbe.expectedErrorFragment),
    ephemeralKeyRevoked: keyRevoked === true,
  };
  const violations = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return {
    schema: "optiak-director-authority-proof/v1",
    verdict: violations.length === 0 ? "pass" : "fail",
    checks,
    violations,
    evidence: {
      agent: policy.agent,
      role: agentDetail?.role ?? null,
      createAgentsStored: agentDetail?.permissions?.canCreateAgents ?? null,
      taskAssignSource: agentDetail?.access?.taskAssignSource ?? null,
      probeMethod: probe?.method ?? null,
      probeStatus: probe?.status ?? null,
      keyRevoked: keyRevoked === true,
    },
    mutations: {
      agentCreated: false,
      agentActivated: false,
      ephemeralAgentKeyCreatedAndRevoked: keyRevoked === true,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.apiBase || !args.companyId) throw new Error("--api-base and --company-id are required");
  const apiBase = args.apiBase.replace(/\/$/, "");
  const policy = JSON.parse(readFileSync(join(packageDir, "policies", "director-authority.json"), "utf8"));
  const common = ["--api-base", apiBase];
  const liveAgents = runCliJson([
    "agent", "list",
    "--company-id", args.companyId,
    ...common,
  ], "agent list");
  const targetAgent = Array.isArray(liveAgents)
    ? liveAgents.find((agent) => agent?.urlKey === args.agent || agent?.metadata?.portableSlug === args.agent)
    : null;
  if (!targetAgent?.id) throw new Error("Director agent was not found by its portable slug");
  const agentDetail = runCliJson([
    "agent", "get", targetAgent.id,
    ...common,
  ], "agent detail");

  const keyName = `oai-043-proof-${new Date().toISOString().replaceAll(":", "-")}`;
  let createdKey = null;
  let probe = null;
  let keyRevoked = false;
  try {
    const created = runCliJson([
      "token", "agent", "create",
      "--company-id", args.companyId,
      "--agent", targetAgent.id,
      "--name", keyName,
      ...common,
    ], "ephemeral key create");
    createdKey = created?.key ?? null;
    if (!createdKey?.id || !createdKey?.token) throw new Error("Agent key response was incomplete");

    const response = await fetch(
      `${apiBase}${policy.negativeProbe.path.replace("{companyId}", encodeURIComponent(args.companyId))}`,
      {method: policy.negativeProbe.method, headers: {Authorization: `Bearer ${createdKey.token}`}},
    );
    const body = await response.json().catch(() => ({}));
    probe = {
      method: policy.negativeProbe.method,
      status: response.status,
      error: typeof body?.error === "string" ? body.error : "",
    };
  } finally {
    if (createdKey?.id) {
      try {
        runCliJson([
          "token", "agent", "revoke", createdKey.id,
          "--company-id", args.companyId,
          "--agent", targetAgent.id,
          ...common,
        ], "ephemeral key revoke");
        keyRevoked = true;
      } catch {
        keyRevoked = false;
      }
    }
  }

  const result = evaluateDirectorAuthority({agentDetail, probe, keyRevoked, policy});
  console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
  if (result.verdict !== "pass") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      schema: "optiak-director-authority-proof/v1",
      verdict: "invalid_input",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 2;
  });
}
