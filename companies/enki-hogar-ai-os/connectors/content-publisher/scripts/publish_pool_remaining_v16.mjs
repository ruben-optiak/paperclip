#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {WooCommerceProductClient} from "../src/clients.mjs";

const AUTHORIZATION = "user-approved-pool-remaining-23-a1fd74f1b0d169077f374eaf1dcd0f2cd108371c67ce7b1bdcc562baf8494d65";
const ROLLOUT_MANIFEST_SHA256 = "a1fd74f1b0d169077f374eaf1dcd0f2cd108371c67ce7b1bdcc562baf8494d65";
const PREFLIGHT_SHA256 = "22f13f45bbd7e7eca2b1266a57cb7d39a57700aae373ac710e1e1b881af09781";
const BATCH_MANIFEST_SHA256 = "d60d0b25df9f6a68292c442687bcc445a0084a6d13bc50d96f6029ebef60a901";
const CANARY_RECEIPT_SHA256 = "c11a675b2c4ac7ac659866decc0d42f65455df359757f53d02fcbf1b0e395365";
const CANARY_SKU = "MNO006SS";
const BRAND_ID = 1410;
const MUTABLE_META = new Set([
  "_enki_pool_rollout_manifest_sha256",
  "_enki_pool_rollout_bundle_sha256",
  "_enki_pool_rollout_approval",
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
  for (const required of ["--manifest", "--preflight", "--bundle-root", "--canary-receipt", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply === verifyOnly) throw new Error("Use exactly one of --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) throw new Error("Exact remaining-23 publication authorization marker is required");
  return {
    apply,
    verifyOnly,
    manifestPath: resolve(values.get("--manifest")),
    preflightPath: resolve(values.get("--preflight")),
    bundleRoot: resolve(values.get("--bundle-root")),
    canaryReceiptPath: resolve(values.get("--canary-receipt")),
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

async function loadReviewedProducts(root) {
  const batchBytes = await readFile(join(root, "batch-manifest.json"));
  if (sha256(batchBytes) !== BATCH_MANIFEST_SHA256) throw new Error("Reviewed v16 batch manifest hash mismatch");
  const batch = JSON.parse(batchBytes);
  const productsBySku = new Map();
  const bundleHashBySku = new Map();
  for (const row of batch.bundles ?? []) {
    const bytes = await readFile(join(root, row.path));
    if (sha256(bytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    for (const product of JSON.parse(bytes).products ?? []) {
      productsBySku.set(product.sku, product);
      bundleHashBySku.set(product.sku, row.sha256);
    }
  }
  if (productsBySku.size !== 24) throw new Error("Reviewed Pool set must contain 24 parents");
  return {productsBySku, bundleHashBySku};
}

async function verifyFullScope(woo, manifest, productsBySku, bundleHashBySku, targetsPublished) {
  const rows = [];
  for (const target of manifest.targets) {
    const product = productsBySku.get(target.sku);
    if (!product || bundleHashBySku.get(target.sku) !== target.bundleSha256) throw new Error(`Manifest identity drift for ${target.sku}`);
    const live = await resolveLive(woo, target.sku);
    verifyReviewedFields(product, live);
    const expectedStatus = targetsPublished ? "publish" : "draft";
    const expectedVisibility = targetsPublished ? "visible" : "hidden";
    if (Number(live.parent.id) !== target.externalId || live.parent.status !== expectedStatus
      || live.parent.catalog_visibility !== expectedVisibility) {
      throw new Error(`Publication state drift for ${target.sku}`);
    }
    rows.push({target, product, live});
  }
  const canaryProduct = productsBySku.get(CANARY_SKU);
  const canaryLive = await resolveLive(woo, CANARY_SKU);
  verifyReviewedFields(canaryProduct, canaryLive);
  if (canaryLive.parent.status !== "publish" || canaryLive.parent.catalog_visibility !== "visible") {
    throw new Error("Public canary state drift");
  }
  return {rows, canaryLive};
}

function publishBody(parent, bundleSha256) {
  return {
    status: "publish",
    catalog_visibility: "visible",
    meta_data: [
      metaPatch(parent, "_enki_pool_rollout_manifest_sha256", ROLLOUT_MANIFEST_SHA256),
      metaPatch(parent, "_enki_pool_rollout_bundle_sha256", bundleSha256),
      metaPatch(parent, "_enki_pool_rollout_approval", AUTHORIZATION),
      metaPatch(parent, "_enki_approval_document", "chat-user-authorization-2026-09-21"),
      metaPatch(parent, "_enki_approval_revision", "v16-pool-remaining-23-publication"),
    ],
  };
}

async function loadJournal(path, manifest) {
  try {
    const journal = await readJson(path);
    if (journal.schema !== "enki-pool-remaining-23-publication-journal/v1"
      || journal.rolloutManifestSha256 !== ROLLOUT_MANIFEST_SHA256 || journal.authorization !== AUTHORIZATION) {
      throw new Error("Publication journal belongs to another approval");
    }
    return journal;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schema: "enki-pool-remaining-23-publication-journal/v1",
      rolloutManifestSha256: ROLLOUT_MANIFEST_SHA256,
      authorization: AUTHORIZATION,
      status: "pending",
      targets: Object.fromEntries(manifest.targets.map((target) => [target.sku, {externalId: target.externalId, state: "pending"}])),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [manifestBytes, preflightBytes, canaryReceiptBytes] = await Promise.all([
    readFile(args.manifestPath),
    readFile(args.preflightPath),
    readFile(args.canaryReceiptPath),
  ]);
  if (sha256(manifestBytes) !== ROLLOUT_MANIFEST_SHA256) throw new Error("Remaining-23 rollout manifest hash mismatch");
  if (sha256(preflightBytes) !== PREFLIGHT_SHA256) throw new Error("Remaining-23 preflight receipt hash mismatch");
  if (sha256(canaryReceiptBytes) !== CANARY_RECEIPT_SHA256) throw new Error("Public canary receipt hash mismatch");
  const manifest = JSON.parse(manifestBytes);
  const preflight = JSON.parse(preflightBytes);
  if (manifest.targets?.length !== 23 || manifest.gates?.publicationAuthorized !== false || manifest.externalWrites !== 0
    || preflight.summary?.targetsChecked !== 23 || preflight.summary?.failures !== 0 || preflight.externalWrites !== 0) {
    throw new Error("Reviewed zero-write rollout manifest and preflight are required");
  }
  const {productsBySku, bundleHashBySku} = await loadReviewedProducts(args.bundleRoot);
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  const journal = await loadJournal(args.journalPath, manifest);

  if (args.verifyOnly) {
    if (journal.status !== "complete") throw new Error("Cannot verify an incomplete rollout journal");
    const finalScope = await verifyFullScope(woo, manifest, productsBySku, bundleHashBySku, true);
    console.log(JSON.stringify({
      mode: "verify_only",
      parentsPublishedVisible: finalScope.rows.length + 1,
      rolloutTargetsPublishedVisible: finalScope.rows.length,
      variationsVerified: finalScope.rows.reduce((total, row) => total + row.live.variations.length, 0)
        + finalScope.canaryLive.variations.length,
      externalWrites: 0,
    }, null, 2));
    return;
  }

  if (journal.status !== "pending") throw new Error(`Rollout journal is ${journal.status}; refusing apply`);
  const beforeScope = await verifyFullScope(woo, manifest, productsBySku, bundleHashBySku, false);
  journal.status = "applying";
  await writeJsonAtomic(args.journalPath, journal);

  try {
    for (const row of beforeScope.rows) {
      const {target, product, live: beforeLive} = row;
      const beforeParent = stableParent(beforeLive.parent);
      const beforeVariations = stableVariations(beforeLive.variations);
      journal.targets[target.sku] = {
        externalId: target.externalId,
        state: "applying",
        beforeFingerprint: sha256(Buffer.from(JSON.stringify({parent: beforeParent, variations: beforeVariations}))),
      };
      await writeJsonAtomic(args.journalPath, journal);

      await woo.request("PUT", `/products/${target.externalId}`, {body: publishBody(beforeLive.parent, target.bundleSha256)});
      const afterLive = await resolveLive(woo, target.sku);
      verifyReviewedFields(product, afterLive);
      if (afterLive.parent.status !== "publish" || afterLive.parent.catalog_visibility !== "visible") {
        throw new Error(`Publication readback mismatch for ${target.sku}`);
      }
      if (!same(beforeParent, stableParent(afterLive.parent)) || !same(beforeVariations, stableVariations(afterLive.variations))) {
        throw new Error(`Untouched field drift during publication for ${target.sku}`);
      }
      if (metaValue(afterLive.parent, "_enki_pool_rollout_manifest_sha256") !== ROLLOUT_MANIFEST_SHA256
        || metaValue(afterLive.parent, "_enki_pool_rollout_bundle_sha256") !== target.bundleSha256
        || metaValue(afterLive.parent, "_enki_pool_rollout_approval") !== AUTHORIZATION) {
        throw new Error(`Publication provenance mismatch for ${target.sku}`);
      }
      journal.targets[target.sku].state = "complete";
      journal.targets[target.sku].after = {status: "publish", catalogVisibility: "visible"};
      await writeJsonAtomic(args.journalPath, journal);
      const completed = Object.values(journal.targets).filter((entry) => entry.state === "complete").length;
      console.log(JSON.stringify({progress: `${completed}/23`, sku: target.sku, status: "publish", catalogVisibility: "visible"}));
    }

    const finalScope = await verifyFullScope(woo, manifest, productsBySku, bundleHashBySku, true);
    const receipt = {
      schema: "enki-pool-remaining-23-publication-verification/v1",
      rolloutManifestSha256: ROLLOUT_MANIFEST_SHA256,
      preflightReceiptSha256: PREFLIGHT_SHA256,
      batchManifestSha256: BATCH_MANIFEST_SHA256,
      canaryReceiptSha256: CANARY_RECEIPT_SHA256,
      authorization: AUTHORIZATION,
      targets: finalScope.rows.map(({target, live}) => ({
        sku: target.sku,
        externalId: target.externalId,
        status: live.parent.status,
        catalogVisibility: live.parent.catalog_visibility,
        canonicalUrl: String(live.parent.permalink ?? ""),
        variations: live.variations.length,
        variationStatuses: [...new Set(live.variations.map((variation) => variation.status))],
      })),
      canary: {sku: CANARY_SKU, status: "publish", catalogVisibility: "visible"},
      summary: {
        parentsPublishedVisible: finalScope.rows.length + 1,
        rolloutTargetsPublishedVisible: finalScope.rows.length,
        variationsVerified: finalScope.rows.reduce((total, row) => total + row.live.variations.length, 0)
          + finalScope.canaryLive.variations.length,
        variationsPublish: true,
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
    journal.status = "complete";
    journal.summary = receipt.summary;
    await writeJsonAtomic(args.journalPath, journal);
    console.log(JSON.stringify({status: "complete", ...receipt.summary}, null, 2));
  } catch (error) {
    journal.status = "uncertain";
    journal.error = error instanceof Error ? error.message : String(error);
    await writeJsonAtomic(args.journalPath, journal);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
