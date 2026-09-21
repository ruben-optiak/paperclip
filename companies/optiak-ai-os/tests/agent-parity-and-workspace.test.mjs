import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  evaluateAgentParity,
  parseExpectedAgents,
  syntheticLiveSnapshot,
} from "../scripts/check-live-agent-parity.mjs";
import {evaluateDirectorAuthority} from "../scripts/prove-director-authority.mjs";
import {evaluateExecutionWorkspace} from "../scripts/evaluate-execution-workspace.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function json(path) {
  return JSON.parse(readFileSync(join(packageDir, path), "utf8"));
}

function setPath(object, path, value) {
  const segments = path.split(".");
  const final = segments.pop();
  const target = segments.reduce((current, segment) => current[segment], object);
  target[final] = value;
}

test("agent parity derives all ten portable expectations from .paperclip.yaml", () => {
  const expectedAgents = parseExpectedAgents(readFileSync(join(packageDir, ".paperclip.yaml"), "utf8"));
  assert.equal(expectedAgents.size, 10);
  for (const [slug, expected] of expectedAgents) {
    assert.equal(expected.status, "paused", slug);
    assert.equal(expected.adapterType, "codex_local", slug);
    assert.equal(expected.adapterConfig.instructionsBundleMode, "managed", slug);
    assert.equal(expected.adapterConfig.dangerouslyBypassApprovalsAndSandbox, false, slug);
    assert.equal(expected.runtimeConfig.managedMcpOnly, true, slug);
    assert.equal(expected.runtimeConfig.heartbeat.enabled, false, slug);
  }
  assert.equal(expectedAgents.get("director-optiak").role, "general");
  assert.equal(expectedAgents.get("director-optiak").permissions.canCreateAgents, false);
});

test("agent parity detects the versioned healthy and drift fixtures", () => {
  const expectedAgents = parseExpectedAgents(readFileSync(join(packageDir, ".paperclip.yaml"), "utf8"));
  const contract = json("policies/agent-live-parity.json");
  const fixture = json("references/fixtures/agent-live-parity-drift.json");

  for (const fixtureCase of fixture.cases) {
    const liveAgents = syntheticLiveSnapshot(expectedAgents);
    for (const mutation of fixtureCase.mutations ?? []) {
      const agent = liveAgents.find((candidate) => candidate.urlKey === mutation.agent);
      assert.ok(agent, `Unknown fixture agent ${mutation.agent}`);
      setPath(agent, mutation.path, mutation.value);
    }
    if (fixtureCase.removeAgent) {
      liveAgents.splice(liveAgents.findIndex((agent) => agent.urlKey === fixtureCase.removeAgent), 1);
    }
    if (fixtureCase.appendAgent) {
      liveAgents.push({urlKey: fixtureCase.appendAgent, name: "Unexpected Agent"});
    }

    const result = evaluateAgentParity({expectedAgents, liveAgents, contract});
    assert.equal(result.verdict, fixtureCase.expectedVerdict, fixtureCase.id);
    assert.deepEqual(result.warnings, []);
    if (fixtureCase.expectedField) {
      assert.ok(result.violations.some((violation) => violation.field === fixtureCase.expectedField), fixtureCase.id);
    }
    if (fixtureCase.expectedCode) {
      assert.ok(result.violations.some((violation) => violation.code === fixtureCase.expectedCode), fixtureCase.id);
    }
  }
});

test("agent parity output omits ignored instance ids and unrelated sensitive fields", () => {
  const expectedAgents = parseExpectedAgents(readFileSync(join(packageDir, ".paperclip.yaml"), "utf8"));
  const contract = json("policies/agent-live-parity.json");
  const liveAgents = syntheticLiveSnapshot(expectedAgents).map((agent) => ({
    ...agent,
    id: "database-id-must-not-escape",
    companyId: "company-id-must-not-escape",
    metadata: {token: "secret-must-not-escape"},
  }));
  const result = evaluateAgentParity({expectedAgents, liveAgents, contract});
  const serialized = JSON.stringify(result);
  assert.equal(result.verdict, "pass");
  assert.doesNotMatch(serialized, /database-id-must-not-escape|company-id-must-not-escape|secret-must-not-escape/);
});

test("director authority requires explicit task assignment and proves agent creation denial", () => {
  const policy = json("policies/director-authority.json");
  const result = evaluateDirectorAuthority({
    policy,
    agentDetail: {
      role: "general",
      permissions: {canCreateAgents: false},
      access: {
        canAssignTasks: true,
        taskAssignSource: "explicit_grant",
        grants: [{permissionKey: "tasks:assign", scope: null}],
      },
    },
    probe: {method: "GET", status: 403, error: "Missing permission: agents:create."},
    keyRevoked: true,
  });
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.mutations, {
    agentCreated: false,
    agentActivated: false,
    ephemeralAgentKeyCreatedAndRevoked: true,
  });
});

