#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function valueAtPath(object, path) {
  return path.split(".").reduce((value, segment) => value?.[segment], object);
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Parse only the versioned agent projection in .paperclip.yaml. This deliberately
 * avoids accepting arbitrary YAML features: the package owns this narrow shape,
 * and the live-parity gate must stay dependency-free and deterministic.
 */
export function parseExpectedAgents(source) {
  const agents = new Map();
  let inAgents = false;
  let current = null;
  let inExtraArgs = false;

  for (const rawLine of String(source).split(/\r?\n/)) {
    if (rawLine === "agents:") {
      inAgents = true;
      continue;
    }
    if (!inAgents) continue;
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(rawLine)) break;

    const agentMatch = rawLine.match(/^  ([a-z0-9-]+):\s*$/);
    if (agentMatch) {
      const slug = agentMatch[1];
      current = {
        urlKey: slug,
        status: "paused",
        role: null,
        budgetMonthlyCents: null,
        adapterType: null,
        adapterConfig: {instructionsBundleMode: "managed"},
        runtimeConfig: {heartbeat: {}},
        permissions: {},
      };
      agents.set(slug, current);
      inExtraArgs = false;
      continue;
    }
    if (!current) continue;

    let match;
    if ((match = rawLine.match(/^    role:\s+(.+)$/))) current.role = parseScalar(match[1]);
    else if ((match = rawLine.match(/^    budgetMonthlyCents:\s+(.+)$/))) current.budgetMonthlyCents = parseScalar(match[1]);
    else if ((match = rawLine.match(/^      type:\s+(.+)$/))) current.adapterType = parseScalar(match[1]);
    else if ((match = rawLine.match(/^        (engine|model|timeoutSec|dangerouslyBypassApprovalsAndSandbox):\s+(.+)$/))) {
      current.adapterConfig[match[1]] = parseScalar(match[2]);
      inExtraArgs = false;
    } else if (/^        extraArgs:\s*$/.test(rawLine)) {
      current.adapterConfig.extraArgs = [];
      inExtraArgs = true;
    } else if (inExtraArgs && (match = rawLine.match(/^          -\s+(.+)$/))) {
      current.adapterConfig.extraArgs.push(parseScalar(match[1]));
    } else if ((match = rawLine.match(/^      managedMcpOnly:\s+(.+)$/))) {
      current.runtimeConfig.managedMcpOnly = parseScalar(match[1]);
      inExtraArgs = false;
    } else if ((match = rawLine.match(/^        (enabled|maxConcurrentRuns|maxDailyRuns|maxDailyCostCents):\s+(.+)$/))) {
      current.runtimeConfig.heartbeat[match[1]] = parseScalar(match[2]);
      inExtraArgs = false;
    } else if ((match = rawLine.match(/^      canCreateAgents:\s+(.+)$/))) {
      current.permissions.canCreateAgents = parseScalar(match[1]);
      inExtraArgs = false;
    } else if (!/^\s*$/.test(rawLine) && !/^\s{10}-/.test(rawLine)) {
      inExtraArgs = false;
    }
  }

  return agents;
}

export function syntheticLiveSnapshot(expectedAgents) {
  return [...expectedAgents.entries()].map(([slug, expected]) => ({
    urlKey: slug,
    status: expected.status,
    role: expected.role,
    budgetMonthlyCents: expected.budgetMonthlyCents,
    adapterType: expected.adapterType,
    adapterConfig: clone(expected.adapterConfig),
    runtimeConfig: clone(expected.runtimeConfig),
    permissions: clone(expected.permissions),
  }));
}

export function evaluateAgentParity({expectedAgents, liveAgents, contract}) {
  if (!(expectedAgents instanceof Map)) throw new TypeError("expectedAgents must be a Map");
  if (!Array.isArray(liveAgents)) throw new TypeError("liveAgents must be an array");
  if (!Array.isArray(contract?.comparedFields)) throw new TypeError("contract.comparedFields must be an array");

  const violations = [];
  const liveBySlug = new Map();

  for (const liveAgent of liveAgents) {
    const slug = typeof liveAgent?.urlKey === "string" ? liveAgent.urlKey : null;
    if (!slug || liveBySlug.has(slug)) {
      violations.push({code: "invalid_live_identity", agent: slug ?? "unknown"});
      continue;
    }
    liveBySlug.set(slug, liveAgent);
  }

  for (const [slug, expected] of expectedAgents) {
    const live = liveBySlug.get(slug);
    if (!live) {
      violations.push({code: "missing_live_agent", agent: slug});
      continue;
    }
    for (const field of contract.comparedFields) {
      const expectedValue = valueAtPath(expected, field);
      const actualValue = valueAtPath(live, field);
      if (!equal(expectedValue, actualValue)) {
        violations.push({
          code: "field_mismatch",
          agent: slug,
          field,
          expected: clone(expectedValue),
          actual: clone(actualValue),
        });
      }
    }
  }

  if (contract.requireNoUnlistedAgents === true) {
    for (const slug of [...liveBySlug.keys()].sort()) {
      if (!expectedAgents.has(slug)) violations.push({code: "unlisted_live_agent", agent: slug});
    }
  }

  return {
    schema: "optiak-agent-live-parity-result/v1",
    verdict: violations.length === 0 ? "pass" : "drift",
    summary: {
      expectedAgents: expectedAgents.size,
      observedAgents: liveAgents.length,
      violations: violations.length,
    },
    violations,
    warnings: clone(contract.knownEffectiveAuthorityWarnings ?? []),
    automaticRepair: false,
    automaticActivation: false,
    remediationOwner: contract.failurePolicy?.remediationOwner ?? "board",
  };
}

function parseArgs(argv) {
  const options = {snapshot: "-", pretty: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--snapshot") {
      options.snapshot = argv[index + 1];
      if (!options.snapshot) throw new Error("--snapshot requires a path or -");
      index += 1;
    } else if (arg === "--pretty") options.pretty = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshotSource = options.snapshot === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(options.snapshot), "utf8");
  const parsedSnapshot = JSON.parse(snapshotSource);
  const liveAgents = Array.isArray(parsedSnapshot) ? parsedSnapshot : parsedSnapshot?.agents;
  const expectedAgents = parseExpectedAgents(readFileSync(join(packageDir, ".paperclip.yaml"), "utf8"));
  const contract = JSON.parse(readFileSync(join(packageDir, "policies", "agent-live-parity.json"), "utf8"));
  const result = evaluateAgentParity({expectedAgents, liveAgents, contract});
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
  if (result.verdict !== "pass") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Agent parity check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
