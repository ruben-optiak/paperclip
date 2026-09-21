#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {WooCommerceProductClient} from "../src/clients.mjs";

const ROLLOUT_MANIFEST_SHA256 = "a1fd74f1b0d169077f374eaf1dcd0f2cd108371c67ce7b1bdcc562baf8494d65";
const BATCH_MANIFEST_SHA256 = "d60d0b25df9f6a68292c442687bcc445a0084a6d13bc50d96f6029ebef60a901";
const CANARY_RECEIPT_SHA256 = "c11a675b2c4ac7ac659866decc0d42f65455df359757f53d02fcbf1b0e395365";
const CANARY_SKU = "MNO006SS";
const BRAND_ID = 1410;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error(`Invalid argument: ${argv[index] ?? ""}`);
    values.set(argv[index], argv[index + 1]);
  }
  for (const required of ["--manifest", "--bundle-root", "--canary-receipt", "--output", "--captured-at"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  return {
    manifestPath: resolve(values.get("--manifest")),
    bundleRoot: resolve(values.get("--bundle-root")),
    canaryReceiptPath: resolve(values.get("--canary-receipt")),
    outputPath: resolve(values.get("--output")),
    capturedAt: values.get("--captured-at"),
  };
}

function normalizeHtml(value) {
  return String(value ?? "").trim().replace(/>\s+</g, "><");
}

function ids(values) {
  return (values ?? []).map((item) => Number(item?.id)).filter(Number.isSafeInteger).sort((left, right) => left - right);
}

function metaValue(row, key) {
  return String((row?.meta_data ?? []).filter((item) => item?.key === key).at(-1)?.value ?? "");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

async function resolveLive(woo, sku) {
  const rows = await woo.request("GET", "/products", {params: {sku, status: "any", per_page: 10}});
  const exact = rows.filter((row) => row?.sku === sku);
  if (exact.length !== 1) throw new Error(`Expected exactly one live parent for ${sku}`);
  const parent = exact[0];
  const variations = parent.type === "variable"
    ? await woo.request("GET", `/products/${parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
    : [];
  return {parent, variations};
}

function verifyReviewedFields(product, live) {
  const parent = live.parent;
  if (parent.type !== product.type || parent.name !== product.name || parent.slug !== product.slug || parent.sku !== product.sku
    || normalizeHtml(parent.description) !== normalizeHtml(product.descriptionHtml)
    || normalizeHtml(parent.short_description) !== normalizeHtml(product.shortDescriptionHtml)
    || !same(ids(parent.categories), [...product.categories].sort((left, right) => left - right))
    || !ids(parent.brands).includes(BRAND_ID)
    || metaValue(parent, "_yoast_wpseo_title") !== product.seo.title
    || metaValue(parent, "_yoast_wpseo_metadesc") !== product.seo.description
    || metaValue(parent, "_yoast_wpseo_focuskw") !== product.seo.focusKeyword) {
    throw new Error(`Live product does not match reviewed v16 content for ${product.sku}`);
  }
  const expected = [...(product.variations ?? [])].sort((left, right) => left.sku.localeCompare(right.sku));
  const actual = [...live.variations].sort((left, right) => left.sku.localeCompare(right.sku));
  if (expected.length !== actual.length) throw new Error(`Variation count drift for ${product.sku}`);
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index]?.sku !== expected[index].sku || actual[index]?.status !== "publish"
      || String(actual[index]?.regular_price ?? "") !== String(expected[index].commerce?.regularPrice ?? "")
      || String(actual[index]?.sale_price ?? "") !== String(expected[index].commerce?.salePrice ?? "")) {
      throw new Error(`Variation identity, status or price drift for ${expected[index].sku}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const [manifestBytes, batchManifestBytes, canaryReceiptBytes] = await Promise.all([
  readFile(args.manifestPath),
  readFile(join(args.bundleRoot, "batch-manifest.json")),
  readFile(args.canaryReceiptPath),
]);
if (sha256(manifestBytes) !== ROLLOUT_MANIFEST_SHA256) throw new Error("Remaining-23 rollout manifest hash mismatch");
if (sha256(batchManifestBytes) !== BATCH_MANIFEST_SHA256) throw new Error("Reviewed v16 batch manifest hash mismatch");
if (sha256(canaryReceiptBytes) !== CANARY_RECEIPT_SHA256) throw new Error("Public canary receipt hash mismatch");

const manifest = JSON.parse(manifestBytes);
const batchManifest = JSON.parse(batchManifestBytes);
const canaryReceipt = JSON.parse(canaryReceiptBytes);
if (manifest.gates?.publicationAuthorized !== false || manifest.externalWrites !== 0 || manifest.targets?.length !== 23) {
  throw new Error("Rollout manifest must remain an unapproved zero-write proposal");
}
if (canaryReceipt.target?.status !== "publish" || canaryReceipt.target?.catalogVisibility !== "visible") {
  throw new Error("Completed public canary is required");
}

const productsBySku = new Map();
const bundleHashBySku = new Map();
for (const bundleRow of batchManifest.bundles ?? []) {
  const bundleBytes = await readFile(join(args.bundleRoot, bundleRow.path));
  if (sha256(bundleBytes) !== bundleRow.sha256) throw new Error(`Bundle hash drift: ${bundleRow.bundleKey}`);
  for (const product of JSON.parse(bundleBytes).products ?? []) {
    productsBySku.set(product.sku, product);
    bundleHashBySku.set(product.sku, bundleRow.sha256);
  }
}
if (productsBySku.size !== 24 || productsBySku.has(CANARY_SKU) !== true) throw new Error("Reviewed Pool set must contain 24 parents");

if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
  throw new Error("WooCommerce publishing credentials are incomplete");
}
const woo = new WooCommerceProductClient({
  baseUrl: process.env.WOO_PUBLISH_BASE_URL,
  consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
  consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
});

const rows = [];
for (const target of manifest.targets) {
  const product = productsBySku.get(target.sku);
  if (!product || bundleHashBySku.get(target.sku) !== target.bundleSha256) throw new Error(`Manifest identity drift for ${target.sku}`);
  const live = await resolveLive(woo, target.sku);
  verifyReviewedFields(product, live);
  if (Number(live.parent.id) !== target.externalId || live.parent.status !== "draft" || live.parent.catalog_visibility !== "hidden") {
    throw new Error(`Publication state drift for ${target.sku}`);
  }
  rows.push({
    sku: target.sku,
    externalId: target.externalId,
    status: live.parent.status,
    catalogVisibility: live.parent.catalog_visibility,
    variations: live.variations.length,
    variationStatuses: [...new Set(live.variations.map((variation) => variation.status))],
  });
}

const canaryProduct = productsBySku.get(CANARY_SKU);
const canaryLive = await resolveLive(woo, CANARY_SKU);
verifyReviewedFields(canaryProduct, canaryLive);
if (canaryLive.parent.status !== "publish" || canaryLive.parent.catalog_visibility !== "visible") {
  throw new Error("Public canary state drift");
}

const evidence = {
  schema: "enki-pool-remaining-23-publication-preflight/v1",
  capturedAt: args.capturedAt,
  rolloutManifestSha256: ROLLOUT_MANIFEST_SHA256,
  batchManifestSha256: BATCH_MANIFEST_SHA256,
  canaryReceiptSha256: CANARY_RECEIPT_SHA256,
  canary: {sku: CANARY_SKU, status: "publish", catalogVisibility: "visible"},
  targets: rows,
  summary: {
    targetsChecked: rows.length,
    targetsDraftHidden: rows.every((row) => row.status === "draft" && row.catalogVisibility === "hidden"),
    variationsChecked: rows.reduce((total, row) => total + row.variations, 0),
    variationsPublish: rows.every((row) => row.variationStatuses.every((status) => status === "publish")),
    reviewedContentMatches: rows.length,
    failures: 0,
  },
  proposedMutation: {parentStatus: "publish", catalogVisibility: "visible"},
  externalWrites: 0,
};
await writeJsonAtomic(args.outputPath, evidence);
console.log(JSON.stringify({status: "PASS", ...evidence.summary, externalWrites: 0}, null, 2));
