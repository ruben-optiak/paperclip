#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {WooCommerceProductClient} from "../src/clients.mjs";

const AUTHORIZATION = "user-approved-pool-mno006ss-v16-public-canary-2026-09-21";
const BATCH_MANIFEST_SHA256 = "d60d0b25df9f6a68292c442687bcc445a0084a6d13bc50d96f6029ebef60a901";
const PRODUCT_BUNDLE_SHA256 = "f56e19856fb2df28df4989ff4f7c2a09d36c7c8cdb34890694b7391cc8aca10c";
const PRODUCT_KEY = "sanycces-pool-mno006ss";
const SKU = "MNO006SS";
const BRAND_ID = 1410;
const MUTABLE_META = new Set([
  "_enki_canary_publish_bundle_sha256",
  "_enki_canary_publish_batch_sha256",
  "_enki_canary_publish_approval",
  "_enki_approval_document",
  "_enki_approval_revision",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const values = new Map();
  let apply = false;
  let verifyOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      apply = true;
      continue;
    }
    if (value === "--verify-only") {
      verifyOnly = true;
      continue;
    }
    if (!value.startsWith("--") || index + 1 >= argv.length) throw new Error(`Invalid argument: ${value}`);
    values.set(value, argv[++index]);
  }
  for (const required of ["--bundle-root", "--series-link-receipt", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply && verifyOnly) throw new Error("Use either --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) {
    throw new Error("Exact MNO006SS v16 public-canary authorization marker is required for --apply");
  }
  return {
    apply,
    verifyOnly,
    bundleRoot: resolve(values.get("--bundle-root")),
    seriesLinkReceiptPath: resolve(values.get("--series-link-receipt")),
    journalPath: resolve(values.get("--journal")),
    receiptPath: resolve(values.get("--receipt")),
  };
}

function normalizeHtml(value) {
  return String(value ?? "").trim().replace(/>\s+</g, "><");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ids(values) {
  return (values ?? []).map((item) => Number(item?.id)).filter(Number.isSafeInteger).sort((left, right) => left - right);
}

function orderedIds(values) {
  return (values ?? []).map((item) => Number(item?.id)).filter(Number.isSafeInteger);
}

function normalizedAttributes(values, variation = false) {
  return (values ?? []).map((item) => ({
    id: Number(item.id),
    ...(variation ? {option: String(item.option)} : {
      options: [...(item.options ?? [])].map(String).sort((left, right) => left.localeCompare(right, "es")),
      visible: item.visible === true,
      variation: item.variation === true,
    }),
  })).sort((left, right) => left.id - right.id);
}

function inventory(row) {
  return {
    manageStock: row?.manage_stock === true,
    stockQuantity: row?.stock_quantity === null || row?.stock_quantity === undefined ? null : Number(row.stock_quantity),
    stockStatus: String(row?.stock_status ?? ""),
  };
}

function metaRows(row, key) {
  return (row?.meta_data ?? []).filter((item) => item?.key === key);
}

function metaValue(row, key) {
  return String(metaRows(row, key).at(-1)?.value ?? "");
}

function metaPatch(row, key, value) {
  const matches = metaRows(row, key);
  if (matches.length > 1) throw new Error(`Duplicate live metadata key ${key} on ${row.sku}`);
  const id = Number(matches[0]?.id);
  return {...(Number.isSafeInteger(id) ? {id} : {}), key, value};
}

function stableParent(row) {
  const stableMeta = Object.fromEntries((row?.meta_data ?? [])
    .filter((item) => !MUTABLE_META.has(String(item?.key ?? "")))
    .map((item) => [String(item.key), String(item.value ?? "")])
    .sort(([left], [right]) => left.localeCompare(right)));
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    type: String(row.type ?? ""),
    sku: String(row.sku ?? ""),
    globalUniqueId: String(row.global_unique_id ?? ""),
    description: normalizeHtml(row.description),
    shortDescription: normalizeHtml(row.short_description),
    categoryIds: ids(row.categories),
    brandIds: ids(row.brands),
    tagIds: ids(row.tags),
    attributes: normalizedAttributes(row.attributes),
    regularPrice: String(row.regular_price ?? ""),
    salePrice: String(row.sale_price ?? ""),
    inventory: inventory(row),
    imageIds: orderedIds(row.images),
    imageAlts: (row.images ?? []).map((image) => String(image.alt ?? "")),
    defaultAttributes: row.default_attributes ?? [],
    stableMeta,
  };
}

