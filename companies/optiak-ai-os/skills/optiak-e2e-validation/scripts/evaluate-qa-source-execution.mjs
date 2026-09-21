#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(skillDir, "references", "qa-source-execution-contract.json");
const revisionPattern = /^[0-9a-f]{40}$/;

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

export function loadQaSourceExecutionContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

export function evaluateQaSourceExecution(evidence, contract = loadQaSourceExecutionContract()) {
  const value = object(evidence, "evidence");
  if (value.schema !== "optiak-qa-source-execution-evidence/v1") {
    throw new Error("schema must be optiak-qa-source-execution-evidence/v1");
  }
  const profile = contract.profiles[value.profile];
  if (!profile) throw new Error(`unsupported profile ${value.profile}`);
  if (!Array.isArray(value.stepResults)) throw new Error("stepResults must be an array");

  const safetyBlockers = [];
  const structuralViolations = [];
  const testFailures = [];
  if (value.evidenceScope !== "connected_ephemeral_qa") safetyBlockers.push("connected_ephemeral_qa_evidence_required");
  if (value.agentSlug !== contract.executionAgent) safetyBlockers.push("wrong_execution_agent");
  if (value.repository !== profile.repository
    || !contract.checkout.allowedRepositories.includes(value.repository)) {
    safetyBlockers.push("repository_not_allowed_for_profile");
  }
  if (!revisionPattern.test(value.revision ?? "")) structuralViolations.push("exact_full_revision_required");
  if (value.runtimeBoundary !== contract.runtime.requiredBoundary) safetyBlockers.push("dedicated_runtime_required");
  if (value.sharedControlPlaneUsed !== false) safetyBlockers.push("shared_control_plane_forbidden");
  if (value.repositoryCredentialVisibleToTests !== false) safetyBlockers.push("repository_credential_exposed");
  if (value.productionCredentialsPresent !== false) safetyBlockers.push("production_credentials_forbidden");
  if (value.customerDataPresent !== false) safetyBlockers.push("customer_data_forbidden");
  if (value.dockerSocketMounted !== false) safetyBlockers.push("docker_socket_forbidden");
  if (value.externalWrites !== 0) safetyBlockers.push("external_writes_forbidden");
  if (value.sourceChangesPersisted !== false) safetyBlockers.push("source_changes_must_not_persist");
  if (value.cleanup !== "completed") safetyBlockers.push("cleanup_incomplete");
  if (value.durationSeconds > contract.runtime.maximumJobSeconds) structuralViolations.push("job_timeout_exceeded");
  if (value.artifactBytes > contract.runtime.maximumArtifactBytes) structuralViolations.push("artifact_limit_exceeded");
  if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 0) {
    throw new Error("durationSeconds must be a non-negative integer");
  }
  if (!Number.isInteger(value.artifactBytes) || value.artifactBytes < 0) {
    throw new Error("artifactBytes must be a non-negative integer");
  }
  for (const field of ["startedAt", "completedAt"]) {
    if (typeof value[field] !== "string" || Number.isNaN(Date.parse(value[field]))) {
      structuralViolations.push(`${field}_invalid`);
    }
  }

  const expectedSteps = profile.steps.map((step) => step.id);
  const observedSteps = value.stepResults.map((result) => result?.id);
  if (JSON.stringify(observedSteps) !== JSON.stringify(expectedSteps)) {
    structuralViolations.push("profile_step_sequence_mismatch");
  }
  for (const result of value.stepResults) {
    object(result, "stepResult");
    if (!expectedSteps.includes(result.id)) structuralViolations.push(`unknown_step:${result.id}`);
    if (!Number.isInteger(result.exitCode)) throw new Error(`exitCode missing for ${result.id}`);
    if (result.exitCode !== 0) testFailures.push(result.id);
  }

  let verdict = "execution_evidence_ready";
  if (safetyBlockers.length > 0) verdict = "blocked_on_runtime_safety";
  else if (structuralViolations.length > 0) verdict = "invalid_execution_evidence";
  else if (testFailures.length > 0) verdict = "test_failures_observed";

  return {
    schema: "optiak-qa-source-execution-result/v1",
    verdict,
    repository: value.repository ?? null,
    revision: value.revision ?? null,
    profile: value.profile,
    safetyBlockers: [...new Set(safetyBlockers)],
    structuralViolations: [...new Set(structuralViolations)],
    testFailures: [...new Set(testFailures)],
    doesNotProveRootCause: true,
    doesNotAuthorizeImplementation: true,
    doesNotAuthorizeRelease: true
  };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected QA execution evidence on stdin");
  const result = evaluateQaSourceExecution(JSON.parse(raw));
  console.log(JSON.stringify(result, null, 2));
  if (!new Set(["execution_evidence_ready", "test_failures_observed"]).has(result.verdict)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
