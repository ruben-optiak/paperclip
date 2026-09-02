import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

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
  assert.equal(skills.length, 13);
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
});

test("incident fixture cannot imply a production incident", () => {
  const data = fixture("optiak-incident-triage", "alert");
  assert.equal(data.environment, "staging");
  assert.equal(data.productionImpact, false);
  assert.equal(data.expectedSeverity, "SEV3");
});

test("disconnected E2E fixture remains blocked", () => {
  const data = fixture("optiak-e2e-validation", "journey");
  assert.equal(data.environment, "fixture");
  assert.equal(data.expectedResultWithoutConnection, "blocked");
  assert.equal(data.mutationLevel, "yellow");
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

test("every agent is assigned the durable completion contract", () => {
  const agentRoot = join(packageDir, "agents");
  const agents = readdirSync(agentRoot);
  assert.equal(agents.length, 10);
  for (const agent of agents) {
    const markdown = readFileSync(join(agentRoot, agent, "AGENTS.md"), "utf8");
    assert.match(markdown, /^  - optiak-durable-completion$/m, `${agent} is missing durable completion`);
  }
});

test("source map keeps future authorities disconnected", () => {
  const sourceMap = readFileSync(join(packageDir, "references", "source-map.yaml"), "utf8");
  assert.equal((sourceMap.match(/status: disconnected/g) || []).length, 7);
  assert.match(sourceMap, /wholeSiteSnapshotsAllowed: false/);
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
