import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  validateResultEnvelope,
  validateResultEnvelopes,
} from "../scripts/validate-result-envelopes.mjs";
import {
  classifySandboxProbe,
  evaluateStaticCompatibility,
} from "../scripts/check-sandbox-compat.mjs";
import {
  isExactLoopbackUrl,
  summarizeLiveProbe,
  validateTestEnvironmentContract,
} from "../scripts/probe-test-environment.mjs";
import {
  candidateFingerprint,
  evaluatePromotionEvidence,
  loadPromotionContract,
  requiredPromotionGates,
} from "../scripts/evaluate-promotion-readiness.mjs";
import {
  evaluatePrdReadiness,
  loadPrdReadinessContract,
} from "../scripts/evaluate-prd-readiness.mjs";
import {
  evaluatePostmortem,
  loadPostmortemContract,
} from "../scripts/evaluate-postmortem.mjs";
import {
  evaluateProductAdvisory,
  loadProductAdvisoryContract,
} from "../skills/optiak-product-triage/scripts/evaluate-product-advisory.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(skill, name) {
  const path = join(packageDir, "skills", skill, "references", "fixtures", `${name}.md`);
  const markdown = readFileSync(path, "utf8");
  const fencedJson = markdown.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(fencedJson, `${skill}/${name}.md has no fenced JSON object`);
  return JSON.parse(fencedJson[1]);
}

test("every skill ships a CLI-portable offline fixture", () => {
  const skills = readdirSync(join(packageDir, "skills"));
  assert.equal(skills.length, 16);
  for (const skill of skills) {
    const fixtures = readdirSync(join(packageDir, "skills", skill, "references", "fixtures"))
      .filter((path) => path.endsWith(".md"));
    assert.ok(fixtures.length > 0, `${skill} has no fixture`);
    for (const path of fixtures) {
      const name = path.slice(0, -3);
      assert.doesNotThrow(() => fixture(skill, name));
    }
  }
});

test("change control fails closed by risk", () => {
  const data = fixture("optiak-change-control", "actions");
  assert.deepEqual(data.cases.map((item) => item.expectedLevel), ["green", "yellow", "orange", "red"]);
});

test("PR fixture requires independent changes", () => {
  const data = fixture("optiak-pr-review", "pr");
  assert.notEqual(data.author, data.reviewer);
  assert.equal(data.expectedVerdict, "request_changes");
  assert.ok(data.headRevision.startsWith("fixture-"));
  assert.equal(data.evidenceMode, "remote_mcp");
  assert.equal(data.commandsRunByReviewer.length, 0);
  assert.equal(data.worktreeCreatedByReviewer, false);
});

test("frontend implementation requires a Paperclip-owned isolated workspace", () => {
  const data = fixture("optiak-frontend-implementation", "frontend-change");
  assert.equal(data.evidenceScope, "fixture_only");
  assert.equal(data.repository, "optiak/optiak-frontend");
  assert.deepEqual(data.workspace, {
    providedBy: "paperclip",
    mode: "isolated_workspace",
    strategy: "git_worktree",
    writable: true,
  });
  assert.equal(data.expectedDisposition, "ready_for_independent_review");
  assert.deepEqual(data.expectedHandoffs, [
    "independent-code-reviewer",
    "qa-e2e-validation-engineer",
    "brand-ui-quality-reviewer",
  ]);
  assert.ok(data.forbiddenActions.includes("create_nested_worktree"));
  assert.ok(data.forbiddenActions.includes("merge"));
  assert.ok(data.forbiddenActions.includes("deploy"));

  const assignedAgents = readdirSync(join(packageDir, "agents")).filter((agent) =>
    readFileSync(join(packageDir, "agents", agent, "AGENTS.md"), "utf8")
      .includes("  - optiak-frontend-implementation"),
  );
  assert.deepEqual(assignedAgents, ["senior-platform-engineer"]);
});

test("incident fixture cannot imply a production incident", () => {
  const data = fixture("optiak-incident-triage", "alert");
  assert.equal(data.environment, "staging");
  assert.equal(data.productionImpact, false);
  assert.equal(data.expectedSeverity, "SEV3");
});

test("observability contract is offline, bounded, redacted, and fail-closed", () => {
  const contract = JSON.parse(readFileSync(
    join(
      packageDir,
      "skills",
      "optiak-incident-triage",
      "references",
      "observability-source-contract.json",
    ),
    "utf8",
  ));
  assert.equal(contract.schema, "optiak-observability-source-contract/v1");
  assert.equal(contract.status, "offline_contract_defined_connections_disconnected");
  assert.equal(contract.globalPolicy.defaultDecision, "deny");
  assert.equal(contract.globalPolicy.missingOrStaleSignal, "unknown_not_healthy");
  assert.equal(contract.globalPolicy.noConnectedAlertIngress, "no_automatic_oncall_coverage");
  assert.equal(contract.initialTriageEnvelope.initialQueryWindowMinutes, 15);
  assert.equal(contract.initialTriageEnvelope.maximumApplicationsPerQuery, 1);
  assert.equal(contract.initialTriageEnvelope.maximumExactTracesPerApproval, 1);
  assert.equal(contract.correlation.timestampOnlyCorrelation, "deny");
  assert.equal(contract.redaction.default, "omit");
  assert.ok(contract.redaction.neverReturn.includes("prompt_or_request_bodies"));
  assert.ok(contract.redaction.neverReturn.includes("session_replays"));

  const sources = new Map(contract.sources.map((source) => [source.id, source]));
  assert.equal(sources.get("optiak_admin_aggregate_analytics").initialSource, true);
  assert.equal(sources.get("tempo_exact_trace").maximumResults, 1);
  assert.equal(sources.get("raw_events_api").decision, "deny");
  assert.equal(sources.get("application_logs").decision, "deny");
  assert.match(
    sources.get("service_health_endpoints").limitations.join(" "),
    /do not prove database, provider, telemetry, or inference readiness/,
  );
  assert.equal(contract.alertRouting.status, "disconnected");
  assert.equal(contract.alertRouting.automaticWakeAllowed, false);
  assert.ok(contract.activationGates.some((gate) => gate.includes("exactly one auditable wake")));
});

test("observability fixture separates fresh, partial, stale, and disconnected evidence", () => {
  const data = fixture("optiak-incident-triage", "observability");
  assert.deepEqual(
    data.cases.map((item) => item.expectedDecision),
    [
      "triage_allowed_not_resolution",
      "blocked_on_deployment_correlation",
      "unknown_not_healthy",
      "no_automatic_oncall_coverage",
    ],
  );
});

test("disconnected E2E fixture remains blocked", () => {
  const data = fixture("optiak-e2e-validation", "journey");
  assert.equal(data.environment, "fixture");
  assert.equal(data.expectedResultWithoutConnection, "blocked");
  assert.equal(data.mutationLevel, "yellow");
});

