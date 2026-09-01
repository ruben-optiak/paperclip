import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {candidateFingerprint, validateEditorialBrief} from "../skills/enki-editorial-planning/scripts/validate_editorial_brief.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(packageDir, "skills", "enki-editorial-planning", "fixtures");
const base = JSON.parse(readFileSync(join(fixtureDir, "enk-24-corrected.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(fixtureDir, "validation-cases.json"), "utf8"));
const workflow = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "editorial-workflow-v2.json"), "utf8"));
const schema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "editorial-brief-v2.schema.json"), "utf8"));

function clone(value) {
  return structuredClone(value);
}

function applyCase(document, fixtureCase) {
  let target = document;
  for (const segment of fixtureCase.path.slice(0, -1)) target = target[segment];
  const last = fixtureCase.path.at(-1);
  if (fixtureCase.operation === "set") target[last] = fixtureCase.value;
  else if (fixtureCase.operation === "remove_last") target[last].pop();
  else throw new Error(`Unsupported fixture operation: ${fixtureCase.operation}`);
}

test("ENK-24 corrected fixture is decision-safe and reproduces all candidate scores", () => {
  const result = validateEditorialBrief(base);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.computedScores, {C1: 3.75, C2: 3.6, C3: 2.6});
  assert.equal(result.candidateFingerprint, base.shortlist.candidateFingerprint);
  assert.equal(base.boardDecision.authorizedNextStage, "research");
  assert.equal(base.gates.externalWritesBlocked, true);
  assert.equal(base.gates.allowedNextStage, "research");
});

test("negative fixtures reject identity confusion, candidate drift, stale decisions and score errors", async (t) => {
  assert.equal(cases.baseFixture, "enk-24-corrected.json");
  for (const fixtureCase of cases.cases) {
    await t.test(fixtureCase.name, () => {
      const document = clone(base);
      applyCase(document, fixtureCase);
      const result = validateEditorialBrief(document);
      assert.equal(result.ok, false);
      assert.equal(result.errors.some((error) => error.code === fixtureCase.expectedCode), true, JSON.stringify(result.errors));
    });
  }
});

test("Growth and Ecommerce candidate identity is byte-stable at the decision gate", () => {
  const shortlistSet = base.shortlist.candidates.map(({candidateKey, surfaceType, canonicalUrl}) => ({candidateKey, surfaceType, canonicalUrl}));
  const validationSet = base.candidateValidation.validatedCandidates.map(({candidateKey, surfaceType, canonicalUrl}) => ({candidateKey, surfaceType, canonicalUrl}));
  assert.deepEqual(validationSet, shortlistSet);
  assert.equal(base.candidateValidation.sourceCandidateFingerprint, candidateFingerprint(base.shortlist.candidates));
  assert.equal(base.boardDecision.sourceCandidateFingerprint, base.candidateValidation.sourceCandidateFingerprint);
});

test("workflow v2 has seven sequential gates and applies Board decisions in a newer brief", () => {
  assert.equal(workflow.schema, "enki-editorial-workflow/v2");
  const expected = ["research", "shortlist", "candidate_validation", "board_decision", "draft", "review", "publish"];
  assert.deepEqual(workflow.stages.map((stage) => stage.key), expected);
  for (let index = 1; index < expected.length; index += 1) assert.equal(workflow.stages[index].dependsOn, expected[index - 1]);
  assert.equal(workflow.planningArtifact.decisionMustTargetExactRevision, true);
  assert.equal(workflow.planningArtifact.decisionMustTargetExactValidationRevision, true);
  assert.equal(workflow.planningArtifact.decisionMustBeAppliedInNewerRevision, true);
  assert.match(workflow.stages.find((stage) => stage.key === "board_decision").completionGate, /newer_editorial_brief_revision/);
  assert.equal(workflow.stages.find((stage) => stage.key === "publish").approvalOwner, "board");
});

test("editorial brief schema keeps surface identities and Board update fields explicit", () => {
  assert.equal(schema.$id, "urn:enki:editorial-brief:v2");
  assert.equal(schema.properties.timezone.const, "Europe/Madrid");
  assert.deepEqual(schema.properties.provenance.properties.kind.enum, ["operational", "sanitized_fixture"]);
  assert.deepEqual(schema.$defs.candidate.properties.surfaceType.enum, ["category", "brand_landing", "article", "product", "campaign", "other"]);
  assert.deepEqual(schema.$defs.candidate.properties.identity.required, ["wordpressPostId", "wooProductId", "sku"]);
  assert.equal(schema.properties.postDecisionUpdate.oneOf[1].properties.currentRevisionNumber.minimum, 2);
  assert.equal(base.boardDecision.sourceValidationRevisionId, base.candidateValidation.validationRevisionId);
});
