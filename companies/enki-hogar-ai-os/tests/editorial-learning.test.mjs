import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {addCalendarDays, validateEditorialFeedback, validatePublicationRetrospective} from "../skills/enki-editorial-learning/scripts/validate_editorial_learning.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(packageDir, "skills", "enki-editorial-learning", "fixtures");
const feedback = JSON.parse(readFileSync(join(fixtureDir, "editorial-feedback.json"), "utf8"));
const retrospective = JSON.parse(readFileSync(join(fixtureDir, "publication-retrospective.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(fixtureDir, "learning-cases.json"), "utf8"));
const policy = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "editorial-learning-policy-v1.json"), "utf8"));
const feedbackSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "editorial-feedback-v1.schema.json"), "utf8"));
const retrospectiveSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "publication-retrospective-v1.schema.json"), "utf8"));
const workflow = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "editorial-workflow-v2.json"), "utf8"));

function clone(value) {
  return structuredClone(value);
}

function promotedRetrospective() {
  const document = clone(retrospective);
  document.learningCandidates = [clone(cases.validRepeatedPromotion.candidate)];
  document.promotionDecisions = [clone(cases.validRepeatedPromotion.decision)];
  return document;
}

function applyCase(fixtureCase) {
  let document;
  if (fixtureCase.base === "feedback") document = clone(feedback);
  else if (fixtureCase.base === "promoted") document = promotedRetrospective();
  else document = clone(retrospective);

  if (fixtureCase.operation === "use_unproven_improvement") {
    document.learningCandidates = [clone(cases.unprovenImprovement.candidate)];
    document.promotionDecisions = [clone(cases.unprovenImprovement.decision)];
    return document;
  }
  if (fixtureCase.operation === "set_both_targets") {
    document.learningCandidates[0].proposedTarget.path = fixtureCase.value;
    document.promotionDecisions[0].target.path = fixtureCase.value;
    return document;
  }
  let target = document;
  for (const segment of fixtureCase.path.slice(0, -1)) target = target[segment];
  target[fixtureCase.path.at(-1)] = fixtureCase.value;
  return document;
}

test("feedback fixture preserves exact Board and agent review lineage without PII", () => {
  const result = validateEditorialFeedback(feedback);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(feedback.observations.map((item) => item.source.actorType), ["board", "agent"]);
  for (const item of feedback.observations) {
    assert.ok(item.subject.artifact.issueKey);
    assert.ok(item.subject.artifact.documentKey);
    assert.ok(item.subject.artifact.revisionId);
    assert.equal(item.piiStatus, "none_or_anonymized");
  }
});

test("retrospective fixture freezes the hypothesis and keeps 7d insufficient plus 28d/90d pending", () => {
  const result = validatePublicationRetrospective(retrospective, policy);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(Date.parse(retrospective.hypothesis.frozenAt) < Date.parse(retrospective.subject.publication.publishedAt));
  assert.deepEqual(retrospective.checkpoints.map((item) => [item.key, item.eligibleOn, item.status]), [
    ["7d", "2026-08-27", "insufficient_volume"],
    ["28d", "2026-09-17", "pending"],
    ["90d", "2026-11-18", "pending"],
  ]);
  assert.equal(retrospective.outcome.status, "inconclusive");
  assert.equal(addCalendarDays("2026-08-20", 90), "2026-11-18");
});

test("draft canary keeps the retrospective initialized and does not start the clock", () => {
  const document = clone(retrospective);
  document.lifecycle = "initialized";
  document.subject.publication = null;
  document.checkpoints = document.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    eligibleOn: null,
    evaluatedAt: null,
    status: "pending",
    minimumVolumeMet: null,
    sources: [],
    metrics: [],
    conclusion: "pending",
    limitations: [],
  }));
  document.outcome = {status: "pending", evaluatedThrough: "none", summary: "", confidence: "unknown"};
  document.learningCandidates = [];
  document.promotionDecisions = [];
  const result = validatePublicationRetrospective(document, policy);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("two independent observations can be implemented only through a Board decision and a regression test", () => {
  const document = promotedRetrospective();
  const result = validatePublicationRetrospective(document, policy);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(document.learningCandidates[0].independentContentKeys.length, 2);
  assert.equal(document.promotionDecisions[0].decidedBy, "board");
  assert.ok(document.promotionDecisions[0].requiredTests.length > 0);
});

test("negative learning fixtures reject stale linkage, early results and automatic over-learning", async (t) => {
  for (const fixtureCase of cases.cases) {
    await t.test(fixtureCase.name, () => {
      const document = applyCase(fixtureCase);
      const result = document.schema === "enki-editorial-feedback/v1"
        ? validateEditorialFeedback(document)
        : validatePublicationRetrospective(document, policy);
      assert.equal(result.ok, false);
      assert.equal(result.errors.some((error) => error.code === fixtureCase.expectedCode), true, JSON.stringify(result.errors));
    });
  }
});

test("policy and workflow make publication learning human-governed and date-based", () => {
  assert.equal(policy.schema, "enki-editorial-learning-policy/v1");
  assert.deepEqual(policy.measurement.checkpointDays, [7, 28, 90]);
  assert.equal(policy.measurement.clockSource, "live_provider_published_at");
  assert.equal(policy.measurement.draftCanaryStartsClock, false);
  assert.equal(policy.promotion.automaticPromotion, false);
  assert.equal(policy.promotion.decisionOwner, "board");
  assert.equal(policy.promotion.bases.repeated_observation.minimumIndependentContentItems, 2);
  assert.equal(workflow.learningArtifacts.automaticRulePromotionBlocked, true);
  const publish = workflow.stages.find((stage) => stage.key === "publish");
  assert.equal(publish.requiresRetrospectiveBeforeLivePublication, true);
  assert.equal(publish.draftCanaryStartsMeasurementClock, false);
});

test("learning schemas expose exact revision, checkpoint, feedback and promotion fields", () => {
  assert.equal(feedbackSchema.$id, "urn:enki:editorial-feedback:v1");
  assert.equal(retrospectiveSchema.$id, "urn:enki:publication-retrospective:v1");
  assert.deepEqual(feedbackSchema.$defs.artifactRef.required, ["issueKey", "documentKey", "revisionId"]);
  assert.deepEqual(retrospectiveSchema.properties.measurementPlan.properties.checkpointDays.prefixItems.map((item) => item.const), [7, 28, 90]);
  assert.equal(retrospectiveSchema.$defs.feedbackRef.properties.documentKey.const, "editorial-feedback");
  assert.deepEqual(retrospectiveSchema.$defs.target.properties.kind.enum, ["agent_contract", "skill", "contract", "fixture_eval", "runbook", "connector"]);
});