test("test environment fails closed while local reachability is incomplete", () => {
  const contract = JSON.parse(readFileSync(
    join(
      packageDir,
      "skills",
      "optiak-e2e-validation",
      "references",
      "test-environment-contract.json",
    ),
    "utf8",
  ));
  assert.deepEqual(validateTestEnvironmentContract(contract), []);
  assert.equal(contract.targets.localDevelopment.browser.state, "disconnected");
  assert.equal(contract.targets.localDevelopment.tenant.state, "unclassified");
  assert.equal(contract.targets.staging.authorizationState, "disconnected");
  assert.equal(contract.targets.production.authorizationState, "deny");
  assert.equal(contract.targets.production.networkRequests, "deny");
  assert.equal(contract.providerBudget.authorizationState, "proposed_pending_board_approval");
  assert.equal(contract.providerBudget.maximumProviderSpendPerSmoke, 1);
  assert.equal(contract.providerBudget.maximumInferenceRequests, 12);
  assert.equal(contract.providerBudget.automaticRetries, 0);
  assert.equal(contract.syntheticData.configuredCredentialLifetimeHours, 168);
  assert.equal(contract.syntheticData.revokeEveryCredentialAtRunEnd, true);
  assert.equal(
    contract.syntheticData.applicationRetention.boardApprovedReusableFixture,
    "retain_allowed",
  );

  const observations = contract.targets.localDevelopment.endpoints.map((endpoint) => ({
    id: endpoint.id,
    httpStatus: endpoint.id === "gateway-health" ? null : endpoint.expectedHttpStatuses[0],
    errorClass: endpoint.id === "gateway-health" ? "connection_failed" : null,
  }));
  const result = summarizeLiveProbe(contract, observations);
  assert.equal(result.readiness.uiReachable, true);
  assert.equal(result.readiness.adminReady, true);
  assert.equal(result.readiness.gatewayReady, false);
  assert.equal(result.readiness.authenticatedJourneysAllowed, false);
  assert.equal(result.readiness.syntheticWritesAllowed, false);
  assert.equal(result.readiness.productionAllowed, false);
});

test("test environment probe accepts only credential-free loopback targets", () => {
  assert.equal(isExactLoopbackUrl("http://localhost:3000"), true);
  assert.equal(isExactLoopbackUrl("http://127.0.0.1:8080/health"), true);
  assert.equal(isExactLoopbackUrl("https://localhost:3000"), false);
  assert.equal(isExactLoopbackUrl("http://unexpected-user@localhost:3000"), false);
  assert.equal(isExactLoopbackUrl("http://localhost.example.com:3000"), false);
  assert.equal(isExactLoopbackUrl("https://api.optiak.dev/v1"), false);
});

test("golden journey matrix is bounded and ends in verified cleanup", () => {
  const matrix = JSON.parse(readFileSync(
    join(
      packageDir,
      "skills",
      "optiak-e2e-validation",
      "references",
      "golden-journey-matrix.json",
    ),
    "utf8",
  ));
  assert.equal(matrix.schema, "optiak-golden-journey-matrix/v1");
  assert.equal(matrix.journeys.length, 13);
  assert.equal(new Set(matrix.journeys.map((journey) => journey.id)).size, 13);
  assert.equal(matrix.initialSmokeBudget.plannedInferenceRequests, 4);
  assert.equal(matrix.initialSmokeBudget.maximumInferenceRequests, 12);
  assert.equal(matrix.initialSmokeBudget.maximumOutputTokensPerRequest, 128);
  assert.equal(matrix.initialSmokeBudget.automaticRetries, 0);
  assert.equal(matrix.journeys.at(-1).id, "credential-revocation-and-cleanup");
  assert.ok(matrix.journeys.every((journey) => /blocked|not_tested/.test(journey.currentState)));
  assert.ok(matrix.journeys.every((journey) => journey.cleanup));
});

test("docs fixture does not invent live authority", () => {
  const data = fixture("optiak-docs-drift", "claims");
  assert.equal(data.claims[0].authorityConnected, false);
  assert.equal(data.claims[0].expectedClassification, "blocked_on_authority");
});

test("release evidence with missing gates is not ready", () => {
  const data = fixture("optiak-release-readiness", "release");
  assert.equal(data.gates.stagingE2E, "missing");
  assert.equal(data.expectedVerdict, "not_ready");
});

function materializePromotionEvidence(contract, promotionFixture, fixtureCase) {
  const required = requiredPromotionGates(
    contract,
    fixtureCase.targetEnvironment,
    fixtureCase.requestedStage,
  );
  return {
    schema: "optiak-ai-os-promotion-evidence/v1",
    evidenceScope: "fixture_only",
    targetEnvironment: fixtureCase.targetEnvironment,
    sourceEnvironment: fixtureCase.sourceEnvironment,
    requestedStage: fixtureCase.requestedStage,
    candidate: promotionFixture.candidate,
    gateResults: required.map((gate) => {
      const status = fixtureCase.gateOverrides[gate.id]
        ?? fixtureCase.defaultRequiredGateStatus;
      return {
        gateId: gate.id,
        status,
        evidenceRefs: status === "pass" ? [`fixture://${fixtureCase.id}/${gate.id}`] : [],
        checkedAt: "2026-09-03T00:00:00.000Z",
      };
    }),
  };
}

test("AI OS promotion contract is provider-neutral, staged, and advice-only", () => {
  const contract = loadPromotionContract();
  assert.equal(contract.schema, "optiak-ai-os-promotion-contract/v1");
  assert.equal(contract.packageVersion, "0.1.26");
  assert.equal(contract.status, "offline_defined_not_deployed");
  assert.equal(contract.providerPolicy.infrastructureProvider, "undecided");
  assert.equal(contract.environmentPolicy.directLocalToProduction, "deny");
  assert.deepEqual(contract.environmentPolicy.requiredEvidenceScopes, {
    preproduction: "connected_non_production",
    production: "production",
  });
  assert.deepEqual(contract.stageOrder, [
    "paused_import",
    "limited_agent_activation",
    "routine_activation",
  ]);
  assert.equal(contract.gates.length, 22);
  assert.equal(new Set(contract.gates.map((gate) => gate.id)).size, 22);
  assert.equal(requiredPromotionGates(contract, "preproduction", "paused_import").length, 11);
  assert.equal(requiredPromotionGates(contract, "production", "paused_import").length, 14);
  assert.ok(contract.completeBackupSet.some((item) => item.includes("attachments_and_artifacts")));
  assert.ok(contract.completeBackupSet.some((item) => item.includes("workspace_data")));
  assert.ok(contract.completeBackupSet.some((item) => item.includes("master_key")));
  assert.equal(contract.executionPolicy.evaluatorMayDeploy, false);
  assert.equal(contract.executionPolicy.agentMayDeploy, false);
  assert.equal(contract.executionPolicy.agentMayRollback, false);
  assert.equal(contract.executionPolicy.agentMayActivateAgentOrRoutine, false);
  assert.equal(contract.executionPolicy.boardDecisionRequiredForEveryStage, true);
});

