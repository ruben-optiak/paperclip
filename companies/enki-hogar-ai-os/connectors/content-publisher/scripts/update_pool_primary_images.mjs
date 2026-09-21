#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {
  WordPressMediaClient,
  WooCommerceProductClient,
} from "../src/clients.mjs";

const AUTHORIZATION = "user-approved-all-pool-primary-images-2026-09-21";
const BRAND_ID = 1410;
const SHA256 = /^[0-9a-f]{64}$/;

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
  for (const required of ["--bundle-root", "--review", "--expected-current-journal", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply && verifyOnly) throw new Error("Use either --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) {
    throw new Error("Exact approved-primary-image authorization marker is required for --apply");
  }
  return {
    apply,
    verifyOnly,
    bundleRoot: resolve(values.get("--bundle-root")),
    reviewPath: resolve(values.get("--review")),
    expectedCurrentJournalPath: resolve(values.get("--expected-current-journal")),
    journalPath: resolve(values.get("--journal")),
    receiptPath: resolve(values.get("--receipt")),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

async function loadProducts(root) {
  const manifestPath = join(root, "batch-manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.summary?.readyProducts !== 24 || manifest.summary?.sellableSkus !== 44 || manifest.bundles?.length !== 5) {
    throw new Error("Approved primary-image batch must contain exactly 24 parents and 44 sellable SKUs");
  }
  const products = [];
  for (const row of manifest.bundles) {
    const bundlePath = join(root, row.path);
    const bundleBytes = await readFile(bundlePath);
    if (!SHA256.test(row.sha256) || digest(bundleBytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    const bundle = JSON.parse(bundleBytes);
    for (const product of bundle.products) products.push({product, bundleRoot: dirname(bundlePath)});
  }
  if (products.length !== 24 || new Set(products.map(({product}) => product.sku)).size !== 24) {
    throw new Error("Approved primary-image batch parent identity drift");
  }
  return {manifestSha256: digest(manifestBytes), products};
}

function ids(values) {
  return (values ?? []).map((item) => Number(item?.id)).filter(Number.isSafeInteger);
}

function inventory(row) {
  return {
    manageStock: row.manage_stock === true,
    stockQuantity: row.stock_quantity === null || row.stock_quantity === undefined ? null : Number(row.stock_quantity),
    stockStatus: String(row.stock_status),
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizedHtml(value) {
  return String(value ?? "").trim().replace(/>\s+</g, "><");
}

function approvedImagePositions(product) {
  const primary = product.images.find((image) => image.position === 0 && image.gallery !== false);
  if (!primary) throw new Error(`Primary NB image missing for ${product.sku}`);
  if (product.type === "simple") return [{finish: "NB", image: primary}];
  const rm = product.images.find((image) => image.gallery === false);
  if (!rm) throw new Error(`RM variation image missing for ${product.sku}`);
  return [{finish: "NB", image: primary}, {finish: "RM", image: rm}];
}

function variationFinish(variation) {
  const option = variation.attributes?.find((attribute) => Number(attribute.id) === 15)?.option;
  if (option === "Níquel cepillado") return "NB";
  if (option === "Metal Raw") return "RM";
  throw new Error(`Unsupported Pool variation finish for ${variation.sku}`);
}

async function loadReview(path, products) {
  const bytes = await readFile(path);
  const review = JSON.parse(bytes);
  if (review.schema !== "enki-pool-primary-media-review/v1" || review.scope?.parents !== 24
    || review.scope?.candidateImages !== 44 || review.scope?.externalWrites !== 0) {
    throw new Error("Review manifest is outside the approved 24-parent/44-image scope");
  }
  const assets = new Map((review.assets ?? []).map((asset) => [`${asset.sku}:${asset.finish}`, asset]));
  if (assets.size !== 44) throw new Error("Review manifest must contain exactly 44 unique approved images");
  for (const {product, bundleRoot} of products) {
    for (const {finish, image} of approvedImagePositions(product)) {
      const asset = assets.get(`${product.sku}:${finish}`);
      if (!asset || asset.targetSha256 !== image.sha256) throw new Error(`Bundle/review image drift: ${product.sku}:${finish}`);
      const fileBytes = await readFile(join(bundleRoot, image.path));
      if (digest(fileBytes) !== image.sha256) throw new Error(`Approved image file drift: ${product.sku}:${finish}`);
    }
  }
  return {reviewSha256: digest(bytes), assets};
}

async function loadExpectedCurrentJournal(path, products) {
  const journal = await readJson(path);
  if (journal.schema !== "enki-pool-v12-update-journal/v1" || journal.status !== "complete") {
    throw new Error("Expected-current journal is not the completed v12 live update");
  }
  for (const {product} of products) {
    const row = journal.products?.[product.sku];
    if (!row || row.status !== "verified") throw new Error(`Expected-current media missing for ${product.sku}`);
    for (const image of product.images) {
      const expected = row.media?.[String(image.position)];
      if (!expected || !Number.isSafeInteger(expected.id)) throw new Error(`Expected-current image position missing: ${product.sku}:${image.position}`);
    }
  }
  return journal;
}

async function loadUpdateJournal(path, manifestSha256, reviewSha256) {
  try {
    const journal = await readJson(path);
    if (journal.schema !== "enki-pool-primary-image-update-journal/v1"
      || journal.batchManifestSha256 !== manifestSha256 || journal.reviewManifestSha256 !== reviewSha256) {
      throw new Error("Primary-image update journal belongs to another approved batch");
    }
    return journal;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schema: "enki-pool-primary-image-update-journal/v1",
      batchManifestSha256: manifestSha256,
      reviewManifestSha256: reviewSha256,
      authorization: AUTHORIZATION,
      status: "in_progress",
      products: {},
    };
  }
}

async function resolveLive(woo, product) {
  const rows = await woo.request("GET", "/products", {params: {sku: product.sku, status: "any", per_page: 10}});
  const exact = rows.filter((row) => row.sku === product.sku);
  if (exact.length !== 1) throw new Error(`Expected exactly one live parent for ${product.sku}`);
  const parent = exact[0];
  if (parent.status !== "draft" || parent.catalog_visibility !== "hidden" || parent.type !== product.type
    || !ids(parent.brands).includes(BRAND_ID) || parent.name !== product.name || parent.slug !== product.slug
    || !same(ids(parent.categories).sort((left, right) => left - right), [...product.categories].sort((left, right) => left - right))
    || normalizedHtml(parent.description) !== normalizedHtml(product.descriptionHtml)
    || normalizedHtml(parent.short_description) !== normalizedHtml(product.shortDescriptionHtml)) {
    throw new Error(`Live parent safety gate failed for ${product.sku}`);
  }
  const variations = product.type === "variable"
    ? await woo.request("GET", `/products/${parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
    : [];
  if (variations.length !== (product.variations?.length ?? 0)) throw new Error(`Live variation count drift for ${product.sku}`);
  const variationBySku = new Map(variations.map((variation) => [variation.sku, variation]));
  for (const expected of product.variations ?? []) {
    const live = variationBySku.get(expected.sku);
    if (!live || live.status !== "publish") throw new Error(`Live variation safety gate failed for ${expected.sku}`);
  }
  return {parent, variations, variationBySku};
}

function expectedGallery(product, currentJournalRow, updateJournalRow) {
  return [...product.images]
    .filter((image) => image.gallery !== false)
    .sort((left, right) => left.position - right.position)
    .map((image) => {
      if (image.position === 0 && updateJournalRow?.media?.NB) return updateJournalRow.media.NB.id;
      return currentJournalRow.media[String(image.position)].id;
    });
}

function allowedGallery(product, currentJournalRow, updateJournalRow) {
  const oldIds = [...product.images]
    .filter((image) => image.gallery !== false)
    .sort((left, right) => left.position - right.position)
    .map((image) => currentJournalRow.media[String(image.position)].id);
  if (!updateJournalRow?.media?.NB) return [oldIds];
  return [oldIds, expectedGallery(product, currentJournalRow, updateJournalRow)];
}

function verifyLive(product, live, currentJournalRow, updateJournalRow, beforeInventory) {
  const expectedIds = expectedGallery(product, currentJournalRow, updateJournalRow);
  const actualIds = ids(live.parent.images);
  if (!same(actualIds, expectedIds) || !same(inventory(live.parent), beforeInventory.parent)
    || live.parent.status !== "draft" || live.parent.catalog_visibility !== "hidden") {
    throw new Error(`Primary gallery or stock readback mismatch for ${product.sku}`);
  }
  for (const variation of product.variations ?? []) {
    const current = live.variationBySku.get(variation.sku);
    const finish = variationFinish(variation);
    const expectedId = updateJournalRow.media[finish].id;
    if (!current || current.status !== "publish" || Number(current.image?.id) !== expectedId
      || !same(inventory(current), beforeInventory.variations[variation.sku])) {
      throw new Error(`Variation image or stock readback mismatch for ${variation.sku}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {manifestSha256, products} = await loadProducts(args.bundleRoot);
  const {reviewSha256} = await loadReview(args.reviewPath, products);
  const currentJournal = await loadExpectedCurrentJournal(args.expectedCurrentJournalPath, products);
  const updateJournal = await loadUpdateJournal(args.journalPath, manifestSha256, reviewSha256);
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }
  const mediaClient = args.apply ? new WordPressMediaClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    mediaUsername: process.env.PRODUCT_MEDIA_USERNAME,
    mediaAppPassword: process.env.PRODUCT_MEDIA_APP_PASSWORD,
  }) : null;
  if (args.apply && (!process.env.PRODUCT_MEDIA_USERNAME || !process.env.PRODUCT_MEDIA_APP_PASSWORD)) {
    throw new Error("WordPress product-media credentials are incomplete");
  }

  const liveBySku = new Map();
  const inventoryBySku = new Map();
  for (const {product} of products) {
    const live = await resolveLive(woo, product);
    const current = currentJournal.products[product.sku];
    const update = updateJournal.products[product.sku];
    const allowed = allowedGallery(product, current, update);
    if (!allowed.some((gallery) => same(gallery, ids(live.parent.images)))) throw new Error(`Unexpected live gallery drift for ${product.sku}`);
    for (const variation of product.variations ?? []) {
      const row = live.variationBySku.get(variation.sku);
      const oldId = current.media[String(variation.imagePosition)].id;
      const finish = variationFinish(variation);
      const newId = update?.media?.[finish]?.id;
      if (![oldId, newId].filter(Number.isSafeInteger).includes(Number(row.image?.id))) {
        throw new Error(`Unexpected live variation image drift for ${variation.sku}`);
      }
    }
    liveBySku.set(product.sku, live);
    inventoryBySku.set(product.sku, {
      parent: inventory(live.parent),
      variations: Object.fromEntries(live.variations.map((variation) => [variation.sku, inventory(variation)])),
    });
  }

  if (!args.apply && !args.verifyOnly) {
    console.log(JSON.stringify({
      mode: "dry_run",
      batchManifestSha256: manifestSha256,
      reviewManifestSha256: reviewSha256,
      parentsChecked: products.length,
      variationsChecked: products.reduce((sum, entry) => sum + (entry.product.variations?.length ?? 0), 0),
      approvedImagesToUpload: 44,
      unchangedGalleryImagesPreserved: products.reduce((sum, entry) => sum + entry.product.images.filter((image) => image.gallery !== false && image.position !== 0).length, 0),
      parentsRemainDraftHidden: true,
      variationsRemainPublish: true,
      stockWillBePreserved: true,
      externalWrites: 0,
    }, null, 2));
    return;
  }

  if (args.verifyOnly) {
    if (updateJournal.status !== "complete") throw new Error("Cannot verify an incomplete primary-image update journal");
    const receipt = await readJson(args.receiptPath);
    if (receipt.schema !== "enki-pool-primary-image-live-verification/v1" || receipt.summary?.failures !== 0) {
      throw new Error("Primary-image live verification receipt is incomplete");
    }
    const receiptBySku = new Map(receipt.products.map((product) => [product.sku, product]));
    for (const {product} of products) {
      const row = updateJournal.products[product.sku];
      if (!row || row.status !== "verified") throw new Error(`Incomplete primary-image journal entry for ${product.sku}`);
      const expected = receiptBySku.get(product.sku);
      if (!expected) throw new Error(`Primary-image receipt entry missing for ${product.sku}`);
      verifyLive(product, liveBySku.get(product.sku), currentJournal.products[product.sku], row, {
        parent: expected.parentInventory,
        variations: expected.variationInventory,
      });
    }
    console.log(JSON.stringify({
      mode: "verify_only",
      parentsVerified: 24,
      variationsVerified: 40,
      approvedMediaAssociationsVerified: 44,
      parentsDraftHidden: true,
      variationsPublish: true,
      stockPreserved: true,
      externalWrites: 0,
    }, null, 2));
    return;
  }

  await writeJsonAtomic(args.journalPath, updateJournal);
  const receipt = {
    schema: "enki-pool-primary-image-live-verification/v1",
    batchManifestSha256: manifestSha256,
    reviewManifestSha256: reviewSha256,
    authorization: AUTHORIZATION,
    products: [],
    summary: null,
  };
  for (const {product, bundleRoot} of products) {
    const current = currentJournal.products[product.sku];
    const row = updateJournal.products[product.sku] ?? {media: {}, status: "pending"};
    updateJournal.products[product.sku] = row;
    for (const {finish, image} of approvedImagePositions(product)) {
      if (row.media[finish]) {
        if (row.media[finish].sha256 !== image.sha256) throw new Error(`Primary-image journal hash drift: ${product.sku}:${finish}`);
        continue;
      }
      const created = await mediaClient.uploadWebp(join(bundleRoot, image.path), {
        alt: image.alt,
        title: image.alt,
        expectedSha256: image.sha256,
      });
      row.media[finish] = {id: created.id, sha256: image.sha256, name: created.name, position: image.position};
      await writeJsonAtomic(args.journalPath, updateJournal);
    }

    const live = liveBySku.get(product.sku);
    const gallery = [...product.images]
      .filter((image) => image.gallery !== false)
      .sort((left, right) => left.position - right.position)
      .map((image) => {
        if (image.position === 0) return {id: row.media.NB.id, alt: image.alt, name: row.media.NB.name};
        const previous = current.media[String(image.position)];
        return {id: previous.id, alt: image.alt, name: previous.name};
      });
    await woo.request("PUT", `/products/${live.parent.id}`, {
      body: {
        images: gallery,
        meta_data: [
          {key: "_enki_primary_image_batch_sha256", value: manifestSha256},
          {key: "_enki_primary_image_review_sha256", value: reviewSha256},
          {key: "_enki_primary_image_approval", value: AUTHORIZATION},
        ],
      },
    });
    for (const variation of product.variations ?? []) {
      const liveVariation = live.variationBySku.get(variation.sku);
      const finish = variationFinish(variation);
      await woo.request("PUT", `/products/${live.parent.id}/variations/${liveVariation.id}`, {
        body: {image: {id: row.media[finish].id}},
      });
    }

    const verifiedParent = await woo.request("GET", `/products/${live.parent.id}`);
    const verifiedVariations = product.type === "variable"
      ? await woo.request("GET", `/products/${live.parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
      : [];
    const verified = {
      parent: verifiedParent,
      variations: verifiedVariations,
      variationBySku: new Map(verifiedVariations.map((variation) => [variation.sku, variation])),
    };
    verifyLive(product, verified, current, row, inventoryBySku.get(product.sku));
    row.status = "verified";
    row.parentId = Number(live.parent.id);
    await writeJsonAtomic(args.journalPath, updateJournal);
    receipt.products.push({
      sku: product.sku,
      externalId: Number(live.parent.id),
      status: verifiedParent.status,
      catalogVisibility: verifiedParent.catalog_visibility,
      primaryImageId: row.media.NB.id,
      variationImageIds: Object.fromEntries((product.variations ?? []).map((variation) => [
        variation.sku,
        row.media[variationFinish(variation)].id,
      ])),
      previousPrimaryImageId: current.media["0"].id,
      parentInventory: inventory(verifiedParent),
      variationInventory: Object.fromEntries(verifiedVariations.map((variation) => [variation.sku, inventory(variation)])),
      stockPreserved: true,
    });
    console.log(JSON.stringify({updated: product.sku, completed: receipt.products.length, total: products.length}));
  }
  updateJournal.status = "complete";
  await writeJsonAtomic(args.journalPath, updateJournal);
  receipt.summary = {
    parentsUpdated: 24,
    variationsUpdated: 40,
    mediaUploaded: 44,
    parentsDraftHidden: true,
    variationsPublish: true,
    stockPreserved: true,
    oldMediaDeleted: 0,
    failures: 0,
  };
  await writeJsonAtomic(args.receiptPath, receipt);
  console.log(JSON.stringify({status: "complete", ...receipt.summary}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
