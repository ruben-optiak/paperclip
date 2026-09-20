#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function evaluateExecutionWorkspace(contract, evidence) {
  const blockers = [];
  const allowedRepositories = new Map(contract.repositories.map((repository) => [repository.slug, repository]));
  const registered = allowedRepositories.get(evidence.repository);

  if (evidence.evidenceScope !== "connected_local") blockers.push("live_evidence_required");
  if (evidence.agentSlug !== contract.implementationAgent) blockers.push("wrong_implementation_agent");
  if (!registered || evidence.registeredRepository !== true) blockers.push("repository_not_allowed");
  if (registered && evidence.baseRef !== registered.baseRef) blockers.push("base_ref_mismatch");
  if (typeof evidence.baseRevision !== "string" || evidence.baseRevision.length === 0) {
    blockers.push("base_revision_missing");
  }
  if (evidence.workspaceOwnedByPaperclip !== true) blockers.push("workspace_not_paperclip_owned");
  if (evidence.mode !== contract.workspacePolicy.defaultMode) blockers.push("workspace_mode_mismatch");
  if (evidence.strategy !== contract.workspacePolicy.strategy.type) blockers.push("workspace_strategy_mismatch");
  if (evidence.issueScopedBranch !== true) blockers.push("issue_scoped_branch_missing");
  if (evidence.cleanInitialWorktree !== true) blockers.push("initial_worktree_not_clean");
  if (evidence.sharedCheckoutUsed !== false) blockers.push("shared_checkout_forbidden");
  if (evidence.nestedWorktreeCreated !== false) blockers.push("nested_worktree_forbidden");
  if (evidence.mergePerformed !== false) blockers.push("merge_forbidden");
  if (evidence.deployPerformed !== false) blockers.push("deploy_forbidden");
  if (evidence.productionCredentialsPresent !== false) blockers.push("production_credentials_forbidden");
  if (evidence.reviewerWriteAccess !== false) blockers.push("reviewer_write_access_forbidden");
  if (evidence.runtimeBoundarySeparated !== true) blockers.push("execution_boundary_not_separate");
  if (evidence.sandboxBackend !== contract.runtimeBoundaryPolicy.requiredSandboxBackend) {
    blockers.push("sandbox_backend_mismatch");
  }
  if (evidence.gitMetadataReadableByAgent !== true) blockers.push("git_metadata_not_readable_by_agent");
  if (evidence.controlPlaneSecurityRelaxed !== false) blockers.push("control_plane_relaxation_forbidden");

  return {
    schema: "optiak-execution-workspace-readiness-result/v1",
    verdict: blockers.length === 0 ? "ready_for_controlled_smoke" : "not_ready",
    repository: evidence.repository ?? null,
    evidenceScope: evidence.evidenceScope ?? "unknown",
    blockers: [...new Set(blockers)],
    authority: "advice_only_board_retains_activation_merge_and_deploy_decisions",
  };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    console.error("Usage: evaluate-execution-workspace.mjs EVIDENCE.json");
    process.exitCode = 2;
    return;
  }
  try {
    const contract = JSON.parse(readFileSync(
      join(packageDir, "references", "execution-workspace-contract.json"),
      "utf8",
    ));
    const evidence = JSON.parse(readFileSync(inputPath, "utf8"));
    const result = evaluateExecutionWorkspace(contract, evidence);
    console.log(JSON.stringify(result, null, 2));
    if (result.verdict !== "ready_for_controlled_smoke") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      schema: "optiak-execution-workspace-readiness-result/v1",
      verdict: "invalid_input",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
