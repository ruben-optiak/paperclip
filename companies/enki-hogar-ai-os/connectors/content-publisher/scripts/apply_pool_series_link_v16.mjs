#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {WooCommerceProductClient} from "../src/clients.mjs";

const AUTHORIZATION = "user-approved-pool-v16-series-link-layout-2026-09-21";
const CURRENT_MANIFEST_SHA256 = "a0c563d2e329a1e2546fca4df308b2ddf32b372e6c74b22228858f5433730996";
const CANDIDATE_MANIFEST_SHA256 = "d60d0b25df9f6a68292c442687bcc445a0084a6d13bc50d96f6029ebef60a901";
const BRAND_ID = 1410;
const SEARCH_URL = "https://www.enkihogar.com/?s=Sanycces+Pool&amp;post_type=product";
const LINK_TEXT = "Ver todos los productos de la serie Pool de Sanycces";
const BEFORE = `<p>La colección incluye grifos de lavabo y bidé, soluciones murales, grifería de bañera, columnas, termostáticos, rociadores y cuerpos empotrados compatibles. <a href="${SEARCH_URL}">${LINK_TEXT}</a>.</p>`;
const AFTER = `<p>La colección incluye grifos de lavabo y bidé, soluciones murales, grifería de bañera, columnas, termostáticos, rociadores y cuerpos empotrados compatibles.</p><p><a href="${SEARCH_URL}">${LINK_TEXT}</a></p>`;
const MUTABLE_META = new Set([
  "_enki_product_bundle_sha256",
  "_enki_approval_document",
  "_enki_approval_revision",
  "_enki_series_link_batch_sha256",
  "_enki_series_link_approval",
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
  for (const required of ["--current-bundle-root", "--candidate-bundle-root", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply && verifyOnly) throw new Error("Use either --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) {
    throw new Error("Exact Pool v16 series-link authorization marker is required for --apply");
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

async function loadBatch(root, expectedSha256) {
  const manifestBytes = await readFile(join(root, "batch-manifest.json"));
  if (sha256(manifestBytes) !== expectedSha256) throw new Error("Batch manifest hash mismatch");
  const manifest = JSON.parse(manifestBytes);
  const products = [];
  for (const row of manifest.bundles ?? []) {
    const bytes = await readFile(join(root, row.path));
    if (sha256(bytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    for (const product of JSON.parse(bytes).products) products.push({product, bundleSha256: row.sha256});
  }
  if (products.length !== 24 || new Set(products.map((entry) => entry.product.sku)).size !== 24) {
    throw new Error("Pool batch must contain exactly 24 unique parents");
  }
  return products;
}

function withoutDescription(product) {
  const clone = structuredClone(product);
  delete clone.descriptionHtml;
  return clone;
}

function approvedChanges(currentEntries, candidateEntries) {
  const currentBySku = new Map(currentEntries.map((entry) => [entry.product.sku, entry]));
  const changes = candidateEntries.map((candidate) => {
    const current = currentBySku.get(candidate.product.sku);
    if (!current || !same(withoutDescription(current.product), withoutDescription(candidate.product))) {
      throw new Error(`Unapproved non-description drift: ${candidate.product.sku}`);
    }
    const before = current.product.descriptionHtml;
    const after = candidate.product.descriptionHtml;
    if (before.split(BEFORE).length !== 2 || after.split(AFTER).length !== 2
      || normalizeHtml(before.replace(BEFORE, AFTER)) !== normalizeHtml(after)) {
      throw new Error(`Series-link layout drift: ${candidate.product.sku}`);
    }
    return {
      sku: candidate.product.sku,
      before: current.product,
      after: candidate.product,
      candidateBundleSha256: candidate.bundleSha256,
    };
  });
  if (changes.length !== 24) throw new Error("Approved v16 scope must be exactly 24 descriptions");
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

function verifyIdentity(change, live) {
  const expected = change.before;
  const parent = live.parent;
  if (parent.status !== "draft" || parent.catalog_visibility !== "hidden" || parent.type !== expected.type
    || parent.name !== expected.name || parent.slug !== expected.slug || parent.sku !== expected.sku
    || normalizeHtml(parent.short_description) !== normalizeHtml(expected.shortDescriptionHtml)
    || !same(ids(parent.categories), [...expected.categories].sort((left, right) => left - right))
    || !ids(parent.brands).includes(BRAND_ID)
    || metaValue(parent, "_yoast_wpseo_title") !== expected.seo.title
    || metaValue(parent, "_yoast_wpseo_metadesc") !== expected.seo.description
    || metaValue(parent, "_yoast_wpseo_focuskw") !== expected.seo.focusKeyword) {
    throw new Error(`Live parent safety gate failed for ${change.sku}`);
  }
  const expectedSkus = (expected.variations ?? []).map((variation) => variation.sku).sort();
  const actualSkus = live.variations.map((variation) => variation.sku).sort();
  if (!same(expectedSkus, actualSkus) || !live.variations.every((variation) => variation.status === "publish")) {
    throw new Error(`Live variation identity/status drift for ${change.sku}`);
  }
}

function state(change, parent) {
  const description = normalizeHtml(parent.description);
  return {
    isBefore: description === normalizeHtml(change.before.descriptionHtml),
    isAfter: description === normalizeHtml(change.after.descriptionHtml),
  };
}

function updateBody(change, parent) {
  return {
    status: "draft",
    catalog_visibility: "hidden",
    description: change.after.descriptionHtml,
    meta_data: [
      metaPatch(parent, "_enki_product_bundle_sha256", change.candidateBundleSha256),
      metaPatch(parent, "_enki_approval_document", "chat-user-authorization-2026-09-21"),
      metaPatch(parent, "_enki_approval_revision", "v16-series-link-layout"),
      metaPatch(parent, "_enki_series_link_batch_sha256", CANDIDATE_MANIFEST_SHA256),
      metaPatch(parent, "_enki_series_link_approval", AUTHORIZATION),
    ],
  };
}

function verifyAfter(change, beforeLive, afterLive) {
  verifyIdentity(change, afterLive);
  if (!state(change, afterLive.parent).isAfter) throw new Error(`Description readback mismatch for ${change.sku}`);
  if (!same(stableParent(beforeLive.parent), stableParent(afterLive.parent))) {
    throw new Error(`Untouched parent fields changed for ${change.sku}`);
  }
  if (!same(stableVariations(beforeLive.variations), stableVariations(afterLive.variations))) {
    throw new Error(`Variation drift after parent update for ${change.sku}`);
  }
  if (metaValue(afterLive.parent, "_enki_series_link_batch_sha256") !== CANDIDATE_MANIFEST_SHA256
    || metaValue(afterLive.parent, "_enki_series_link_approval") !== AUTHORIZATION
    || metaValue(afterLive.parent, "_enki_approval_revision") !== "v16-series-link-layout"
    || metaValue(afterLive.parent, "_enki_product_bundle_sha256") !== change.candidateBundleSha256) {
    throw new Error(`Approval provenance readback mismatch for ${change.sku}`);
  }
}

async function loadJournal(path) {
  try {
    const journal = await readJson(path);
    if (journal.schema !== "enki-pool-v16-series-link-update-journal/v1"
      || journal.batchManifestSha256 !== CANDIDATE_MANIFEST_SHA256 || journal.authorization !== AUTHORIZATION) {
      throw new Error("Series-link journal belongs to another approval");
    }
    return journal;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schema: "enki-pool-v16-series-link-update-journal/v1",
      batchManifestSha256: CANDIDATE_MANIFEST_SHA256,
      expectedCurrentManifestSha256: CURRENT_MANIFEST_SHA256,
      authorization: AUTHORIZATION,
      status: "in_progress",
      products: {},
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [currentEntries, candidateEntries] = await Promise.all([
    loadBatch(args.currentRoot, CURRENT_MANIFEST_SHA256),
    loadBatch(args.candidateRoot, CANDIDATE_MANIFEST_SHA256),
  ]);
  const changes = approvedChanges(currentEntries, candidateEntries);
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  const journal = await loadJournal(args.journalPath);
  if (args.verifyOnly && journal.status !== "complete") throw new Error("Cannot verify an incomplete series-link journal");
  if (args.apply) await writeJsonAtomic(args.journalPath, journal);

  const receiptProducts = [];
  for (const change of changes) {
    const live = await resolveLive(woo, change);
    verifyIdentity(change, live);
    const currentState = state(change, live.parent);
    const journalRow = journal.products[change.sku];
    if (args.verifyOnly || journalRow?.status === "verified") {
      if (!currentState.isAfter || journalRow?.status !== "verified") throw new Error(`Verified state mismatch for ${change.sku}`);
    } else if (!currentState.isBefore) {
      throw new Error(`Unreconciled description state for ${change.sku}`);
    }

    let verified = live;
    if (args.apply && !journalRow?.status) {
      journal.products[change.sku] = {
        parentId: Number(live.parent.id),
        status: "applying",
        beforeDescriptionSha256: sha256(Buffer.from(normalizeHtml(change.before.descriptionHtml))),
        afterDescriptionSha256: sha256(Buffer.from(normalizeHtml(change.after.descriptionHtml))),
      };
      await writeJsonAtomic(args.journalPath, journal);
      await woo.request("PUT", `/products/${live.parent.id}`, {body: updateBody(change, live.parent)});
      verified = await resolveLive(woo, change);
      verifyAfter(change, live, verified);
      journal.products[change.sku].status = "verified";
      await writeJsonAtomic(args.journalPath, journal);
      console.log(JSON.stringify({updated: change.sku, changeType: "series_link_new_paragraph"}));
    } else if (args.apply && journalRow?.status === "applying") {
      throw new Error(`Uncertain prior write for ${change.sku}; reconcile before retrying`);
    }

    const finalState = state(change, verified.parent);
    if ((args.apply || args.verifyOnly) && !finalState.isAfter) throw new Error(`Final state mismatch for ${change.sku}`);
    receiptProducts.push({
      sku: change.sku,
      externalId: Number(verified.parent.id),
      status: verified.parent.status,
      catalogVisibility: verified.parent.catalog_visibility,
      variations: verified.variations.length,
      variationStatuses: [...new Set(verified.variations.map((variation) => variation.status))],
      descriptionMatchesV16: finalState.isAfter,
      candidateBundleSha256: change.candidateBundleSha256,
    });
  }

  if (!args.apply && !args.verifyOnly) {
    console.log(JSON.stringify({
      mode: "dry_run",
      candidateManifestSha256: CANDIDATE_MANIFEST_SHA256,
      parentsChecked: 24,
      descriptionsToUpdate: 24,
      variationsObserved: receiptProducts.reduce((total, row) => total + row.variations, 0),
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
      schema: "enki-pool-v16-series-link-live-verification/v1",
      batchManifestSha256: CANDIDATE_MANIFEST_SHA256,
      expectedCurrentManifestSha256: CURRENT_MANIFEST_SHA256,
      authorization: AUTHORIZATION,
      products: receiptProducts,
      summary: {
        parentsUpdated: 24,
        descriptionsUpdated: 24,
        parentsDraftHidden: receiptProducts.every((row) => row.status === "draft" && row.catalogVisibility === "hidden"),
        variationsObserved: receiptProducts.reduce((total, row) => total + row.variations, 0),
        variationsPublish: receiptProducts.every((row) => row.variationStatuses.every((status) => status === "publish")),
        pricesChanged: 0,
        stockChanged: 0,
        mediaChanged: 0,
        metadataSeoChanged: 0,
        taxonomyChanged: 0,
        failures: 0,
      },
    };
    await writeJsonAtomic(args.receiptPath, receipt);
    console.log(JSON.stringify({status: "complete", ...receipt.summary}, null, 2));
    return;
  }

  const receipt = await readJson(args.receiptPath);
  if (receipt.schema !== "enki-pool-v16-series-link-live-verification/v1" || receipt.summary?.failures !== 0) {
    throw new Error("Series-link receipt is incomplete");
  }
  console.log(JSON.stringify({
    mode: "verify_only",
    batchManifestSha256: CANDIDATE_MANIFEST_SHA256,
    parentsVerified: receiptProducts.length,
    variationsVerified: receiptProducts.reduce((total, row) => total + row.variations, 0),
    parentsDraftHidden: true,
    variationsPublish: true,
    externalWrites: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
