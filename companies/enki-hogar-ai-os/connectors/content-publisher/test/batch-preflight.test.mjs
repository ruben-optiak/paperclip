import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {preflightBundleBatch} from "../scripts/preflight-bundle-batch.mjs";

const fixturePath = new URL("../../../skills/enki-product-publishing/fixtures/product-draft-bundle.json", import.meta.url);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function makeWebp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const chunk = Buffer.alloc(8);
  chunk.write("VP8 ", 0, 4, "ascii");
  chunk.writeUInt32LE(frame.length, 4);
  const body = Buffer.concat([Buffer.from("WEBP"), chunk, frame]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

async function makeBatch() {
  const root = await mkdtemp(join(tmpdir(), "enki-product-batch-"));
  const manifest = JSON.parse(await readFile(fixturePath, "utf8"));
  const bundleRoot = join(root, manifest.bundleKey);
  await mkdir(join(bundleRoot, "media"), {recursive: true});
  for (const image of manifest.products.flatMap((product) => product.images)) {
    const media = makeWebp(image.width, image.height);
    image.sha256 = digest(media);
    await writeFile(join(bundleRoot, image.path), media);
  }
  const bundleBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const bundlePath = join(bundleRoot, "product-draft-bundle.json");
  await writeFile(bundlePath, bundleBytes);
  const batch = {
    schema: "enki-product-draft-bundle-batch/v1",
    authority: {canCreateWooDraft: false, canPublish: false},
    preflight: {publicationWrites: 0},
    summary: {readyProducts: 1, bundles: 1},
    bundles: [{
      bundleKey: manifest.bundleKey,
      path: `${manifest.bundleKey}/product-draft-bundle.json`,
      sha256: digest(bundleBytes),
      productKeys: manifest.products.map((item) => item.productKey),
      productCount: 1,
    }],
  };
  const batchPath = join(root, "batch-manifest.json");
  await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
  return {root, batch, batchPath, bundlePath, manifest};
}

async function attachCommercialPolicy(fixture) {
  const {root, batch, batchPath, bundlePath, manifest} = fixture;
  const product = manifest.products[0];
  product.commerce.salePrice = "339.15";
  product.commerce.salePriceEvidenceKey = `discount-policy:${product.sku}`;
  product.commerce.priceEvidenceKey = `tariff-regular:${product.sku}`;
  product.evidence.push({
    field: "commerce.salePrice",
    evidenceKey: product.commerce.salePriceEvidenceKey,
    sourceSha256: "e".repeat(64),
    confidence: "high",
  });
  product.evidence.find((item) => item.evidenceKey === "fixture-price-demo-60").evidenceKey = product.commerce.priceEvidenceKey;
  const bundleBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(bundlePath, bundleBytes);
  batch.bundles[0].sha256 = digest(bundleBytes);
  const policy = {
    schema: "enki-discount-policy/v1",
    policyKey: "fixture-policy-v1",
    status: "approved_for_new_product_candidates",
    basis: {vatPercent: "21.00"},
    tiers: [{minimumInclusive: "0.00", maximumExclusive: null, discountPercent: "15.00"}],
    governance: {externalMutationAuthority: false},
  };
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);
  await writeFile(join(root, "discount-policy.json"), policyBytes);
  const audit = {
    schema: "enki-product-price-policy-audit/v1",
    policyKey: policy.policyKey,
    policySha256: digest(policyBytes),
    officialTariffSha256: "f".repeat(64),
    vatPercent: "21.00",
    entries: [{
      sku: product.sku,
      productKey: product.productKey,
      officialPvpExVat: "329.75",
      discountPercent: "15.00",
      regularGross: "399.00",
      saleGross: "339.15",
    }],
    summary: {sellableSkus: 1, policyMismatches: 0},
    authority: {externalMutationAuthority: false},
  };
  const auditBytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`);
  await writeFile(join(root, "price-policy-audit.json"), auditBytes);
  batch.sources = {
    discountPolicyPath: "discount-policy.json",
    discountPolicySha256: digest(policyBytes),
    pricePolicyAuditPath: "price-policy-audit.json",
    pricePolicyAuditSha256: digest(auditBytes),
  };
  await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
}

test("preflights every immutable bundle without an external write", async () => {
  const {root, batchPath} = await makeBatch();
  try {
    const result = await preflightBundleBatch(batchPath, {writeReport: false});
    assert.equal(result.status, "valid_local_dry_run");
    assert.equal(result.externalWrites, 0);
    assert.equal(result.productCount, 1);
    assert.equal(result.bundles[0].status, "valid");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects bundle hash drift before loading a product", async () => {
  const {root, batch, batchPath} = await makeBatch();
  try {
    batch.bundles[0].sha256 = "0".repeat(64);
    await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
    await assert.rejects(() => preflightBundleBatch(batchPath, {writeReport: false}), /hash drift/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("independently recomputes every declared commercial policy price", async () => {
  const fixture = await makeBatch();
  try {
    await attachCommercialPolicy(fixture);
    const result = await preflightBundleBatch(fixture.batchPath, {writeReport: false});
    assert.equal(result.checks.commercialPolicy.status, "exact_policy_match");
    assert.equal(result.checks.commercialPolicy.sellableSkusChecked, 1);

    const audit = JSON.parse(await readFile(join(fixture.root, "price-policy-audit.json"), "utf8"));
    audit.entries[0].saleGross = "339.14";
    const bytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`);
    await writeFile(join(fixture.root, "price-policy-audit.json"), bytes);
    fixture.batch.sources.pricePolicyAuditSha256 = digest(bytes);
    await writeFile(fixture.batchPath, `${JSON.stringify(fixture.batch, null, 2)}\n`);
    await assert.rejects(() => preflightBundleBatch(fixture.batchPath, {writeReport: false}), /calculation mismatch/);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});