test("promotion evaluator handles every synthetic fixture case without authorizing execution", () => {
  const contract = loadPromotionContract();
  const promotionFixture = fixture("optiak-release-readiness", "promotion");
  assert.equal(promotionFixture.schema, "optiak-ai-os-promotion-fixture/v1");
  for (const fixtureCase of promotionFixture.cases) {
    const evidence = materializePromotionEvidence(contract, promotionFixture, fixtureCase);
    const result = evaluatePromotionEvidence(evidence, contract);
    assert.equal(result.verdict, fixtureCase.expectedVerdict, fixtureCase.id);
    assert.equal(result.doesNotAuthorizeExecution, true, fixtureCase.id);
    assert.match(result.candidateFingerprint, /^[0-9a-f]{64}$/);
  }
});

test("promotion evaluator fingerprints exact candidates and rejects unsupported evidence", () => {
  const contract = loadPromotionContract();
  const promotionFixture = fixture("optiak-release-readiness", "promotion");
  const fixtureCase = promotionFixture.cases.find(
    (item) => item.id === "synthetic-preproduction-gates-only",
  );
  const evidence = materializePromotionEvidence(contract, promotionFixture, fixtureCase);
  const firstFingerprint = candidateFingerprint(evidence.candidate);
  const secondFingerprint = candidateFingerprint(structuredClone(evidence.candidate));
  assert.equal(firstFingerprint, secondFingerprint);
  assert.match(firstFingerprint, /^[0-9a-f]{64}$/);

  evidence.gateResults[0].evidenceRefs = [];
  assert.throws(
    () => evaluatePromotionEvidence(evidence, contract),
    /requires an evidence reference/,
  );
});

test("promotion evaluator requires environment-appropriate evidence before Board readiness", () => {
  const contract = loadPromotionContract();
  const promotionFixture = fixture("optiak-release-readiness", "promotion");
  const fixtureCase = promotionFixture.cases.find(
    (item) => item.id === "synthetic-preproduction-gates-only",
  );
  const evidence = materializePromotionEvidence(contract, promotionFixture, fixtureCase);

  const fixtureResult = evaluatePromotionEvidence(evidence, contract);
  assert.equal(fixtureResult.verdict, "blocked_on_evidence");
  assert.equal(fixtureResult.evidenceScopeEligible, false);

  evidence.evidenceScope = "connected_non_production";
  evidence.gateResults = evidence.gateResults.map((result) => ({
    ...result,
    evidenceRefs: result.evidenceRefs.map((reference) => reference.replace("fixture://", "evidence://")),
  }));
  const connectedResult = evaluatePromotionEvidence(evidence, contract);
  assert.equal(connectedResult.verdict, "ready_for_board_decision");
  assert.equal(connectedResult.evidenceScopeEligible, true);
  assert.equal(connectedResult.doesNotAuthorizeExecution, true);
});

test("durable completion closes once from memory with run-linked time provenance", () => {
  const data = fixture("optiak-durable-completion", "completion");
  assert.equal(data.issue.initialStatus, "in_progress");
  assert.equal(data.issue.expectedStatus, "done");
  assert.equal(data.expected.payloadStorage, "memory");
  assert.equal(data.expected.dispositionRequests, 1);
  assert.equal(data.expected.standaloneReportPosts, 0);
  assert.equal(data.expected.reportsCreated, 1);
  assert.equal(data.expected.statusTransitionsRequested, 1);
  assert.equal(data.expected.createdByRunId, data.run.id);
  assert.equal(data.expected.executionTimestampSource, "paperclip_comment_metadata");
  assert.equal(data.expected.ambiguousWritePolicy, "refetch_before_retry");
});

test("result taxonomy keeps one canonical object review and preserves superseded prerequisite history", () => {
  const data = fixture("optiak-durable-completion", "result-set");
  const results = validateResultEnvelopes(data.results);
  const canonical = results.filter((entry) => entry.report.canonical);
  assert.equal(canonical.length, data.expected.canonicalReportCount);
  assert.equal(canonical[0].report.reportRef, data.expected.canonicalReportRef);
  assert.equal(canonical[0].report.runRef, data.expected.canonicalRunRef);
  assert.equal(canonical[0].paperclip.issueDisposition, data.expected.canonicalIssueDisposition);
  assert.equal(canonical[0].object.verdict, data.expected.canonicalObjectVerdict);
  assert.equal(canonical[0].operations.readiness, data.expected.canonicalOperationalReadiness);
  assert.equal(results.filter((entry) => entry.report.state === "superseded").length, data.expected.supersededReportCount);
  assert.ok(results.filter((entry) => entry.report.state === "superseded")
    .every((entry) => entry.report.supersededBy === data.expected.canonicalReportRef));
});

test("ambiguous aggregate states and duplicate canonical results fail closed", () => {
  const data = fixture("optiak-durable-completion", "result-set");
  for (const invalid of data.invalidAggregates) {
    assert.throws(() => validateResultEnvelope(invalid), /ambiguous or unsupported top-level result fields/);
  }

  const duplicateRun = structuredClone(data.results[0]);
  duplicateRun.report.reportRef = "fixture-report-duplicate-run";
  duplicateRun.object.revision = "sample-2";
  assert.throws(
    () => validateResultEnvelopes([...data.results, duplicateRun]),
    /more than one canonical report for run/,
  );

  const duplicateTarget = structuredClone(data.results[0]);
  duplicateTarget.report.runRef = "fixture-run-duplicate-target";
  duplicateTarget.report.reportRef = "fixture-report-duplicate-target";
  assert.throws(
    () => validateResultEnvelopes([...data.results, duplicateTarget]),
    /more than one canonical report for the same object revision and review kind/,
  );
});

test("every agent is assigned the durable completion contract", () => {
  const agentRoot = join(packageDir, "agents");
  const agents = readdirSync(agentRoot);
  assert.equal(agents.length, 10);
  for (const agent of agents) {
    const markdown = readFileSync(join(agentRoot, agent, "AGENTS.md"), "utf8");
    assert.match(markdown, /^  - optiak-durable-completion$/m, `${agent} is missing durable completion`);
  }
});

