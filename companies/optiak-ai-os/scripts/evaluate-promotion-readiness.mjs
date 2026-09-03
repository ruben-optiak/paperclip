#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  packageDir,
  "skills",
  "optiak-release-readiness",
  "references",
  "ai-os-promotion-contract.json",
);
const evidenceScopes = new Set(["fixture_only", "connected_non_production", "production"]);
const gateStatuses = new Set(["pass", "fail", "missing"]);

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

function requirePattern(value, pattern, field) {
  requireString(value, field);
  if (!pattern.test(value)) throw new Error(`${field} has an invalid format`);
}

export function loadPromotionContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

export function candidateFingerprint(candidate) {
  const value = requireObject(candidate, "candidate");
  const ordered = {
    package_git_commit: value.package_git_commit,
    package_zip_sha256: value.package_zip_sha256,
    paperclip_version: value.paperclip_version,
    paperclip_image_digest: value.paperclip_image_digest,
    database_migration_revision: value.database_migration_revision,
    configuration_fingerprint: value.configuration_fingerprint,
  };
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export function requiredPromotionGates(contract, targetEnvironment, requestedStage) {
  const value = requireObject(contract, "contract");
  if (!value.environmentPolicy || !Array.isArray(value.gates) || !Array.isArray(value.stageOrder)) {
    throw new Error("invalid promotion contract structure");
  }
  if (!new Set(["preproduction", "production"]).has(targetEnvironment)) {
    throw new Error(`unsupported target environment ${targetEnvironment}`);
  }
  const requestedRank = value.stageOrder.indexOf(requestedStage);
  if (requestedRank < 0) throw new Error(`unsupported requested stage ${requestedStage}`);
  return value.gates.filter((gate) => {
    const minimumRank = value.stageOrder.indexOf(gate.minimumStage);
    if (minimumRank < 0) throw new Error(`gate ${gate.id} has unsupported minimumStage`);
    return gate.environments.includes(targetEnvironment) && minimumRank <= requestedRank;
  });
}

export function evaluatePromotionEvidence(evidence, contract = loadPromotionContract()) {
  const value = requireObject(evidence, "evidence");
  if (value.schema !== "optiak-ai-os-promotion-evidence/v1") {
    throw new Error("schema must be optiak-ai-os-promotion-evidence/v1");
  }
  if (!evidenceScopes.has(value.evidenceScope)) {
    throw new Error(`unsupported evidenceScope ${value.evidenceScope}`);
  }
  requireString(value.targetEnvironment, "targetEnvironment");
  requireString(value.sourceEnvironment, "sourceEnvironment");
  requireString(value.requestedStage, "requestedStage");

  const candidate = requireObject(value.candidate, "candidate");
  requirePattern(candidate.package_git_commit, /^[0-9a-f]{40}$/, "candidate.package_git_commit");
  requirePattern(candidate.package_zip_sha256, /^[0-9a-f]{64}$/, "candidate.package_zip_sha256");
  requireString(candidate.paperclip_version, "candidate.paperclip_version");
  requirePattern(candidate.paperclip_image_digest, /^sha256:[0-9a-f]{64}$/, "candidate.paperclip_image_digest");
  requireString(candidate.database_migration_revision, "candidate.database_migration_revision");
  requirePattern(candidate.configuration_fingerprint, /^[0-9a-f]{64}$/, "candidate.configuration_fingerprint");

  if (!Array.isArray(value.gateResults)) throw new Error("gateResults must be an array");
  const knownGates = new Set(contract.gates.map((gate) => gate.id));
  const gateResults = new Map();
  for (const entry of value.gateResults) {
    requireObject(entry, "gateResults entry");
    requireString(entry.gateId, "gateResults.gateId");
    if (!knownGates.has(entry.gateId)) throw new Error(`unknown gate ${entry.gateId}`);
    if (gateResults.has(entry.gateId)) throw new Error(`duplicate gate result ${entry.gateId}`);
    if (!gateStatuses.has(entry.status)) throw new Error(`unsupported status for ${entry.gateId}`);
    if (!Array.isArray(entry.evidenceRefs)) throw new Error(`evidenceRefs must be an array for ${entry.gateId}`);
    if (entry.status === "pass" && entry.evidenceRefs.length === 0) {
      throw new Error(`passing gate ${entry.gateId} requires an evidence reference`);
    }
    if (entry.evidenceRefs.some((reference) => typeof reference !== "string" || reference.length === 0)) {
      throw new Error(`invalid evidence reference for ${entry.gateId}`);
    }
    requireString(entry.checkedAt, `gateResults.${entry.gateId}.checkedAt`);
    if (Number.isNaN(Date.parse(entry.checkedAt))) {
      throw new Error(`invalid checkedAt for ${entry.gateId}`);
    }
    gateResults.set(entry.gateId, entry);
  }

  const required = requiredPromotionGates(contract, value.targetEnvironment, value.requestedStage);
  const fingerprint = candidateFingerprint(candidate);
  const requiredEvidenceScope = contract.environmentPolicy?.requiredEvidenceScopes?.[
    value.targetEnvironment
  ];
  if (!requiredEvidenceScope) {
    throw new Error(`no required evidence scope for ${value.targetEnvironment}`);
  }

  if (value.targetEnvironment === "production" && value.sourceEnvironment !== "preproduction") {
    return {
      verdict: "deny_direct_local_to_production",
      candidateFingerprint: fingerprint,
      requiredGateIds: required.map((gate) => gate.id),
      failedGateIds: [],
      missingGateIds: [],
      evidenceScopeEligible: false,
      doesNotAuthorizeExecution: true,
      nextAction: "Validate the exact candidate in preproduction first.",
    };
  }

  const failedGateIds = [];
  const missingGateIds = [];
  for (const gate of required) {
    const result = gateResults.get(gate.id);
    if (!result || result.status === "missing") missingGateIds.push(gate.id);
    else if (result.status === "fail") failedGateIds.push(gate.id);
  }

  let verdict = "ready_for_board_decision";
  let nextAction = "Request an exact Board decision for this candidate, environment, and stage.";
  if (failedGateIds.length > 0) {
    verdict = "not_ready";
    nextAction = "Resolve failed gates and evaluate a new immutable evidence set.";
  } else if (missingGateIds.length > 0) {
    verdict = "blocked_on_evidence";
    nextAction = "Collect the missing evidence without widening access or mutating production.";
  } else if (value.evidenceScope !== requiredEvidenceScope) {
    verdict = "blocked_on_evidence";
    nextAction = `Collect ${requiredEvidenceScope} evidence for ${value.targetEnvironment}; fixture-only or cross-environment evidence is not promotion evidence.`;
  }

  return {
    verdict,
    candidateFingerprint: fingerprint,
    requiredGateIds: required.map((gate) => gate.id),
    failedGateIds,
    missingGateIds,
    evidenceScopeEligible: value.evidenceScope === requiredEvidenceScope,
    doesNotAuthorizeExecution: true,
    nextAction,
  };
}

async function runCli() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected promotion evidence on stdin");
  console.log(JSON.stringify(evaluatePromotionEvidence(JSON.parse(raw)), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
