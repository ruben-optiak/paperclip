import assert from "node:assert/strict";
import test from "node:test";
import {buildCanaryReview} from "../scripts/prepare-canary-review.mjs";

test("builds a non-authoritative product-exact canary review", () => {
  const product = {
    productKey: "sanycces-pool-mno006ss",
    name: "Monomando de lavabo Pool de Sanycces",
    type: "variable",
    status: "draft",
    sku: "MNO006SS",
    slug: "monomando-lavabo-pool",
    categories: [291],
    images: [{sha256: "a".repeat(64)}],
    seo: {provider: "yoast", title: "Monomando lavabo Pool | Sanycces", description: "Ficha revisada.", focusKeyword: "monomando lavabo pool"},
    variations: [
      {status: "private", sku: "MNO006SSNB", gtin: "8435737779080", commerce: {regularPrice: "254.10", salePrice: "215.99"}},
      {status: "private", sku: "MNO006SSRM", gtin: "8435737779097", commerce: {regularPrice: "310.97", salePrice: "256.55"}},
    ],
  };
  const review = buildCanaryReview({
    manifest: {createdAt: "2026-09-20T11:02:32+02:00", runId: "pool-v2"},
    expectedBundle: {bundleKey: "pool-batch-03", sha256: "b".repeat(64)},
    bundle: {review: {catalogueQa: "PASS", brandGuardian: "PASS"}},
    product,
    preflight: {
      batchManifestSha256: "c".repeat(64),
      status: "valid_local_dry_run",
      checks: {
        webp: {dimensionsMatch: true},
        gtin: {checksumErrors: 0},
        seo: {duplicateTitles: 0},
        commercialPolicy: {status: "exact_policy_match"},
      },
    },
  });
  assert.equal(review.status, "prepared_for_exact_human_approval");
  assert.equal(review.authority.approvalGranted, false);
  assert.equal(review.authority.externalWritesPerformed, 0);
  assert.equal(review.authority.canCreateWooDraft, false);
  assert.equal(review.source.productKey, product.productKey);
  assert.deepEqual(review.candidate.sellables.map((item) => item.sku), ["MNO006SSNB", "MNO006SSRM"]);
  assert.equal(review.expectedWriteShapeAfterApproval.parentStatus, "draft");
  assert.equal(review.expectedWriteShapeAfterApproval.variationStatus, "private");
  assert.equal(review.expectedWriteShapeAfterApproval.publicationAllowed, false);
});
