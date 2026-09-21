#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";

const EXPECTED_SOURCE_MANIFEST_SHA256 = "a0c563d2e329a1e2546fca4df308b2ddf32b372e6c74b22228858f5433730996";
const SEARCH_URL = "https://www.enkihogar.com/?s=Sanycces+Pool&amp;post_type=product";
const LINK_TEXT = "Ver todos los productos de la serie Pool de Sanycces";
const BEFORE = `<p>La colección incluye grifos de lavabo y bidé, soluciones murales, grifería de bañera, columnas, termostáticos, rociadores y cuerpos empotrados compatibles. <a href="${SEARCH_URL}">${LINK_TEXT}</a>.</p>`;
const AFTER = `<p>La colección incluye grifos de lavabo y bidé, soluciones murales, grifería de bañera, columnas, termostáticos, rociadores y cuerpos empotrados compatibles.</p><p><a href="${SEARCH_URL}">${LINK_TEXT}</a></p>`;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  for (const required of ["source", "output", "created-at"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
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

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);
const output = resolve(args.output);
if (await stat(output).then(() => true).catch(() => false)) throw new Error("Refusing to overwrite an existing revised batch");

const manifestBytes = await readFile(join(source, "batch-manifest.json"));
if (sha256(manifestBytes) !== EXPECTED_SOURCE_MANIFEST_SHA256) throw new Error("Source v15 manifest hash mismatch");
const manifest = JSON.parse(manifestBytes);
if (manifest.summary?.readyProducts !== 24 || manifest.summary?.variableProducts !== 20
  || manifest.summary?.simpleProducts !== 4 || manifest.summary?.sellableSkus !== 44
  || manifest.bundles?.length !== 5) {
  throw new Error("Source Pool batch must contain the exact reviewed 24-parent/44-SKU scope");
}

await mkdir(output, {recursive: false, mode: 0o750});
for (const file of [
  "content-seo-review-candidate.json",
  "discount-policy.json",
  "gallery-order-approval.json",
  "price-policy-audit.json",
  "primary-image-approval.json",
  "primary-image-policy.json",
  "primary-image-review-manifest.json",
  "taxonomy-snapshot.json",
]) {
  await cp(join(source, file), join(output, file));
}

const review = {
  schema: "enki-pool-series-link-layout-review/v1",
  createdAt: args["created-at"],
  authority: {externalWrites: false, publicationAuthority: false},
  scope: {parents: 24, descriptionHtmlAdjustments: 24},
  change: {
    beforeHtml: BEFORE,
    afterHtml: AFTER,
    rationale: "Place the Pool collection CTA in its own paragraph so it always starts on a new visual line.",
  },
  brandReview: {
    verdict: "PASS",
    claimsAdded: 0,
    claimsRemoved: 0,
    copyChanged: false,
    layoutOnly: true,
  },
};
const reviewBytes = bytes(review);
await writeFile(join(output, "series-link-layout-review.json"), reviewBytes, {mode: 0o640});

let adjusted = 0;
for (const row of manifest.bundles) {
  const sourceBundlePath = join(source, row.path);
  const sourceBundleBytes = await readFile(sourceBundlePath);
  if (sha256(sourceBundleBytes) !== row.sha256) throw new Error(`Source bundle hash drift: ${row.bundleKey}`);
  const bundle = JSON.parse(sourceBundleBytes);
  const outputBundlePath = join(output, row.path);
  const outputBundleRoot = dirname(outputBundlePath);
  await mkdir(outputBundleRoot, {recursive: true, mode: 0o750});
  await cp(join(dirname(sourceBundlePath), "media"), join(outputBundleRoot, "media"), {recursive: true});

  bundle.version = "1.8.0";
  bundle.createdAt = args["created-at"];
  for (const product of bundle.products) {
    if (product.descriptionHtml.split(BEFORE).length !== 2 || product.descriptionHtml.includes(AFTER)) {
      throw new Error(`Expected exactly one inline Pool CTA for ${product.sku}`);
    }
    product.descriptionHtml = product.descriptionHtml.replace(BEFORE, AFTER);
    adjusted += 1;
  }

  const revisedBundleBytes = bytes(bundle);
  await writeFile(outputBundlePath, revisedBundleBytes, {mode: 0o640});
  row.sha256 = sha256(revisedBundleBytes);
  row.validation = "pending_local_preflight";
}
if (adjusted !== 24) throw new Error(`Expected 24 layout adjustments, found ${adjusted}`);

manifest.runId = basename(output);
manifest.createdAt = args["created-at"];
manifest.sources.seriesLinkLayoutReviewPath = "series-link-layout-review.json";
manifest.sources.seriesLinkLayoutReviewSha256 = sha256(reviewBytes);
const revisedManifestBytes = bytes(manifest);
await writeFile(join(output, "batch-manifest.json"), revisedManifestBytes, {mode: 0o640});

const sourceReadme = await readFile(join(source, "README.md"), "utf8");
const revisionNote = [
  "",
  "## Pool collection link layout candidate v16",
  "",
  "The Pool collection CTA is now a standalone paragraph in all 24 long descriptions.",
  "No wording, claims, metadata, commerce, media or taxonomy fields changed.",
  "This is a local proposal with zero external writes and no publication authority.",
  "",
].join("\n");
await writeFile(join(output, "README.md"), `${sourceReadme.trimEnd()}\n${revisionNote}`, {mode: 0o640});

console.log(JSON.stringify({
  status: "complete",
  output,
  productsReviewed: 24,
  descriptionHtmlAdjustments: adjusted,
  batchManifestSha256: sha256(revisedManifestBytes),
  layoutReviewSha256: sha256(reviewBytes),
  externalWrites: 0,
}, null, 2));
