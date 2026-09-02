#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  packageDir,
  "skills",
  "optiak-e2e-validation",
  "references",
  "test-environment-contract.json",
);

export function isExactLoopbackUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    && parsed.username === ""
    && parsed.password === "";
}

export function validateTestEnvironmentContract(contract) {
  const errors = [];
  if (contract.schema !== "optiak-test-environment-contract/v1") errors.push("unexpected schema");
  if (contract.defaultDecision !== "deny") errors.push("default decision must deny");
  if (contract.humanConflictOwner !== "board") errors.push("Board must own conflicts");

  const local = contract.targets?.localDevelopment;
  if (local?.authorizationState !== "read_only_reachability_observed_writes_denied") {
    errors.push("local target must remain reachability-only until approved");
  }
  if (local?.tenant?.writes !== "deny_until_dedicated_synthetic_tenant_and_disposable_data_are_confirmed") {
    errors.push("local writes must fail closed");
  }
  if (!Array.isArray(local?.endpoints) || local.endpoints.length === 0) {
    errors.push("local endpoints are missing");
  } else {
    for (const endpoint of local.endpoints) {
      if (endpoint.method !== "GET") errors.push(`${endpoint.id} is not GET-only`);
      if (!isExactLoopbackUrl(endpoint.url)) errors.push(`${endpoint.id} is not exact loopback`);
      if (!Array.isArray(endpoint.expectedHttpStatuses) || endpoint.expectedHttpStatuses.length === 0) {
        errors.push(`${endpoint.id} has no expected HTTP status`);
      }
    }
  }

  const staging = contract.targets?.staging;
  if (staging?.authorizationState !== "disconnected" || staging?.writes !== "deny") {
    errors.push("staging must remain disconnected and deny writes before provisioning");
  }
  const production = contract.targets?.production;
  if (production?.authorizationState !== "deny" || production?.networkRequests !== "deny" || production?.mutations !== "deny") {
    errors.push("production must deny network requests and mutations");
  }
  if (!String(production?.knownGateway || "").startsWith("https://api.optiak.dev/")) {
    errors.push("known production gateway denial is missing");
  }

  const budget = contract.providerBudget;
  if (budget?.authorizationState !== "proposed_pending_board_approval") {
    errors.push("provider spend must remain pending Board approval");
  }
  if (!(budget?.maximumProviderSpendPerSmoke > 0 && budget.maximumProviderSpendPerSmoke <= 1)) {
    errors.push("initial provider spend cap must be positive and at most USD 1");
  }
  if (!(budget?.maximumInferenceRequests > 0 && budget.maximumInferenceRequests <= 12)) {
    errors.push("initial inference request cap must be between 1 and 12");
  }
  if (budget?.automaticRetries !== 0) errors.push("automatic retries must be zero");

  if (contract.syntheticData?.completionRequiresCleanup !== true) {
    errors.push("cleanup must gate completion");
  }
  if (!(contract.syntheticData?.maximumLifetimeHours > 0 && contract.syntheticData.maximumLifetimeHours <= 24)) {
    errors.push("synthetic data lifetime must be at most 24 hours");
  }

  return errors;
}

export function summarizeLiveProbe(contract, observations) {
  const endpoints = contract.targets.localDevelopment.endpoints.map((endpoint) => {
    const observation = observations.find((candidate) => candidate.id === endpoint.id);
    const status = observation?.httpStatus ?? null;
    return {
      id: endpoint.id,
      url: endpoint.url,
      httpStatus: status,
      ready: endpoint.expectedHttpStatuses.includes(status),
      errorClass: observation?.errorClass ?? null,
    };
  });
  const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const uiReachable = byId.get("control-plane-ui")?.ready === true;
  const adminReady = byId.get("admin-health")?.ready === true;
  const gatewayReady = byId.get("gateway-health")?.ready === true;
  const mcpReady = byId.get("mcp-health")?.ready === true;
  const browserConnected = contract.targets.localDevelopment.browser.state === "connected";

  return {
    schema: "optiak-test-environment-probe/v1",
    target: "localDevelopment",
    safety: "credential_free_get_only",
    endpoints,
    readiness: {
      uiReachable,
      adminReady,
      gatewayReady,
      mcpReady,
      browserConnected,
      authenticatedJourneysAllowed: uiReachable && adminReady && gatewayReady && browserConnected
        && contract.targets.localDevelopment.tenant.state === "approved_synthetic",
      syntheticWritesAllowed: false,
      productionAllowed: false,
    },
  };
}

async function probeEndpoint(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(endpoint.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: endpoint.id.includes("health") ? "application/json" : "text/html,application/json;q=0.9",
      },
    });
    return {id: endpoint.id, httpStatus: response.status, errorClass: null};
  } catch (error) {
    const errorClass = error?.name === "AbortError" ? "timeout" : "connection_failed";
    return {id: endpoint.id, httpStatus: null, errorClass};
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeLocal(contract) {
  const endpoints = contract.targets.localDevelopment.endpoints;
  if (endpoints.some((endpoint) => endpoint.method !== "GET" || !isExactLoopbackUrl(endpoint.url))) {
    throw new Error("Refusing live probe: every endpoint must be credential-free GET on exact loopback");
  }
  const observations = await Promise.all(endpoints.map(probeEndpoint));
  return summarizeLiveProbe(contract, observations);
}

function printHelp() {
  console.log("Usage: check-test-environment.mjs [--live-local] [--require-api-ready] [--json]");
  console.log("Without --live-local, validates only the versioned fail-closed contract.");
  console.log("The live probe sends credential-free GET requests only to exact loopback URLs from the contract.");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const known = new Set(["--live-local", "--require-api-ready", "--json", "--help"]);
  const unknown = [...args].filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
  if (args.has("--help")) {
    printHelp();
    return;
  }

  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const errors = validateTestEnvironmentContract(contract);
  if (errors.length > 0) throw new Error(`Invalid test-environment contract: ${errors.join("; ")}`);

  if (!args.has("--live-local")) {
    const result = {schema: contract.schema, contractVersion: contract.contractVersion, valid: true};
    console.log(args.has("--json") ? JSON.stringify(result, null, 2) : "Test-environment contract valid.");
    return;
  }

  const result = await probeLocal(contract);
  console.log(JSON.stringify(result, null, 2));
  if (args.has("--require-api-ready") && !result.readiness.gatewayReady) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