test("director authority fails on legacy CEO role, forbidden grants, or incomplete cleanup", () => {
  const policy = json("policies/director-authority.json");
  const result = evaluateDirectorAuthority({
    policy,
    agentDetail: {
      role: "ceo",
      permissions: {canCreateAgents: false},
      access: {
        canAssignTasks: true,
        taskAssignSource: "ceo_role",
        grants: [
          {permissionKey: "tasks:assign", scope: null},
          {permissionKey: "agents:create", scope: null},
        ],
      },
    },
    probe: {method: "GET", status: 200, error: ""},
    keyRevoked: false,
  });
  assert.equal(result.verdict, "fail");
  for (const violation of [
    "roleIsNonLegacyRoot",
    "taskAssignmentUsesExplicitGrant",
    "forbiddenGrantsAbsent",
    "agentCreationDenied",
    "denialNamesCapability",
    "ephemeralKeyRevoked",
  ]) assert.ok(result.violations.includes(violation), violation);
});

test("execution workspace contract is isolated, branch-only and requires a dedicated runtime boundary", () => {
  const contract = json("references/execution-workspace-contract.json");
  assert.equal(contract.status, "live_lifecycle_proved_execution_boundary_blocked");
  assert.equal(contract.implementationAgent, "senior-platform-engineer");
  assert.equal(contract.reviewAgent, "independent-code-reviewer");
  assert.equal(contract.workspacePolicy.defaultMode, "isolated_workspace");
  assert.equal(contract.workspacePolicy.allowIssueOverride, false);
  assert.deepEqual(contract.workspacePolicy.strategy, {
    type: "git_worktree",
    baseRef: "origin/main",
    branchTemplate: "{{issue.identifier}}-{{slug}}",
  });
  assert.deepEqual(
    contract.repositories.map((repository) => repository.slug),
    ["optiak/optiak", "optiak/optiak-frontend", "optiak/iac-infra"],
  );
  assert.equal(contract.globalPolicy.sharedCheckoutAllowed, false);
  assert.equal(contract.globalPolicy.nestedWorktreeAllowed, false);
  assert.equal(contract.globalPolicy.automaticMergeAllowed, false);
  assert.equal(contract.globalPolicy.automaticDeployAllowed, false);
  assert.equal(contract.globalPolicy.productionCredentialsAllowed, false);
  assert.equal(contract.globalPolicy.reviewerWriteAccessAllowed, false);
  assert.equal(contract.globalPolicy.sharedControlPlanePrivilegeRelaxationAllowed, false);
  assert.equal(contract.runtimeBoundaryPolicy.required, "dedicated_agent_execution_boundary");
  assert.equal(contract.runtimeBoundaryPolicy.requiredSandboxBackend, "bubblewrap");
  assert.equal(contract.runtimeBoundaryPolicy.controlPlaneSecurityRelaxationAllowed, false);
  assert.equal(contract.sanitizedLiveFinding.workspaceLifecycle, "pass");
  assert.equal(contract.sanitizedLiveFinding.agentGitInspection, "blocked");
  assert.equal(contract.sanitizedLiveFinding.diagnosticProbeAuthorizesLiveExecution, false);
});

test("sandbox migration remains deferred with Daytona disabled and no implementation authority", () => {
  const compatibility = json("runtime/compatibility.lock.json");
  const boundary = compatibility.targetExecutionBoundary;
  assert.equal(compatibility.packageVersion, "0.1.29");
  assert.equal(boundary.providerKind, "sandbox_provider");
  assert.equal(boundary.providerKey, "daytona");
  assert.equal(boundary.pluginManifestVersion, "0.1.7");
  assert.equal(boundary.migrationDecision, "deferred_read_only_phase");
  assert.equal(boundary.livePluginState, "disabled");
  assert.equal(boundary.environmentManagementEnabled, false);
  assert.equal(boundary.savedEnvironmentState, "not_created");
  assert.equal(boundary.initialAdapter, "codex_local");
  assert.equal(boundary.initialAgent, "senior-platform-engineer");
  assert.equal(boundary.initialAgentCount, 1);
  assert.equal(boundary.nativeRunnerEnabled, false);
  assert.equal(boundary.providerCredentialMayEnterGit, false);
  assert.equal(boundary.controlPlaneSecurityRelaxed, false);
  assert.equal(boundary.authorizesAgentActivation, false);
  assert.equal(boundary.authorizesImplementationWorkspace, false);
});

test("execution workspace evaluator fails closed and never treats fixtures as live proof", () => {
  const contract = json("references/execution-workspace-contract.json");
  const fixture = json("references/fixtures/execution-workspace-readiness.json");
  assert.equal(fixture.evidenceScope, "fixture_only");

  for (const fixtureCase of fixture.cases) {
    const result = evaluateExecutionWorkspace(contract, fixtureCase.evidence);
    assert.equal(result.verdict, fixtureCase.expectedVerdict, fixtureCase.id);
    if (fixtureCase.expectedBlocker) {
      assert.ok(result.blockers.includes(fixtureCase.expectedBlocker), fixtureCase.id);
    }
    assert.equal(result.authority, "advice_only_board_retains_activation_merge_and_deploy_decisions");
  }
});