test("every agent carries the governed Notion retrieval contract", () => {
  const agentRoot = join(packageDir, "agents");
  const agents = readdirSync(agentRoot);
  assert.equal(agents.length, 10);
  for (const agent of agents) {
    const markdown = readFileSync(join(agentRoot, agent, "AGENTS.md"), "utf8");
    assert.match(markdown, /^  - optiak-notion-knowledge$/m, `${agent} is missing Notion knowledge`);
  }
});

test("Notion knowledge is role-scoped, read-only, and fail-closed", () => {
  const authority = readFileSync(
    join(packageDir, "skills", "optiak-notion-knowledge", "references", "notion-authority.yaml"),
    "utf8",
  );
  assert.match(authority, /status: connected_policy_smoke_passed_root_registry_pending/);
  assert.match(authority, /endpoint: https:\/\/mcp\.notion\.com\/mcp/);
  assert.match(authority, /authentication: oauth_dcr_pkce/);
  assert.match(authority, /wholeWorkspaceExport: deny/);
  assert.match(authority, /mutations: deny/);
  assert.match(authority, /consentPageSelectionObserved: false/);
  assert.match(authority, /logicalRootsAreHardBoundary: false/);
  assert.match(authority, /- finance/);
  assert.match(authority, /- board-private/);
  assert.equal((authority.match(/^  [a-z][a-z0-9-]+:\n    roots:/gm) || []).length, 10);

  const policy = readFileSync(join(packageDir, "policies", "notion-readonly.yaml"), "utf8");
  assert.match(policy, /defaultAction: deny/);
  assert.match(policy, /quarantineNewEntries: true/);
  assert.match(policy, /consentPageSelectionAvailable: false/);
  assert.match(policy, /oauthAloneProvesRootIsolation: false/);
  assert.match(policy, /allowed: 3\n    askFirst: 0\n    off: 42/);
  assert.match(policy, /wholeWorkspaceSearch: deny/);
  assert.match(policy, /approvalMayOverride: false/);
  assert.match(policy, /trustRules: deny/);

  const data = fixture("optiak-notion-knowledge", "authority-cases");
  assert.deepEqual(
    data.cases.map((item) => item.expectedDisposition),
    [
      "read_allowed",
      "blocked_on_authority",
      "denied_mutation",
      "blocked_on_connection",
      "report_authority_conflict",
    ],
  );
});

test("source map selects approved authorities without pretending GitHub is live", () => {
  const sourceMap = readFileSync(join(packageDir, "references", "source-map.yaml"), "utf8");
  assert.equal((sourceMap.match(/status: disconnected/g) || []).length, 4);
  assert.match(sourceMap, /wholeSiteSnapshotsAllowed: false/);
  assert.match(sourceMap, /status: authorized_pending_connection/);
  assert.match(sourceMap, /https:\/\/mcp\.linear\.app\/mcp\/readonly/);
  assert.match(sourceMap, /https:\/\/api\.githubcopilot\.com\/mcp\/readonly/);
  assert.match(sourceMap, /optiak\/optiak-frontend/);
  assert.match(sourceMap, /productEngineeringOperatingModelRef: references\/product-engineering-operating-model\.json/);
  assert.match(sourceMap, /systemRepositoryRegisterRef: references\/system-repository-register\.yaml/);
  assert.match(sourceMap, /engineeringHandbookIndexRef: references\/engineering-handbook-index\.md/);
  assert.match(sourceMap, /notionKnowledgeAuthorityRef: skills\/optiak-notion-knowledge\/references\/notion-authority\.yaml/);
  assert.match(sourceMap, /id: notion-product-engineering-knowledge/);
  assert.match(sourceMap, /status: connected_policy_smoke_passed_root_registry_pending/);
  assert.match(sourceMap, /https:\/\/mcp\.notion\.com\/mcp/);
});

test("product authority is field-specific, fresh, bounded, and read-only", () => {
  const authority = readFileSync(
    join(packageDir, "skills", "optiak-product-triage", "references", "product-authority.yaml"),
    "utf8",
  );
  assert.match(authority, /humanConflictOwner: board/);
  assert.match(authority, /teamKey: OPT/);
  assert.match(authority, /writeToolsAllowed: false/);
  assert.match(authority, /maximumAgeMinutesForCurrentClaim: 15/);
  assert.match(authority, /copyWholeBacklog: false/);
  assert.match(authority, /priorityRanking: deny/);
  assert.match(authority, /recommendationRequiresExactDetailRead: true/);
  assert.match(authority, /separateMachineEnvelope: true/);

  const conflicts = fixture("optiak-product-triage", "authority-conflicts");
  assert.deepEqual(
    conflicts.cases.map((item) => item.expectedAuthority),
    [
      "explicit_board_decision",
      "release_and_deployment_evidence",
      "exact_versioned_api_contract",
      "approved_customer_evidence_source",
    ],
  );
});

test("product advisory contract turns OPT-39 feedback into fail-closed review gates", () => {
  const contract = loadProductAdvisoryContract();
  assert.equal(contract.schema, "optiak-product-advisory-contract/v1");
  assert.equal(contract.status, "offline_defined_read_only_advisory");
  assert.equal(contract.sourceReview.paperclipIssue, "OPT-39");
  assert.equal(contract.sourceReview.historicalEvidenceOnly, true);
  assert.equal(contract.authority.strategyRequiredForPriorityRecommendation, true);
  assert.equal(contract.authority.linearUpdatedAtProvesPriority, false);
  assert.equal(contract.authority.listResultSupportsSemanticRecommendation, false);
  assert.equal(contract.recommendations.maximum, 3);
  assert.equal(contract.recommendations.detailReadRequired, true);
  assert.equal(contract.humanOutput.maximumWords, 700);
  assert.equal(contract.humanOutput.maximumExecutiveSummaryLines, 5);
  assert.equal(contract.humanOutput.machineEnvelope, "separate_from_human_report");
  assert.equal(contract.efficiency.uncachedInputTokens.targetMaximum, 25000);
  assert.equal(contract.efficiency.uncachedInputTokens.reviewMaximum, 40000);
  assert.equal(contract.permissions.linearWrites, false);
  assert.equal(contract.permissions.codeChanges, false);
});

