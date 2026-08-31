import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {finalizeSupportPack} from "../../../scripts/product-support/finalize-support-pack.mjs";
import {loadSupportPack} from "../src/support-pack.mjs";

const companyRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const reviewRoot = join(companyRoot, "references/product-support/review/enki/espejos/1.0.0");

test("real Enki mirrors candidate is complete, non-commercial and blocked pending approval", async () => {
  const pack = await loadSupportPack(reviewRoot, {requireApproval: false});
  assert.equal(pack.manifest.approval.state, "review_required");
  assert.equal(pack.manifest.sourceRepository.revisionKind, "source_snapshot_sha256");
  assert.equal(pack.entities.filter((entity) => entity.entityKind === "model").length, 10);
  assert.equal(pack.entities.filter((entity) => entity.entityKind === "variant").length, 33);
  assert.equal(pack.relations.filter((relation) => relation.relationType === "variant_of").length, 33);
  assert.equal(pack.rules.length, 10);
  assert.equal(pack.crosswalk.length, 43);
  assert.equal(pack.crosswalk.every((mapping) => mapping.approvedBy === null && mapping.approvedAt === null), true);
  assert.equal(pack.facts.some((fact) => /^(?:price|pvp|stock|availability)$/i.test(fact.factKey)), false);
  assert.equal(pack.facts.some((fact) => /[€$£]/.test(fact.value)), false);
  await assert.rejects(loadSupportPack(reviewRoot), /approved before import/);
});

test("finalization signs the exact reviewed candidate without regenerating its technical content", async () => {
  const review = await loadSupportPack(reviewRoot, {requireApproval: false});
  const output = await mkdtemp(join(tmpdir(), "enki-approved-support-pack-"));
  const result = await finalizeSupportPack({
    reviewDirectory: reviewRoot,
    outputDirectory: output,
    approvedBy: "catalog-owner",
    approvedAt: "2026-08-31T12:00:00Z",
    expectedReviewManifestSha256: review.manifestSha256,
    expectedSourceRevision: review.manifest.sourceRepository.revision,
  });
  assert.equal(result.state, "approved");
  const approved = await loadSupportPack(output);
  assert.equal(approved.crosswalk.every((mapping) => mapping.approvedBy === "catalog-owner"), true);
  assert.deepEqual(approved.entities, review.entities);
  assert.deepEqual(approved.facts, review.facts);
  assert.deepEqual(approved.relations, review.relations);
  assert.deepEqual(approved.rules, review.rules);
  assert.deepEqual(approved.chunks, review.chunks);
});
