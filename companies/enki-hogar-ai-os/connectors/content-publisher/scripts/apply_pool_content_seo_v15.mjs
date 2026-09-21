#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";

import {WooCommerceProductClient} from "../src/clients.mjs";

const AUTHORIZATION = "user-approved-pool-v15-content-seo-2026-09-21";
const APPROVED_BATCH_SHA256 = "a0c563d2e329a1e2546fca4df308b2ddf32b372e6c74b22228858f5433730996";
const EXPECTED_CURRENT_SHA256 = "755b910002d2fbe83de6295f0b85170e866429f37994d7893291934aa59e3af0";
const BRAND_ID = 1410;
const META_SKUS = new Set(["MEN000SS", "MH2000SS", "RAC00012SS", "TH2000SS"]);
const DESCRIPTION_SKUS = new Set([
  "MBD006SS",
  "MEN006R14SS",
  "MEN006R18SS",
  "MEN006S14SS",
  "MEN006S18SS",
  "MEX006SS",
  "MNO006SS",
  "MOA006SS",
]);
const MUTABLE_META_KEYS = new Set([
  "_yoast_wpseo_metadesc",
  "_enki_product_bundle_sha256",
  "_enki_approval_document",
  "_enki_approval_revision",
  "_enki_content_seo_batch_sha256",
  "_enki_content_seo_approval",
]);

