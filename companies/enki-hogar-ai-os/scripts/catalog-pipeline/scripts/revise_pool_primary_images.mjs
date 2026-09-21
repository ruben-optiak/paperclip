#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";

const AUTHORIZATION = "user-approved-all-pool-primary-images-2026-09-21";
const SHA256 = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  for (const required of ["source", "review", "policy", "output", "created-at", "authorization"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  if (values.authorization !== AUTHORIZATION) throw new Error("Exact primary-image approval marker is required");
  if (Number.isNaN(new Date(values["created-at"]).getTime()) || !/[zZ]|[+-]\d\d:\d\d$/.test(values["created-at"])) {
    throw new Error("--created-at must be a valid instant with explicit timezone");
  }
  return values;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

function bytes(value) {
  return Buffer.from(`${JSON.stringify(sorted(value), null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);
const reviewPath = resolve(args.review);
const reviewRoot = dirname(reviewPath);
const policyPath = resolve(args.policy);
const output = resolve(args.output);
if (await stat(output).then(() => true).catch(() => false)) throw new Error("Refusing to overwrite an existing revised batch");

const manifestPath = join(source, "batch-manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const reviewBytes = await readFile(reviewPath);
const review = JSON.parse(reviewBytes);
const policyBytes = await readFile(policyPath);
const policy = JSON.parse(policyBytes);
if (manifest.summary?.readyProducts !== 24 || manifest.summary?.sellableSkus !== 44 || manifest.bundles?.length !== 5) {
  throw new Error("Source Pool batch must contain exactly 24 parents and 44 sellable SKUs");
}
if (review.schema !== "enki-pool-primary-media-review/v1" || review.scope?.parents !== 24
  || review.scope?.candidateImages !== 44 || review.scope?.externalWrites !== 0) {
  throw new Error("Primary-image review manifest is outside the approved 24-parent/44-image scope");
}
if (policy.schema !== "enki-primary-product-image-policy/v1" || policy.output?.quality !== 92
  || policy.contentDetection?.targetContentFill !== 0.78) {
  throw new Error("Primary-image policy is not the approved v1 framing policy");
}

const reviewAssets = new Map();
for (const asset of review.assets ?? []) {
  const key = `${asset.sku}:${asset.finish}`;
  if (reviewAssets.has(key) || !SHA256.test(asset.targetSha256)) throw new Error(`Invalid review asset: ${key}`);
  const path = join(reviewRoot, "candidates", `${asset.sku.toLowerCase()}-${asset.finish.toLowerCase()}.webp`);
  if (await sha256File(path) !== asset.targetSha256) throw new Error(`Approved candidate hash drift: ${key}`);
  reviewAssets.set(key, {asset, path});
}
if (reviewAssets.size !== 44) throw new Error("Approved review must contain exactly 44 unique images");

await mkdir(output, {recursive: false, mode: 0o750});
for (const file of ["discount-policy.json", "price-policy-audit.json", "taxonomy-snapshot.json"]) {
  await cp(join(source, file), join(output, file));
}
await writeFile(join(output, "primary-image-policy.json"), policyBytes, {mode: 0o640});
await writeFile(join(output, "primary-image-review-manifest.json"), reviewBytes, {mode: 0o640});

const approval = {
  schema: "enki-primary-product-image-approval/v1",
  approvedAt: args["created-at"],
  authority: "chat-user-explicit",
  decision: "approved_all",
  authorization: AUTHORIZATION,
  scope: {parents: 24, candidateImages: 44},
  reviewManifestSha256: sha256(reviewBytes),
  policySha256: sha256(policyBytes),
};
const approvalBytes = bytes(approval);
await writeFile(join(output, "primary-image-approval.json"), approvalBytes, {mode: 0o640});

let replaced = 0;
const targetHashes = new Map();
for (const row of manifest.bundles) {
  const sourceBundlePath = join(source, row.path);
  const sourceBundleBytes = await readFile(sourceBundlePath);
  if (sha256(sourceBundleBytes) !== row.sha256) throw new Error(`Source bundle hash drift: ${row.bundleKey}`);
  const bundle = JSON.parse(sourceBundleBytes);
  const outputBundlePath = join(output, row.path);
  const outputBundleRoot = dirname(outputBundlePath);
  await mkdir(outputBundleRoot, {recursive: true, mode: 0o750});
  await cp(join(dirname(sourceBundlePath), "media"), join(outputBundleRoot, "media"), {recursive: true});

  bundle.version = "1.5.0";
  bundle.createdAt = args["created-at"];
  for (const product of bundle.products) {
    const nb = reviewAssets.get(`${product.sku}:NB`);
    if (!nb) throw new Error(`Approved NB candidate missing for ${product.sku}`);
    const primary = product.images.find((image) => image.position === 0 && image.gallery !== false);
    if (!primary) throw new Error(`Primary gallery image missing for ${product.sku}`);
    const primaryTarget = join(outputBundleRoot, primary.path);
    const priorPrimaryHash = targetHashes.get(primaryTarget);
    if (priorPrimaryHash && priorPrimaryHash !== nb.asset.targetSha256) throw new Error(`Shared NB target drift: ${primary.path}`);
    await cp(nb.path, primaryTarget);
    primary.sha256 = nb.asset.targetSha256;
    primary.width = 1000;
    primary.height = 1000;
    targetHashes.set(primaryTarget, primary.sha256);
    replaced += 1;

    if (product.type === "variable") {
      const rm = reviewAssets.get(`${product.sku}:RM`);
      if (!rm) throw new Error(`Approved RM candidate missing for ${product.sku}`);
      const variationImage = product.images.find((image) => image.gallery === false);
      if (!variationImage) throw new Error(`RM variation image missing for ${product.sku}`);
      const variationTarget = join(outputBundleRoot, variationImage.path);
      const priorVariationHash = targetHashes.get(variationTarget);
      if (priorVariationHash && priorVariationHash !== rm.asset.targetSha256) throw new Error(`Shared RM target drift: ${variationImage.path}`);
      await cp(rm.path, variationTarget);
      variationImage.sha256 = rm.asset.targetSha256;
      variationImage.width = 1000;
      variationImage.height = 1000;
      targetHashes.set(variationTarget, variationImage.sha256);
      replaced += 1;
    }
  }

  const bundleBytes = bytes(bundle);
  await writeFile(outputBundlePath, bundleBytes, {mode: 0o640});
  row.sha256 = sha256(bundleBytes);
  row.validation = "pending_local_preflight";
}
if (replaced !== 44) throw new Error(`Expected 44 replacements, found ${replaced}`);

manifest.runId = basename(output);
manifest.createdAt = args["created-at"];
manifest.sources.primaryImagePolicyPath = "primary-image-policy.json";
manifest.sources.primaryImagePolicySha256 = sha256(policyBytes);
manifest.sources.primaryImageReviewManifestPath = "primary-image-review-manifest.json";
manifest.sources.primaryImageReviewManifestSha256 = sha256(reviewBytes);
manifest.sources.primaryImageApprovalPath = "primary-image-approval.json";
manifest.sources.primaryImageApprovalSha256 = sha256(approvalBytes);
const revisedManifestBytes = bytes(manifest);
await writeFile(join(output, "batch-manifest.json"), revisedManifestBytes, {mode: 0o640});

const sourceReadme = await readFile(join(source, "README.md"), "utf8");
const revisionNote = [
  "",
  "## Primary-image revision v13",
  "",
  "The 24 reviewed Pool heroes and 20 RM variation images use the approved deterministic white-background framing policy.",
  "No titles, descriptions, prices, taxonomy, gallery order, stock settings or product identity fields changed in this revision.",
  "",
].join("\n");
await writeFile(join(output, "README.md"), `${sourceReadme.trimEnd()}\n${revisionNote}`, {mode: 0o640});

console.log(JSON.stringify({
  status: "complete",
  output,
  parentCount: 24,
  candidateImagesApplied: replaced,
  bundleCount: manifest.bundles.length,
  batchManifestSha256: sha256(revisedManifestBytes),
  reviewManifestSha256: sha256(reviewBytes),
  policySha256: sha256(policyBytes),
  externalWrites: 0,
}, null, 2));
