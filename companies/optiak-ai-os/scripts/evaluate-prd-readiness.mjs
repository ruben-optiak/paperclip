#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  packageDir,
  "skills",
  "optiak-prd-review",
  "references",
  "prd-readiness-contract.json",
);
const allowedScopes = new Set(["fixture_only", "versioned_internal", "connected_live"]);
const allowedStatuses = new Set(["pass", "fail", "missing", "not_applicable"]);

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

export function loadPrdReadinessContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

export function evaluatePrdReadiness(evidence, contract = loadPrdReadinessContract()) {
  const value = requireObject(evidence, "evidence");
  if (value.schema !== "optiak-prd-readiness-evidence/v1") {
    throw new Error("schema must be optiak-prd-readiness-evidence/v1");
  }
  if (!allowedScopes.has(value.evidenceScope)) {
    throw new Error(`unsupported evidenceScope ${value.evidenceScope}`);
  }
  const prd = requireObject(value.prd, "prd");
  requireString(prd.revision, "prd.revision");
  requireString(prd.title, "prd.title");
  if (!Array.isArray(value.gateResults)) throw new Error("gateResults must be an array");

  const contractGates = new Map((contract.gates ?? []).map((gate) => [gate.id, gate]));
  if (contractGates.size !== contract.gates?.length) throw new Error("contract has duplicate gates");
  const results = new Map();
  for (const entry of value.gateResults) {
    requireObject(entry, "gate result");
    requireString(entry.gateId, "gateResult.gateId");
    if (!contractGates.has(entry.gateId)) throw new Error(`unknown gate ${entry.gateId}`);
    if (results.has(entry.gateId)) throw new Error(`duplicate gate result ${entry.gateId}`);
    if (!allowedStatuses.has(entry.status)) {
      throw new Error(`unsupported status for ${entry.gateId}`);
    }
    if (!Array.isArray(entry.evidenceRefs)) {
      throw new Error(`evidenceRefs must be an array for ${entry.gateId}`);
    }
    if (entry.evidenceRefs.some((reference) => typeof reference !== "string" || reference.length === 0)) {
      throw new Error(`invalid evidence reference for ${entry.gateId}`);
    }
    if (["pass", "fail", "not_applicable"].includes(entry.status)
      && entry.evidenceRefs.length === 0) {
      throw new Error(`${entry.status} gate ${entry.gateId} requires evidence`);
    }
    if (entry.status === "not_applicable") {
      if (!contractGates.get(entry.gateId).notApplicableAllowed) {
        throw new Error(`gate ${entry.gateId} cannot be not_applicable`);
      }
      requireString(entry.rationale, `gateResult.${entry.gateId}.rationale`);
    }
    results.set(entry.gateId, entry);
  }

  const missingGateIds = [];
  const failedGateIds = [];
  for (const gate of contract.gates ?? []) {
    const result = results.get(gate.id);
    if (!result || result.status === "missing") missingGateIds.push(gate.id);
    else if (result.status === "fail") failedGateIds.push(gate.id);
  }

  let verdict = "ready_for_architecture";
  let nextOwner = contract.handoff?.ready_for_architecture;
  let nextAction = "Review the exact PRD revision through the architecture gate; do not start implementation.";
  if (missingGateIds.length > 0) {
    verdict = "blocked_on_evidence";
    nextOwner = contractGates.get(missingGateIds[0])?.owner;
    nextAction = "Collect the missing evidence or record an evidenced not-applicable result where the contract permits it.";
  } else if (failedGateIds.length > 0) {
    verdict = "changes_required";
    nextOwner = contract.handoff?.changes_required;
    nextAction = "Revise the same PRD or create a new immutable revision that resolves the failed gates.";
  }

  return {
    verdict,
    prdRevision: prd.revision,
    evidenceScope: value.evidenceScope,
    missingGateIds,
    failedGateIds,
    nextOwner,
    nextAction,
    doesNotAuthorizeImplementation: true,
  };
}

async function runCli() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected PRD readiness evidence on stdin");
  console.log(JSON.stringify(evaluatePrdReadiness(JSON.parse(raw)), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