test("product advisory evaluator covers strategy, depth, output and efficiency regressions", () => {
  const data = fixture("optiak-product-triage", "advisory-cases");
  assert.equal(data.cases.length, 5);
  for (const fixtureCase of data.cases) {
    const result = evaluateProductAdvisory(fixtureCase.evidence);
    assert.equal(result.verdict, fixtureCase.expectedVerdict, fixtureCase.id);
    assert.equal(result.doesNotAuthorizeLinearWrites, true);
    assert.equal(result.doesNotAuthorizeImplementation, true);
  }

  const byId = new Map(data.cases.map((item) => [item.id, item]));
  const blocked = evaluateProductAdvisory(byId.get("strategy-missing-updated-at-ranking").evidence);
  assert.ok(blocked.strategyBlockers.includes("priority_review_requires_current_strategy_authority"));
  assert.ok(blocked.strategyBlockers.includes("updated_at_only_cannot_support_priority_review"));
  assert.ok(blocked.strategyBlockers.includes("bounded_sample_cannot_claim_global_priority"));

  const shallow = evaluateProductAdvisory(byId.get("list-only-recommendation").evidence);
  assert.ok(shallow.structuralViolations.includes("detail_read_required:OPT-FIXTURE-2"));

  const inefficient = evaluateProductAdvisory(byId.get("opt39-efficiency-regression").evidence);
  assert.deepEqual(inefficient.efficiencyRegressions, [
    "uncachedInputTokens_over_review_maximum",
    "outputTokens_over_review_maximum",
    "durationSeconds_over_review_maximum",
  ]);

  const inline = evaluateProductAdvisory(byId.get("inline-machine-envelope").evidence);
  assert.ok(inline.structuralViolations.includes("machine_envelope_must_be_separate"));
});

test("OPT-39 feedback is historical, mutation-free and dispositioned", () => {
  const feedback = fixture("optiak-product-triage", "opt-39-feedback");
  assert.equal(feedback.sourceIssue, "OPT-39");
  assert.equal(feedback.historicalOnly, true);
  assert.equal(feedback.linearMutations, 0);
  assert.equal(feedback.agentActivations, 0);
  assert.equal(feedback.improvements.length, 6);
  assert.deepEqual(
    feedback.decisionDispositions.map((decision) => decision.disposition),
    ["hypothesis_pending_current_strategy", "provisional_principle", "accepted_architecture_principle"],
  );
});