function stableVariations(rows) {
  return [...rows].map((row) => ({
    id: Number(row.id),
    status: String(row.status ?? ""),
    sku: String(row.sku ?? ""),
    globalUniqueId: String(row.global_unique_id ?? ""),
    regularPrice: String(row.regular_price ?? ""),
    salePrice: String(row.sale_price ?? ""),
    inventory: inventory(row),
    imageId: Number(row.image?.id ?? 0),
    attributes: normalizedAttributes(row.attributes, true),
  })).sort((left, right) => left.sku.localeCompare(right.sku));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

async function loadReviewedBatch(root) {
  const manifestBytes = await readFile(join(root, "batch-manifest.json"));
  if (sha256(manifestBytes) !== BATCH_MANIFEST_SHA256) throw new Error("Approved v16 batch manifest hash mismatch");
  const manifest = JSON.parse(manifestBytes);
  const products = [];
  for (const row of manifest.bundles ?? []) {
    const bytes = await readFile(join(root, row.path));
    if (sha256(bytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    const bundle = JSON.parse(bytes);
    for (const product of bundle.products) products.push({product, bundleSha256: row.sha256});
  }
  if (products.length !== 24 || new Set(products.map((entry) => entry.product.sku)).size !== 24) {
    throw new Error("Approved Pool batch must contain exactly 24 unique parents");
  }
  const target = products.filter((entry) => entry.product.productKey === PRODUCT_KEY);
  if (target.length !== 1 || target[0].product.sku !== SKU || target[0].bundleSha256 !== PRODUCT_BUNDLE_SHA256) {
    throw new Error("Approved MNO006SS product/bundle identity mismatch");
  }
  return {products, target: target[0]};
}

async function resolveLive(woo, product) {
  const rows = await woo.request("GET", "/products", {params: {sku: product.sku, status: "any", per_page: 10}});
  const exact = rows.filter((row) => row?.sku === product.sku);
  if (exact.length !== 1) throw new Error(`Expected exactly one live parent for ${product.sku}`);
  const parent = exact[0];
  const variations = parent.type === "variable"
    ? await woo.request("GET", `/products/${parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
    : [];
  return {parent, variations};
}

function verifyProductFields(product, live) {
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
  const expectedSkus = (product.variations ?? []).map((variation) => variation.sku).sort();
  const actualSkus = live.variations.map((variation) => variation.sku).sort();
  if (!same(expectedSkus, actualSkus) || !live.variations.every((variation) => variation.status === "publish")) {
    throw new Error(`Live variation identity/status drift for ${product.sku}`);
  }
}

async function verifyScope(woo, products, expectedTargetPublished) {
  const rows = [];
  for (const {product} of products) {
    const live = await resolveLive(woo, product);
    verifyProductFields(product, live);
    const isTarget = product.productKey === PRODUCT_KEY;
    const expectedStatus = isTarget && expectedTargetPublished ? "publish" : "draft";
    const expectedVisibility = isTarget && expectedTargetPublished ? "visible" : "hidden";
    if (live.parent.status !== expectedStatus || live.parent.catalog_visibility !== expectedVisibility) {
      throw new Error(`Publication-scope drift for ${product.sku}`);
    }
    rows.push({
      sku: product.sku,
      productKey: product.productKey,
      externalId: Number(live.parent.id),
      status: live.parent.status,
      catalogVisibility: live.parent.catalog_visibility,
      variations: live.variations.length,
      variationStatuses: [...new Set(live.variations.map((variation) => variation.status))],
      canonicalUrl: String(live.parent.permalink ?? ""),
      live,
    });
  }
  return rows;
}

async function loadJournal(path) {
  try {
    const journal = await readJson(path);
    if (journal.schema !== "enki-pool-mno006ss-v16-publication-journal/v1"
      || journal.productBundleSha256 !== PRODUCT_BUNDLE_SHA256 || journal.authorization !== AUTHORIZATION) {
      throw new Error("Canary publication journal belongs to another approval");
    }
    return journal;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schema: "enki-pool-mno006ss-v16-publication-journal/v1",
      batchManifestSha256: BATCH_MANIFEST_SHA256,
      productBundleSha256: PRODUCT_BUNDLE_SHA256,
      productKey: PRODUCT_KEY,
      sku: SKU,
      authorization: AUTHORIZATION,
      status: "pending",
    };
  }
}

function publishBody(parent) {
  return {
    status: "publish",
    catalog_visibility: "visible",
    meta_data: [
      metaPatch(parent, "_enki_canary_publish_bundle_sha256", PRODUCT_BUNDLE_SHA256),
      metaPatch(parent, "_enki_canary_publish_batch_sha256", BATCH_MANIFEST_SHA256),
      metaPatch(parent, "_enki_canary_publish_approval", AUTHORIZATION),
      metaPatch(parent, "_enki_approval_document", "chat-user-authorization-2026-09-21"),
      metaPatch(parent, "_enki_approval_revision", "v16-mno006ss-public-canary"),
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {products, target} = await loadReviewedBatch(args.bundleRoot);
  const seriesReceipt = await readJson(args.seriesLinkReceiptPath);
  if (seriesReceipt.schema !== "enki-pool-v16-series-link-live-verification/v1"
    || seriesReceipt.batchManifestSha256 !== BATCH_MANIFEST_SHA256
    || seriesReceipt.summary?.parentsUpdated !== 24 || seriesReceipt.summary?.failures !== 0) {
    throw new Error("Completed v16 live-content receipt is required before canary publication");
  }
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  const journal = await loadJournal(args.journalPath);
  if (args.verifyOnly && journal.status !== "complete") throw new Error("Cannot verify an incomplete canary journal");

  if (!args.apply && !args.verifyOnly) {
    const scope = await verifyScope(woo, products, false);
    console.log(JSON.stringify({
      mode: "dry_run",
      batchManifestSha256: BATCH_MANIFEST_SHA256,
      productBundleSha256: PRODUCT_BUNDLE_SHA256,
      target: PRODUCT_KEY,
      parentId: scope.find((row) => row.productKey === PRODUCT_KEY)?.externalId,
      targetWillBecome: {status: "publish", catalogVisibility: "visible"},
      otherParentsRemainDraftHidden: scope.filter((row) => row.productKey !== PRODUCT_KEY).length,
      variationsChecked: scope.reduce((total, row) => total + row.variations, 0),
      externalWrites: 0,
    }, null, 2));
    return;
  }

  if (args.apply) {
    if (journal.status !== "pending") throw new Error("Canary journal is not in the pending state");
    const beforeScope = await verifyScope(woo, products, false);
    const beforeRow = beforeScope.find((row) => row.productKey === PRODUCT_KEY);
    const beforeParent = beforeRow.live.parent;
    const beforeVariations = beforeRow.live.variations;
    journal.status = "applying";
    journal.parentId = beforeRow.externalId;
    journal.before = {status: beforeParent.status, catalogVisibility: beforeParent.catalog_visibility};
    await writeJsonAtomic(args.journalPath, journal);

    await woo.request("PUT", `/products/${beforeRow.externalId}`, {body: publishBody(beforeParent)});
    const targetLive = await resolveLive(woo, target.product);
    verifyProductFields(target.product, targetLive);
    if (targetLive.parent.status !== "publish" || targetLive.parent.catalog_visibility !== "visible") {
      throw new Error("MNO006SS publication readback mismatch");
    }
    if (!same(stableParent(beforeParent), stableParent(targetLive.parent))) {
      throw new Error("Untouched MNO006SS parent fields changed during publication");
    }
    if (!same(stableVariations(beforeVariations), stableVariations(targetLive.variations))) {
      throw new Error("MNO006SS variation drift during publication");
    }
    if (metaValue(targetLive.parent, "_enki_canary_publish_bundle_sha256") !== PRODUCT_BUNDLE_SHA256
      || metaValue(targetLive.parent, "_enki_canary_publish_batch_sha256") !== BATCH_MANIFEST_SHA256
      || metaValue(targetLive.parent, "_enki_canary_publish_approval") !== AUTHORIZATION) {
      throw new Error("MNO006SS publication provenance mismatch");
    }

    const finalScope = await verifyScope(woo, products, true);
    const published = finalScope.find((row) => row.productKey === PRODUCT_KEY);
    journal.status = "complete";
    journal.after = {status: published.status, catalogVisibility: published.catalogVisibility};
    await writeJsonAtomic(args.journalPath, journal);
    const receipt = {
      schema: "enki-pool-mno006ss-v16-publication-verification/v1",
      batchManifestSha256: BATCH_MANIFEST_SHA256,
      productBundleSha256: PRODUCT_BUNDLE_SHA256,
      productKey: PRODUCT_KEY,
      sku: SKU,
      authorization: AUTHORIZATION,
      target: {
        externalId: published.externalId,
        status: published.status,
        catalogVisibility: published.catalogVisibility,
        canonicalUrl: published.canonicalUrl,
        variations: published.variations,
        variationStatuses: published.variationStatuses,
      },
      otherParents: finalScope.filter((row) => row.productKey !== PRODUCT_KEY).map((row) => ({
        sku: row.sku,
        externalId: row.externalId,
        status: row.status,
        catalogVisibility: row.catalogVisibility,
      })),
      summary: {
        parentsPublishedVisible: 1,
        otherParentsDraftHidden: 23,
        variationsVerified: finalScope.reduce((total, row) => total + row.variations, 0),
        variationsPublish: finalScope.every((row) => row.variationStatuses.every((status) => status === "publish")),
        contentChanged: 0,
        pricesChanged: 0,
        stockChanged: 0,
        mediaChanged: 0,
        seoMetadataChanged: 0,
        taxonomyChanged: 0,
        failures: 0,
      },
    };
    await writeJsonAtomic(args.receiptPath, receipt);
    console.log(JSON.stringify({status: "complete", ...receipt.summary, canonicalUrl: published.canonicalUrl}, null, 2));
    return;
  }

  const scope = await verifyScope(woo, products, true);
  const receipt = await readJson(args.receiptPath);
  if (receipt.schema !== "enki-pool-mno006ss-v16-publication-verification/v1"
    || receipt.productBundleSha256 !== PRODUCT_BUNDLE_SHA256 || receipt.summary?.failures !== 0) {
    throw new Error("Canary publication receipt is incomplete");
  }
  const published = scope.find((row) => row.productKey === PRODUCT_KEY);
  console.log(JSON.stringify({
    mode: "verify_only",
    target: PRODUCT_KEY,
    status: published.status,
    catalogVisibility: published.catalogVisibility,
    canonicalUrl: published.canonicalUrl,
    otherParentsDraftHidden: 23,
    variationsVerified: scope.reduce((total, row) => total + row.variations, 0),
    externalWrites: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