function digest(bytes) {
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
  for (const required of ["--current-bundle-root", "--candidate-bundle-root", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply && verifyOnly) throw new Error("Use either --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) {
    throw new Error("Exact Pool v15 content/SEO authorization marker is required for --apply");
  }
  return {
    apply,
    verifyOnly,
    currentRoot: resolve(values.get("--current-bundle-root")),
    candidateRoot: resolve(values.get("--candidate-bundle-root")),
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

function metaRows(row, key) {
  return (row?.meta_data ?? []).filter((item) => item?.key === key);
}

function metaValue(row, key) {
  return String(metaRows(row, key).at(-1)?.value ?? "");
}

function metaPatch(row, key, value, {mustExist = false} = {}) {
  const matches = metaRows(row, key);
  if (matches.length > 1) throw new Error(`Duplicate live metadata key ${key} on ${row.sku}`);
  if (mustExist && matches.length !== 1) throw new Error(`Required live metadata key ${key} is missing on ${row.sku}`);
  const id = Number(matches[0]?.id);
  return {...(Number.isSafeInteger(id) ? {id} : {}), key, value};
}

function inventory(row) {
  return {
    manageStock: row?.manage_stock === true,
    stockQuantity: row?.stock_quantity === null || row?.stock_quantity === undefined ? null : Number(row.stock_quantity),
    stockStatus: String(row?.stock_status ?? ""),
  };
}

function stableParent(row) {
  const stableMeta = Object.fromEntries((row?.meta_data ?? [])
    .filter((item) => !MUTABLE_META_KEYS.has(String(item?.key ?? "")))
    .map((item) => [String(item.key), String(item.value ?? "")])
    .sort(([left], [right]) => left.localeCompare(right)));
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    type: String(row.type ?? ""),
    status: String(row.status ?? ""),
    catalogVisibility: String(row.catalog_visibility ?? ""),
    sku: String(row.sku ?? ""),
    globalUniqueId: String(row.global_unique_id ?? ""),
    shortDescription: normalizeHtml(row.short_description),
    categoryIds: ids(row.categories),
    brandIds: ids(row.brands),
    tagIds: ids(row.tags),
    attributes: normalizedAttributes(row.attributes),
    regularPrice: String(row.regular_price ?? ""),
    salePrice: String(row.sale_price ?? ""),
    inventory: inventory(row),
    imageIds: orderedIds(row.images),
    defaultAttributes: row.default_attributes ?? [],
    yoastTitle: metaValue(row, "_yoast_wpseo_title"),
    yoastFocusKeyword: metaValue(row, "_yoast_wpseo_focuskw"),
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

async function loadBatch(root) {
  const manifestBytes = await readFile(join(root, "batch-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const products = [];
  for (const row of manifest.bundles ?? []) {
    const path = join(root, row.path);
    const bytes = await readFile(path);
    if (digest(bytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    for (const product of JSON.parse(bytes).products) {
      products.push({product, bundleSha256: row.sha256, bundleRoot: dirname(path)});
    }
  }
  if (products.length !== 24 || new Set(products.map((entry) => entry.product.sku)).size !== 24) {
    throw new Error("Pool batch must contain exactly 24 unique parents");
  }
  return {manifest, manifestSha256: digest(manifestBytes), products};
}

function strippedProduct(product) {
  const clone = structuredClone(product);
  delete clone.descriptionHtml;
  delete clone.seo.description;
  return clone;
}

function approvedChanges(current, candidate) {
  if (current.manifestSha256 !== EXPECTED_CURRENT_SHA256) throw new Error("Expected-current v14 manifest hash mismatch");
  if (candidate.manifestSha256 !== APPROVED_BATCH_SHA256) throw new Error("Approved v15 manifest hash mismatch");
  const currentBySku = new Map(current.products.map((entry) => [entry.product.sku, entry]));
  const changes = [];
  for (const candidateEntry of candidate.products) {
    const currentEntry = currentBySku.get(candidateEntry.product.sku);
    if (!currentEntry) throw new Error(`Current product missing: ${candidateEntry.product.sku}`);
    const before = currentEntry.product;
    const after = candidateEntry.product;
    if (!same(strippedProduct(before), strippedProduct(after))) throw new Error(`Unapproved product-field drift: ${after.sku}`);
    const descriptionChanged = normalizeHtml(before.descriptionHtml) !== normalizeHtml(after.descriptionHtml);
    const metaChanged = before.seo.description !== after.seo.description;
    const expectedDescriptionChange = DESCRIPTION_SKUS.has(after.sku);
    const expectedMetaChange = META_SKUS.has(after.sku);
    if (descriptionChanged !== expectedDescriptionChange || metaChanged !== expectedMetaChange || (descriptionChanged && metaChanged)) {
      throw new Error(`Content/SEO change scope drift: ${after.sku}`);
    }
    if (descriptionChanged || metaChanged) changes.push({
      sku: after.sku,
      before,
      after,
      candidateBundleSha256: candidateEntry.bundleSha256,
      changeType: metaChanged ? "meta_description" : "description_html",
    });
  }
  if (changes.length !== 12 || changes.filter((item) => item.changeType === "meta_description").length !== 4
    || changes.filter((item) => item.changeType === "description_html").length !== 8) {
    throw new Error("Approved v15 scope must be exactly four meta and eight description changes");
  }
  return changes.sort((left, right) => left.sku.localeCompare(right.sku));
}

async function resolveLive(woo, change) {
  const rows = await woo.request("GET", "/products", {params: {sku: change.sku, status: "any", per_page: 10}});
  const exact = rows.filter((row) => row?.sku === change.sku);
  if (exact.length !== 1) throw new Error(`Expected exactly one live parent for ${change.sku}`);
  const parent = exact[0];
  const variations = parent.type === "variable"
    ? await woo.request("GET", `/products/${parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
    : [];
  return {parent, variations};
}

function verifyBase(change, live) {
  const {before} = change;
  const parent = live.parent;
  if (parent.status !== "draft" || parent.catalog_visibility !== "hidden" || parent.type !== before.type
    || parent.name !== before.name || parent.slug !== before.slug || parent.sku !== before.sku
    || normalizeHtml(parent.short_description) !== normalizeHtml(before.shortDescriptionHtml)
    || !same(ids(parent.categories), [...before.categories].sort((left, right) => left - right))
    || !ids(parent.brands).includes(BRAND_ID)
    || metaValue(parent, "_yoast_wpseo_title") !== before.seo.title
    || metaValue(parent, "_yoast_wpseo_focuskw") !== before.seo.focusKeyword) {
    throw new Error(`Live parent safety gate failed for ${change.sku}`);
  }
  const expectedVariationSkus = (before.variations ?? []).map((variation) => variation.sku).sort();
  const actualVariationSkus = live.variations.map((variation) => variation.sku).sort();
  if (!same(expectedVariationSkus, actualVariationSkus) || !live.variations.every((variation) => variation.status === "publish")) {
    throw new Error(`Live variation identity/status drift for ${change.sku}`);
  }
}

function contentState(change, parent) {
  const description = normalizeHtml(parent.description);
  const metaDescription = metaValue(parent, "_yoast_wpseo_metadesc");
  const isBefore = description === normalizeHtml(change.before.descriptionHtml) && metaDescription === change.before.seo.description;
  const isAfter = description === normalizeHtml(change.after.descriptionHtml) && metaDescription === change.after.seo.description;
  return {isBefore, isAfter};
}

function updateBody(change, parent) {
  const metaData = [
    metaPatch(parent, "_enki_product_bundle_sha256", change.candidateBundleSha256),
    metaPatch(parent, "_enki_approval_document", "chat-user-authorization-2026-09-21"),
    metaPatch(parent, "_enki_approval_revision", "v15-content-seo-review"),
    metaPatch(parent, "_enki_content_seo_batch_sha256", APPROVED_BATCH_SHA256),
    metaPatch(parent, "_enki_content_seo_approval", AUTHORIZATION),
  ];
  if (change.changeType === "meta_description") {
    metaData.unshift(metaPatch(parent, "_yoast_wpseo_metadesc", change.after.seo.description, {mustExist: true}));
  }
  return {
    status: "draft",
    catalog_visibility: "hidden",
    ...(change.changeType === "description_html" ? {description: change.after.descriptionHtml} : {}),
    meta_data: metaData,
  };
}

function verifyAfter(change, beforeLive, afterLive) {
  verifyBase(change, afterLive);
  const state = contentState(change, afterLive.parent);
  if (!state.isAfter) throw new Error(`Content/SEO readback mismatch for ${change.sku}`);
  if (!same(stableParent(beforeLive.parent), stableParent(afterLive.parent))) {
    throw new Error(`Untouched parent fields changed for ${change.sku}`);
  }
  if (!same(stableVariations(beforeLive.variations), stableVariations(afterLive.variations))) {
    throw new Error(`Variation drift after parent update for ${change.sku}`);
  }
  if (metaValue(afterLive.parent, "_enki_content_seo_batch_sha256") !== APPROVED_BATCH_SHA256
    || metaValue(afterLive.parent, "_enki_content_seo_approval") !== AUTHORIZATION
    || metaValue(afterLive.parent, "_enki_approval_revision") !== "v15-content-seo-review"
    || metaValue(afterLive.parent, "_enki_product_bundle_sha256") !== change.candidateBundleSha256) {
    throw new Error(`Approval provenance readback mismatch for ${change.sku}`);
  }
}

async function loadJournal(path) {
  try {
    const journal = await readJson(path);
    if (journal.schema !== "enki-pool-v15-content-seo-update-journal/v1"
      || journal.batchManifestSha256 !== APPROVED_BATCH_SHA256 || journal.authorization !== AUTHORIZATION) {
      throw new Error("Content/SEO journal belongs to another approval");
    }
    return journal;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schema: "enki-pool-v15-content-seo-update-journal/v1",
      batchManifestSha256: APPROVED_BATCH_SHA256,
      expectedCurrentManifestSha256: EXPECTED_CURRENT_SHA256,
      authorization: AUTHORIZATION,
      status: "in_progress",
      products: {},
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [current, candidate] = await Promise.all([loadBatch(args.currentRoot), loadBatch(args.candidateRoot)]);
  const changes = approvedChanges(current, candidate);
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  const journal = await loadJournal(args.journalPath);
  if (args.verifyOnly && journal.status !== "complete") throw new Error("Cannot verify an incomplete content/SEO journal");
  if (args.apply) await writeJsonAtomic(args.journalPath, journal);

  const receiptProducts = [];
  for (const change of changes) {
    const live = await resolveLive(woo, change);
    verifyBase(change, live);
    const state = contentState(change, live.parent);
    const journalRow = journal.products[change.sku];
    if (args.verifyOnly || journalRow?.status === "verified") {
      if (!state.isAfter || journalRow?.status !== "verified") throw new Error(`Verified state mismatch for ${change.sku}`);
    } else if (!state.isBefore) {
      throw new Error(`Unreconciled content/SEO state for ${change.sku}`);
    }

    let verified = live;
    if (args.apply && !journalRow?.status) {
      journal.products[change.sku] = {
        parentId: Number(live.parent.id),
        changeType: change.changeType,
        status: "applying",
        beforeDescriptionSha256: digest(Buffer.from(normalizeHtml(change.before.descriptionHtml))),
        afterDescriptionSha256: digest(Buffer.from(normalizeHtml(change.after.descriptionHtml))),
        beforeMetaDescriptionSha256: digest(Buffer.from(change.before.seo.description)),
        afterMetaDescriptionSha256: digest(Buffer.from(change.after.seo.description)),
      };
      await writeJsonAtomic(args.journalPath, journal);
      await woo.request("PUT", `/products/${live.parent.id}`, {body: updateBody(change, live.parent)});
      verified = await resolveLive(woo, change);
      verifyAfter(change, live, verified);
      journal.products[change.sku].status = "verified";
      await writeJsonAtomic(args.journalPath, journal);
      console.log(JSON.stringify({updated: change.sku, changeType: change.changeType}));
    } else if (args.apply && journalRow?.status === "applying") {
      throw new Error(`Uncertain prior write for ${change.sku}; reconcile before retrying`);
    }

    const verifiedState = contentState(change, verified.parent);
    if ((args.verifyOnly || args.apply) && !verifiedState.isAfter) throw new Error(`Final state mismatch for ${change.sku}`);
    receiptProducts.push({
      sku: change.sku,
      externalId: Number(verified.parent.id),
      changeType: change.changeType,
      status: verified.parent.status,
      catalogVisibility: verified.parent.catalog_visibility,
      variations: verified.variations.length,
      variationStatuses: [...new Set(verified.variations.map((variation) => variation.status))],
      descriptionMatchesV15: normalizeHtml(verified.parent.description) === normalizeHtml(change.after.descriptionHtml),
      metaDescriptionMatchesV15: metaValue(verified.parent, "_yoast_wpseo_metadesc") === change.after.seo.description,
      candidateBundleSha256: change.candidateBundleSha256,
    });
  }

  if (!args.apply && !args.verifyOnly) {
    console.log(JSON.stringify({
      mode: "dry_run",
      approvedBatchManifestSha256: APPROVED_BATCH_SHA256,
      parentsChecked: changes.length,
      descriptionUpdates: changes.filter((item) => item.changeType === "description_html").length,
      metaDescriptionUpdates: changes.filter((item) => item.changeType === "meta_description").length,
      parentsRemainDraftHidden: true,
      variationsRemainPublish: true,
      externalWrites: 0,
    }, null, 2));
    return;
  }

  if (args.apply) {
    journal.status = "complete";
    await writeJsonAtomic(args.journalPath, journal);
    const receipt = {
      schema: "enki-pool-v15-content-seo-live-verification/v1",
      batchManifestSha256: APPROVED_BATCH_SHA256,
      expectedCurrentManifestSha256: EXPECTED_CURRENT_SHA256,
      authorization: AUTHORIZATION,
      products: receiptProducts,
      summary: {
        parentsUpdated: 12,
        descriptionsUpdated: 8,
        metaDescriptionsUpdated: 4,
        parentsDraftHidden: receiptProducts.every((row) => row.status === "draft" && row.catalogVisibility === "hidden"),
        variationsObserved: receiptProducts.reduce((total, row) => total + row.variations, 0),
        variationsPublish: receiptProducts.every((row) => row.variationStatuses.every((status) => status === "publish")),
        pricesChanged: 0,
        stockChanged: 0,
        mediaChanged: 0,
        taxonomyChanged: 0,
        failures: 0,
      },
    };
    await writeJsonAtomic(args.receiptPath, receipt);
    console.log(JSON.stringify({status: "complete", ...receipt.summary}, null, 2));
    return;
  }

  const receipt = await readJson(args.receiptPath);
  if (receipt.schema !== "enki-pool-v15-content-seo-live-verification/v1" || receipt.summary?.failures !== 0) {
    throw new Error("Content/SEO receipt is incomplete");
  }
  console.log(JSON.stringify({
    mode: "verify_only",
    batchManifestSha256: APPROVED_BATCH_SHA256,
    parentsVerified: receiptProducts.length,
    parentsDraftHidden: true,
    variationsPublish: true,
    externalWrites: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