test("repository authority limits GitHub to three repositories and one read-only reviewer", () => {
  const authority = readFileSync(
    join(packageDir, "skills", "optiak-pr-review", "references", "repository-authority.yaml"),
    "utf8",
  );
  assert.match(authority, /endpoint: https:\/\/api\.githubcopilot\.com\/mcp\/readonly/);
  assert.match(authority, /authentication: fine_grained_personal_access_token/);
  assert.match(authority, /maximumCredentialLifetimeDays: 30/);
  assert.match(authority, /- independent-code-reviewer/);
  assert.equal((authority.match(/^    - slug: optiak\//gm) || []).length, 3);
  assert.match(authority, /- slug: optiak\/optiak$/m);
  assert.match(authority, /- slug: optiak\/optiak-frontend$/m);
  assert.match(authority, /- slug: optiak\/iac-infra$/m);
  assert.match(authority, /- optiak\/optiak-tests$/m);
  assert.match(authority, /defaultDecision: deny/);
  assert.match(authority, /writeToolsAllowed: false/);
  assert.match(authority, /fine_grained_pat_does_not_support_checks_api/);
  assert.match(authority, /blocked_on_evidence_when_required_ci_result_is_only_a_check_run/);
  assert.doesNotMatch(authority, /^    checks: read$/m);
  assert.match(authority, /recheckHeadBeforeVerdict: true/);
  assert.match(authority, /cloneWholeOrganization: false/);

  const desiredState = readFileSync(join(packageDir, "policies", "desired-state.yaml"), "utf8");
  assert.match(desiredState, /connectionMethod: generic_mcp_custom_headers/);
  assert.match(desiredState, /quarantineNewEntries: true/);
  assert.match(desiredState, /missingOwnerAndRepoDuringDiscovery: require_approval/);
  assert.match(desiredState, /exactApprovedRepository: allow_for_independent_reviewer/);
  assert.match(desiredState, /fallback: deny/);
  const enabledReadToolsBlock = desiredState.match(
    /    enabledReadTools:\n(?<tools>(?:      - [a-z_]+\n)+)/,
  )?.groups?.tools;
  const disabledBroadToolsBlock = desiredState.match(
    /    disabledBroadTools:\n(?<tools>(?:      - [a-z_]+\n)+)/,
  )?.groups?.tools;
  assert.equal(
    enabledReadToolsBlock?.match(/^      - [a-z_]+$/gm)?.length,
    14,
    "expected fourteen enabled repository reads",
  );
  assert.equal(
    disabledBroadToolsBlock?.match(/^      - [a-z_]+$/gm)?.length,
    5,
    "expected five disabled broad tools",
  );

  const connectionRunbook = readFileSync(join(packageDir, "runbooks", "connections.md"), "utf8");
  assert.match(connectionRunbook, /Advanced authentication → Custom headers/);
  assert.match(connectionRunbook, /Authorization: Bearer <fine-grained PAT>/);
  assert.match(connectionRunbook, /priority 39:[\s\S]*requires approval/);
  assert.match(connectionRunbook, /priority 40:[\s\S]*allow only Independent Reviewer/);
  assert.match(connectionRunbook, /priority 50:[\s\S]*block every remaining call/);
  assert.match(connectionRunbook, /search_repositories` off/);

  const allowlist = readFileSync(join(packageDir, "policies", "tool-allowlist.yaml"), "utf8");
  assert.match(allowlist, /repository_exactly_one_of_optiak_optiak_frontend_or_iac_infra/);
});

test("architecture authority is domain-specific and fails closed", () => {
  const authority = JSON.parse(readFileSync(
    join(
      packageDir,
      "skills",
      "optiak-architecture-review",
      "references",
      "architecture-authority-map.json",
    ),
    "utf8",
  ));
  assert.equal(authority.schema, "optiak-architecture-authority-map/v1");
  assert.equal(authority.status, "offline_defined_sources_not_assumed_connected");
  assert.equal(authority.globalPolicy.defaultDecision, "blocked_on_authority");
  assert.equal(authority.globalPolicy.publicDocsProveImplementation, false);
  assert.equal(authority.globalPolicy.sourceCodeProvesDeployment, false);
  assert.equal(authority.globalPolicy.healthEndpointProvesReadiness, false);
  assert.equal(authority.sourceClasses.length, 8);
  assert.equal(authority.domains.length, 8);
  assert.equal(new Set(authority.domains.map((domain) => domain.id)).size, 8);

  const domains = new Map(authority.domains.map((domain) => [domain.id, domain]));
  assert.equal(
    domains.get("platform_boundary_and_product_ownership").owner,
    "product-prd-lead",
  );
  assert.equal(
    domains.get("deployed_topology_and_revision").unavailableBehavior,
    "deployment_state_unknown",
  );

  const claims = fixture("optiak-architecture-review", "authority-claims");
  assert.deepEqual(
    claims.cases.map((item) => item.expectedDecision),
    [
      "blocked_on_contract_authority",
      "deployment_state_unknown",
      "blocked_on_slo_or_runtime_evidence",
      "authority_sufficient_for_revision_scoped_review",
    ],
  );
});

test("documentation authority covers each approved page without creating a snapshot", () => {
  const authority = JSON.parse(readFileSync(
    join(
      packageDir,
      "skills",
      "optiak-docs-drift",
      "references",
      "documentation-authority-map.json",
    ),
    "utf8",
  ));
  assert.equal(authority.schema, "optiak-documentation-authority-map/v1");
  assert.equal(authority.status, "offline_defined_live_pages_remain_canonical");
  assert.equal(authority.globalPolicy.wholeSiteSnapshotsAllowed, false);
  assert.equal(authority.globalPolicy.publicPageProvesImplementation, false);
  assert.equal(authority.globalPolicy.publicPageProvesReleaseAvailability, false);
  assert.equal(authority.globalPolicy.documentationAgentMayPublish, false);
  assert.equal(authority.domains.length, 8);

  const sourceIds = authority.domains.flatMap((domain) => domain.sourceIds);
  assert.equal(sourceIds.length, 14);
  assert.equal(new Set(sourceIds).size, 14);
  assert.ok(authority.domains.every((domain) => domain.reviewCadence && domain.escalation));

  const cases = fixture("optiak-docs-drift", "authority-cases");
  assert.deepEqual(
    cases.cases.map((item) => item.expectedClassification),
    ["blocked_on_authority", "likely_drift", "confirmed_drift", "internally_inconsistent"],
  );
});

function materializePrdEvidence(contract, data, fixtureCase) {
  return {
    schema: "optiak-prd-readiness-evidence/v1",
    evidenceScope: "fixture_only",
    prd: data.prd,
    gateResults: contract.gates.map((gate) => {
      const status = fixtureCase.overrides[gate.id] ?? fixtureCase.defaultStatus;
      return {
        gateId: gate.id,
        status,
        evidenceRefs: status === "missing" ? [] : [`fixture://${fixtureCase.id}/${gate.id}`],
        ...(status === "not_applicable" ? {rationale: "Fixture asserts no affected surface."} : {}),
      };
    }),
  };
}

test("PRD readiness contract has complete cross-functional ownership", () => {
  const contract = loadPrdReadinessContract();
  assert.equal(contract.schema, "optiak-prd-readiness-contract/v1");
  assert.equal(contract.status, "offline_defined_no_product_decision_implied");
  assert.equal(contract.gates.length, 16);
  assert.equal(new Set(contract.gates.map((gate) => gate.id)).size, 16);
  assert.equal(contract.globalPolicy.readyVerdictAuthorizesImplementation, false);
  assert.equal(contract.globalPolicy.publicDocsOrBacklogCreateProductIntent, false);
  assert.deepEqual(
    new Set(contract.gates.map((gate) => gate.owner)),
    new Set([
      "product-prd-lead",
      "principal-platform-architect",
      "qa-e2e-validation-engineer",
      "brand-ui-quality-reviewer",
      "documentation-dx-steward",
      "engineering-assurance-lead",
      "reliability-incident-engineer",
    ]),
  );
});

test("PRD evaluator distinguishes ready, changes, and missing evidence", () => {
  const contract = loadPrdReadinessContract();
  const data = fixture("optiak-prd-review", "readiness-cases");
  for (const fixtureCase of data.cases) {
    const evidence = materializePrdEvidence(contract, data, fixtureCase);
    const result = evaluatePrdReadiness(evidence, contract);
    assert.equal(result.verdict, fixtureCase.expectedVerdict, fixtureCase.id);
    assert.equal(result.doesNotAuthorizeImplementation, true, fixtureCase.id);
  }
});

test("PRD evaluator rejects duplicate, unknown, and unsupported not-applicable gates", () => {
  const contract = loadPrdReadinessContract();
  const data = fixture("optiak-prd-review", "readiness-cases");
  const evidence = materializePrdEvidence(contract, data, data.cases[0]);

  evidence.gateResults.push(structuredClone(evidence.gateResults[0]));
  assert.throws(() => evaluatePrdReadiness(evidence, contract), /duplicate gate result/);
  evidence.gateResults.pop();

  evidence.gateResults[0].gateId = "unknown_gate";
  assert.throws(() => evaluatePrdReadiness(evidence, contract), /unknown gate/);
  evidence.gateResults[0].gateId = contract.gates[0].id;

  evidence.gateResults[0].status = "not_applicable";
  evidence.gateResults[0].rationale = "Synthetic rationale";
  assert.throws(() => evaluatePrdReadiness(evidence, contract), /cannot be not_applicable/);
});

function materializePostmortemCase(data, fixtureCase) {
  const evidence = structuredClone(data.baseEvidence);
  if (fixtureCase.mutation === "clear_impact_evidence") {
    evidence.impact.evidenceRefs = [];
  } else if (fixtureCase.mutation === "verified_root_cause_with_one_reference") {
    evidence.rootCause.status = "verified";
    evidence.rootCause.statement = "The synthetic timeout is declared as verified.";
    evidence.rootCause.evidenceRefs = ["fixture://incident/one-root-cause-reference"];
  } else if (fixtureCase.mutation === "mark_nonmaterial_sev3") {
    evidence.incident.severity = "SEV3";
    evidence.incident.material = false;
  }
  return evidence;
}

test("postmortem contract preserves blamelessness and human authority", () => {
  const contract = loadPostmortemContract();
  assert.equal(contract.schema, "optiak-postmortem-contract/v1");
  assert.equal(contract.status, "offline_defined_no_incident_or_action_implied");
  assert.deepEqual(contract.requirementPolicy.alwaysRequiredSeverities, ["SEV0", "SEV1"]);
  assert.equal(contract.blamelessPolicy.unknownRootCauseAllowed, true);
  assert.equal(contract.evidencePolicy.verifiedRootCauseMinimumIndependentRefs, 2);
  assert.equal(contract.correctiveActionPolicy.minimumDistinctTypesForMaterialIncident, 2);
  assert.equal(contract.reviewPolicy.boardOwnsRiskAcceptance, true);
  assert.equal(contract.executionPolicy.evaluatorMayExecuteCorrectiveAction, false);
  assert.equal(contract.executionPolicy.agentMayCloseIncident, false);
});

test("postmortem evaluator separates completeness, certainty, and requirement", () => {
  const contract = loadPostmortemContract();
  const data = fixture("optiak-incident-triage", "postmortem");
  for (const fixtureCase of data.cases) {
    const result = evaluatePostmortem(materializePostmortemCase(data, fixtureCase), contract);
    assert.equal(result.verdict, fixtureCase.expectedVerdict, fixtureCase.id);
    assert.equal(result.doesNotAuthorizeExecution, true, fixtureCase.id);
  }
});

test("postmortem evaluator rejects blame fields and self-review", () => {
  const contract = loadPostmortemContract();
  const data = fixture("optiak-incident-triage", "postmortem");
  const withBlame = structuredClone(data.baseEvidence);
  withBlame.rootCause.blame = "fixture-person";
  assert.throws(() => evaluatePostmortem(withBlame, contract), /prohibited blame field/);

  const selfReviewed = structuredClone(data.baseEvidence);
  selfReviewed.review.independentReviewer = selfReviewed.review.incidentOwner;
  const result = evaluatePostmortem(selfReviewed, contract);
  assert.equal(result.verdict, "changes_required");
  assert.ok(result.changeReasons.includes("independent_reviewer_must_differ_from_incident_owner"));
});

test("runtime defaults to paused, sandboxed, managed MCP", () => {
  const paperclip = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
  assert.equal((paperclip.match(/type: codex_local/g) || []).length, 10);
  assert.equal((paperclip.match(/dangerouslyBypassApprovalsAndSandbox: false/g) || []).length, 10);
  assert.equal((paperclip.match(/managedMcpOnly: true/g) || []).length, 10);
  assert.equal((paperclip.match(/enabled: false/g) || []).length, 14);
  assert.equal((paperclip.match(/timeoutSec: 300/g) || []).length, 10);
  assert.equal((paperclip.match(/maxDailyRuns: /g) || []).length, 10);
  assert.equal((paperclip.match(/maxDailyCostCents: /g) || []).length, 10);
  const budgets = [...paperclip.matchAll(/^    budgetMonthlyCents: (\d+)$/gm)]
    .map((match) => Number(match[1]));
  assert.equal(budgets.length, 10);
  assert.equal(budgets.reduce((total, value) => total + value, 0), 10000);
});

test("sandbox compatibility lock preserves the verified fallback without weakening the control plane", () => {
  const lock = JSON.parse(readFileSync(join(packageDir, "runtime", "compatibility.lock.json"), "utf8"));
  const paperclip = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
  const compose = readFileSync(join(packageDir, "runtime", "docker-compose.paperclip.yml"), "utf8");
  const result = evaluateStaticCompatibility({lock, paperclip, compose});

  assert.equal(result.contractValid, true, result.errors.join("; "));
  assert.equal(result.migrationState, "blocked");
  assert.equal(result.legacyFlagOccurrences, 10);

  const weakened = evaluateStaticCompatibility({
    lock,
    paperclip,
    compose: `${compose}\n    privileged: true\n`,
  });
  assert.equal(weakened.contractValid, false);
  assert.match(weakened.errors.join("; "), /privileged/);
});

test("sandbox probe distinguishes a verified fallback from a completed migration", () => {
  const blocked = classifySandboxProbe({
    legacyReadStatus: 0,
    legacyWriteStatus: 2,
    legacyWriteArtifact: false,
    modernReadStatus: 1,
    modernReadStderr: "bwrap: No permissions to create a new namespace",
    modernWriteStatus: 1,
    modernWriteArtifact: false,
  });
  assert.equal(blocked.currentFallbackVerified, true);
  assert.equal(blocked.migrationReady, false);
  assert.equal(blocked.observedState, "blocked");

  const ready = classifySandboxProbe({
    legacyReadStatus: 0,
    legacyWriteStatus: 2,
    legacyWriteArtifact: false,
    modernReadStatus: 0,
    modernReadStderr: "",
    modernWriteStatus: 2,
    modernWriteArtifact: false,
  });
  assert.equal(ready.modernSandboxVerified, true);
  assert.equal(ready.migrationReady, true);
  assert.equal(ready.observedState, "ready_for_live_regression");

  const unsafe = classifySandboxProbe({
    legacyReadStatus: 0,
    legacyWriteStatus: 0,
    legacyWriteArtifact: true,
    modernReadStatus: 1,
    modernReadStderr: "unknown failure",
    modernWriteStatus: 1,
    modernWriteArtifact: false,
  });
  assert.equal(unsafe.currentFallbackVerified, false);
  assert.equal(unsafe.observedState, "unsafe_or_unknown");
});

test("execution budget distinguishes enforced money and time gates from token review gates", () => {
  const policy = readFileSync(join(packageDir, "policies", "execution-budget.yaml"), "utf8");
  assert.match(policy, /currency: USD/);
  assert.match(policy, /monthlyBilledCents: 15000/);
  assert.match(policy, /warnPercent: 80/);
  assert.match(policy, /hardStopPercent: 100/);
  assert.match(policy, /timeoutSeconds: 300/);
  assert.match(policy, /basis: uncached_input_tokens/);
  assert.match(policy, /nativeEnforcement: false/);
  assert.match(policy, /unpricedBehavior: no_false_cost_signal/);
  assert.match(policy, /targetUncachedInputTokens: 25000/);
  assert.match(policy, /reviewMaximumUncachedInputTokens: 40000/);
  assert.match(policy, /overReviewMaximum: efficiency_regression/);
  assert.match(policy, /automaticRetryAllowed: false/);
});

test("run baseline keeps cumulative, cached, and uncached usage mathematically separate", () => {
  const baseline = JSON.parse(readFileSync(join(packageDir, "references", "run-efficiency-baseline.json"), "utf8"));
  assert.equal(baseline.summary.runCount, 17);
  assert.equal(
    baseline.summary.totals.rawInputTokens - baseline.summary.totals.cachedInputTokens,
    baseline.summary.totals.uncachedInputTokens,
  );
  assert.equal(
    baseline.directorSynthesis.rawInputTokens - baseline.directorSynthesis.cachedInputTokens,
    baseline.directorSynthesis.uncachedInputTokens,
  );
  assert.equal(baseline.summary.billingModes[0].costStatus, "unpriced");
  assert.equal(baseline.selection.containsDatabaseIds, false);
});

test("run usage summarizer excludes cancelled and zero-usage attempts", () => {
  const input = [
    {
      status: "succeeded",
      startedAt: "2026-09-02T10:00:00.000Z",
      finishedAt: "2026-09-02T10:01:00.000Z",
      usageJson: {
        rawInputTokens: 100,
        rawCachedInputTokens: 70,
        rawOutputTokens: 10,
        billingType: "subscription_included",
        costStatus: "unpriced",
      },
    },
    {
      status: "succeeded",
      startedAt: "2026-09-02T10:02:00.000Z",
      finishedAt: "2026-09-02T10:02:30.000Z",
      usageJson: {
        inputTokens: 50,
        cachedInputTokens: 20,
        outputTokens: 5,
        billingType: "metered_api",
        costStatus: "priced",
      },
    },
    {status: "cancelled", usageJson: {inputTokens: 999, cachedInputTokens: 0, outputTokens: 999}},
    {status: "succeeded", usageJson: {inputTokens: 0, cachedInputTokens: 0, outputTokens: 0}},
  ];
  const result = spawnSync(
    process.execPath,
    [join(packageDir, "scripts", "summarize-run-usage.mjs")],
    {input: JSON.stringify(input), encoding: "utf8"},
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.runCount, 2);
  assert.deepEqual(summary.totals, {
    rawInputTokens: 150,
    cachedInputTokens: 90,
    uncachedInputTokens: 60,
    outputTokens: 15,
    durationSeconds: 90,
  });
  assert.equal(summary.shares.cachedInputPercent, 60);
  assert.equal(summary.billingModes.length, 2);
});

test("local instance remains isolated behind host port 3200", () => {
  const override = readFileSync(join(packageDir, "runtime", "docker-compose.paperclip.yml"), "utf8");
  const helper = readFileSync(join(packageDir, "scripts", "local-instance.sh"), "utf8");

  assert.match(override, /PAPERCLIP_AUTH_BASE_URL_MODE:\s*"auto"/);
  assert.match(override, /BETTER_AUTH_TRUSTED_ORIGINS/);
  assert.match(override, /PAPERCLIP_INSTANCE_ID/);
  assert.match(override, /PAPERCLIP_API_URL:\s*"http:\/\/localhost:3100"/);
  assert.doesNotMatch(override, /PAPERCLIP_API_URL:\s*"http:\/\/localhost:3200"/);
  assert.match(override, /optiak/);
  assert.match(helper, /paperclip-optiak/);
  assert.match(helper, /docker-paperclip-optiak/);
  assert.match(helper, /OPTIAK_PAPERCLIP_PORT:-3200/);
  assert.doesNotMatch(helper, /enki-hogar|enki-connectors/);
});

test("Product and Engineering domains map to the existing organization without automatic hiring", () => {
  const model = JSON.parse(readFileSync(
    join(packageDir, "references", "product-engineering-operating-model.json"),
    "utf8",
  ));
  const agentSlugs = new Set(readdirSync(join(packageDir, "agents")));

  assert.equal(model.schema, "optiak-product-engineering-operating-model/v1");
  assert.equal(model.status, "offline_defined_no_runtime_authority");
  assert.equal(model.principles.oneAgentPerDomainRequired, false);
  assert.deepEqual(model.domains.map((domain) => domain.id), ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6"]);
  for (const domain of model.domains) {
    assert.ok(agentSlugs.has(domain.accountable), `${domain.id} has an unknown accountable owner`);
    for (const slug of [...domain.responsible, ...domain.reviewers]) {
      assert.ok(agentSlugs.has(slug), `${domain.id} references unknown agent ${slug}`);
    }
  }

  const dataQuality = model.domains.find((domain) => domain.id === "4.4");
  assert.equal(dataQuality.staffingStatus, "temporary_coverage_explicit_gap");
  assert.equal(dataQuality.accountable, "engineering-assurance-lead");
  assert.equal(dataQuality.candidateFutureRole, "data-platform-ai-quality-engineer");
  assert.equal(model.agentCreationGates.length, 7);
});

test("feature delivery keeps independent review and the release decision human", () => {
  const model = JSON.parse(readFileSync(
    join(packageDir, "references", "product-engineering-operating-model.json"),
    "utf8",
  ));
  assert.deepEqual(
    model.deliveryPipeline.map((stage) => stage.id),
    [
      "discovery",
      "product_decision",
      "prd",
      "architecture_review",
      "domain_implementation",
      "independent_review",
      "qa_ui_docs_validation",
      "release_readiness",
      "human_release_decision",
      "measurement_learning",
    ],
  );
  assert.equal(
    model.deliveryPipeline.find((stage) => stage.id === "independent_review").owner,
    "independent-code-reviewer",
  );
  assert.equal(
    model.deliveryPipeline.find((stage) => stage.id === "human_release_decision").owner,
    "board",
  );
  assert.equal(model.principles.authorMayApproveOwnChange, false);
  assert.equal(model.principles.successfulGateAuthorizesRelease, false);
});

test("routing fixtures cover all domains and never self-review an authored implementation", () => {
  const model = JSON.parse(readFileSync(
    join(packageDir, "references", "product-engineering-operating-model.json"),
    "utf8",
  ));
  const routing = JSON.parse(readFileSync(
    join(packageDir, "references", "fixtures", "product-engineering-routing.json"),
    "utf8",
  ));
  const agentSlugs = new Set(readdirSync(join(packageDir, "agents")));
  const domains = new Map(model.domains.map((domain) => [domain.id, domain]));

  assert.equal(routing.evidenceScope, "fixture_only");
  assert.equal(routing.cases.length, 12);
  assert.deepEqual(
    new Set(routing.cases.map((fixtureCase) => fixtureCase.primaryDomain)),
    new Set(["4.1", "4.2", "4.3", "4.4", "4.5", "4.6"]),
  );
  for (const fixtureCase of routing.cases) {
    assert.equal(fixtureCase.accountable, domains.get(fixtureCase.primaryDomain).accountable);
    assert.ok(agentSlugs.has(fixtureCase.lead));
    assert.ok(fixtureCase.nextGate);
    if (fixtureCase.implementationAuthor) {
      assert.ok(agentSlugs.has(fixtureCase.implementationAuthor));
      assert.ok(!fixtureCase.reviewers.includes(fixtureCase.implementationAuthor));
    }
    assert.ok(fixtureCase.reviewers.every((slug) => agentSlugs.has(slug)));
  }
});

test("system register stays deny-by-default and handbook chapters stay source-pending", () => {
  const register = readFileSync(
    join(packageDir, "references", "system-repository-register.yaml"),
    "utf8",
  );
  const handbook = readFileSync(
    join(packageDir, "references", "engineering-handbook-index.md"),
    "utf8",
  );

  assert.match(register, /status: offline_inventory_not_connection_proof/);
  assert.match(register, /unlistedRepository: deny/);
  assert.match(register, /repositoryEntryCreatesAccess: false/);
  assert.deepEqual(
    [...register.matchAll(/^  - slug: (optiak\/[a-z0-9-]+)$/gm)].map((match) => match[1]),
    ["optiak/optiak", "optiak/optiak-frontend", "optiak/iac-infra"],
  );
  for (const chapter of [
    "Architecture principles",
    "ADR / RFC process",
    "Development standards",
    "Testing strategy",
    "Release process",
    "Engineering ways of working",
  ]) {
    assert.match(handbook, new RegExp(`\\| ${chapter.replace("/", "\\/")} \\|`));
  }
  assert.match(handbook, /source pending/);
  assert.match(handbook, /superseded, never silently overwritten/);
});
