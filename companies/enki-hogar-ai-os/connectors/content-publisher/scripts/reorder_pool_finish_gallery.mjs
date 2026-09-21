#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {WooCommerceProductClient} from "../src/clients.mjs";

const AUTHORIZATION = "user-approved-pool-metal-raw-gallery-order-2026-09-21";
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
  for (const required of ["--bundle-root", "--v12-journal", "--primary-journal", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply && verifyOnly) throw new Error("Use either --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) {
    throw new Error("Exact approved Pool gallery-order authorization marker is required for --apply");
  }
  return {
    apply,
    verifyOnly,
    bundleRoot: resolve(values.get("--bundle-root")),
    v12JournalPath: resolve(values.get("--v12-journal")),
    primaryJournalPath: resolve(values.get("--primary-journal")),
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

function finish(variation) {
  const option = variation.attributes?.find((attribute) => Number(attribute.id) === 15)?.option;
  if (option === "Níquel cepillado") return "NB";
  if (option === "Metal Raw") return "RM";
  throw new Error(`Unsupported Pool variation finish for ${variation.sku}`);
}

async function loadProducts(root) {
  const manifestBytes = await readFile(join(root, "batch-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.summary?.readyProducts !== 24 || manifest.summary?.variableProducts !== 20
    || manifest.summary?.simpleProducts !== 4 || manifest.summary?.sellableSkus !== 44
    || manifest.bundles?.length !== 5) {
    throw new Error("Gallery-order batch must contain the exact reviewed 24-parent/44-SKU Pool scope");
  }
  const products = [];
  for (const row of manifest.bundles) {
    const bundleBytes = await readFile(join(root, row.path));
    if (!SHA256.test(row.sha256) || digest(bundleBytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    for (const product of JSON.parse(bundleBytes).products) products.push(product);
  }
  if (products.length !== 24 || products.filter((product) => product.type === "variable").length !== 20) {
    throw new Error("Gallery-order product scope drift");
  }
  return {manifestSha256: digest(manifestBytes), products};
}

function imageIdMap(product, v12Row, primaryRow) {
  const byHash = new Map();
  for (const media of Object.values(v12Row.media ?? {})) byHash.set(media.sha256, media);
  for (const media of Object.values(primaryRow.media ?? {})) byHash.set(media.sha256, media);
  const mapped = product.images.map((image) => {
    const media = byHash.get(image.sha256);
    if (!media || !Number.isSafeInteger(Number(media.id))) throw new Error(`Media ID missing for ${product.sku}:${image.position}`);
    return {image, id: Number(media.id), name: media.name};
  });
  if (new Set(mapped.map((item) => item.id)).size !== mapped.length) throw new Error(`Duplicate gallery media for ${product.sku}`);
  return mapped;
}

function expectedCurrentGallery(product, mapped) {
  if (product.type === "simple") return mapped.sort((left, right) => left.image.position - right.image.position).map((item) => item.id);
  const nbPosition = product.variations.find((variation) => finish(variation) === "NB").imagePosition;
  const rmPosition = product.variations.find((variation) => finish(variation) === "RM").imagePosition;
  return mapped
    .filter((item) => item.image.position !== rmPosition)
    .sort((left, right) => {
      if (left.image.position === nbPosition) return -1;
      if (right.image.position === nbPosition) return 1;
      return left.image.position - right.image.position;
    })
    .map((item) => item.id);
}

function desiredGallery(mapped) {
  return [...mapped].sort((left, right) => left.image.position - right.image.position).map((item) => item.id);
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
  return {parent, variations, variationBySku};
}

function verifyVariationImages(product, live, primaryRow) {
  for (const variation of product.variations ?? []) {
    const current = live.variationBySku.get(variation.sku);
    const expected = primaryRow.media[finish(variation)].id;
    if (!current || current.status !== "publish" || Number(current.image?.id) !== Number(expected)) {
      throw new Error(`Variation image or status drift for ${variation.sku}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {manifestSha256, products} = await loadProducts(args.bundleRoot);
  const v12Journal = await readJson(args.v12JournalPath);
  const primaryJournal = await readJson(args.primaryJournalPath);
  if (v12Journal.schema !== "enki-pool-v12-update-journal/v1" || v12Journal.status !== "complete") {
    throw new Error("v12 journal is not the completed baseline");
  }
  if (primaryJournal.schema !== "enki-pool-primary-image-update-journal/v1" || primaryJournal.status !== "complete") {
    throw new Error("Primary-image journal is not complete");
  }
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }

  const liveBySku = new Map();
  const desiredBySku = new Map();
  const inventoryBySku = new Map();
  const defaultAttributesBySku = new Map();
  for (const product of products) {
    const v12Row = v12Journal.products?.[product.sku];
    const primaryRow = primaryJournal.products?.[product.sku];
    if (!v12Row || !primaryRow || primaryRow.status !== "verified") throw new Error(`Baseline journal entry missing for ${product.sku}`);
    const mapped = imageIdMap(product, v12Row, primaryRow);
    const currentGallery = expectedCurrentGallery(product, mapped);
    const desired = desiredGallery(mapped);
    const live = await resolveLive(woo, product);
    const actual = ids(live.parent.images);
    if (!same(actual, currentGallery) && !same(actual, desired)) throw new Error(`Unexpected live gallery drift for ${product.sku}`);
    verifyVariationImages(product, live, primaryRow);
    liveBySku.set(product.sku, live);
    desiredBySku.set(product.sku, {desired, mapped});
    inventoryBySku.set(product.sku, {
      parent: inventory(live.parent),
      variations: Object.fromEntries(live.variations.map((variation) => [variation.sku, inventory(variation)])),
    });
    defaultAttributesBySku.set(product.sku, live.parent.default_attributes ?? []);
  }

  if (!args.apply && !args.verifyOnly) {
    console.log(JSON.stringify({
      mode: "dry_run",
      batchManifestSha256: manifestSha256,
      parentsChecked: 24,
      variableParentsToReorder: 20,
      simpleParentsUnchanged: 4,
      variationImagesVerified: 40,
      mediaUploads: 0,
      parentsRemainDraftHidden: true,
      variationsRemainPublish: true,
      stockWillBePreserved: true,
      defaultVariationSelectionWillBePreserved: true,
      externalWrites: 0,
    }, null, 2));
    return;
  }

  let journal;
  try {
    journal = await readJson(args.journalPath);
    if (journal.schema !== "enki-pool-gallery-order-update-journal/v1" || journal.batchManifestSha256 !== manifestSha256) {
      throw new Error("Gallery-order journal belongs to another batch");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    journal = {
      schema: "enki-pool-gallery-order-update-journal/v1",
      batchManifestSha256: manifestSha256,
      authorization: AUTHORIZATION,
      status: "in_progress",
      products: {},
    };
  }

  if (args.verifyOnly && journal.status !== "complete") throw new Error("Cannot verify an incomplete gallery-order journal");
  if (args.apply) await writeJsonAtomic(args.journalPath, journal);

  const receipt = {
    schema: "enki-pool-gallery-order-live-verification/v1",
    batchManifestSha256: manifestSha256,
    authorization: AUTHORIZATION,
    products: [],
    summary: null,
  };
  for (const product of products) {
    const live = liveBySku.get(product.sku);
    const {desired, mapped} = desiredBySku.get(product.sku);
    if (product.type === "variable" && args.apply && !same(ids(live.parent.images), desired)) {
      const gallery = [...mapped]
        .sort((left, right) => left.image.position - right.image.position)
        .map(({image, id, name}) => ({id, alt: image.alt, name}));
      await woo.request("PUT", `/products/${live.parent.id}`, {
        body: {
          images: gallery,
          meta_data: [
            {key: "_enki_gallery_order_batch_sha256", value: manifestSha256},
            {key: "_enki_gallery_order_approval", value: AUTHORIZATION},
          ],
        },
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
    if (!same(ids(verifiedParent.images), desired)
      || verifiedParent.status !== "draft" || verifiedParent.catalog_visibility !== "hidden"
      || !same(inventory(verifiedParent), inventoryBySku.get(product.sku).parent)
      || !same(verifiedParent.default_attributes ?? [], defaultAttributesBySku.get(product.sku))) {
      throw new Error(`Gallery, stock, status or default-attribute readback mismatch for ${product.sku}`);
    }
    verifyVariationImages(product, verified, primaryJournal.products[product.sku]);
    for (const variation of verifiedVariations) {
      if (!same(inventory(variation), inventoryBySku.get(product.sku).variations[variation.sku])) {
        throw new Error(`Variation stock readback mismatch for ${variation.sku}`);
      }
    }
    journal.products[product.sku] = {
      parentId: Number(live.parent.id),
      status: "verified",
      changed: product.type === "variable",
      galleryImageIds: desired,
    };
    if (args.apply) await writeJsonAtomic(args.journalPath, journal);
    receipt.products.push({
      sku: product.sku,
      externalId: Number(live.parent.id),
      type: product.type,
      status: verifiedParent.status,
      catalogVisibility: verifiedParent.catalog_visibility,
      galleryImageIds: desired,
      primaryImageId: desired[0],
      variationImageIds: Object.fromEntries((product.variations ?? []).map((variation) => [
        variation.sku,
        Number(primaryJournal.products[product.sku].media[finish(variation)].id),
      ])),
      parentInventory: inventory(verifiedParent),
      variationInventory: Object.fromEntries(verifiedVariations.map((variation) => [variation.sku, inventory(variation)])),
      defaultAttributes: verifiedParent.default_attributes ?? [],
    });
  }

  if (args.verifyOnly) {
    const existingReceipt = await readJson(args.receiptPath);
    if (existingReceipt.schema !== receipt.schema || existingReceipt.summary?.failures !== 0) {
      throw new Error("Gallery-order verification receipt is incomplete");
    }
    console.log(JSON.stringify({
      mode: "verify_only",
      parentsVerified: 24,
      variableGalleriesVerified: 20,
      simpleGalleriesVerified: 4,
      variationImagesVerified: 40,
      mediaUploads: 0,
      parentsDraftHidden: true,
      variationsPublish: true,
      stockPreserved: true,
      defaultVariationSelectionPreserved: true,
      externalWrites: 0,
    }, null, 2));
    return;
  }

  journal.status = "complete";
  await writeJsonAtomic(args.journalPath, journal);
  receipt.summary = {
    parentsUpdated: 20,
    simpleParentsUnchanged: 4,
    variationsVerified: 40,
    mediaUploaded: 0,
    parentsDraftHidden: true,
    variationsPublish: true,
    stockPreserved: true,
    defaultVariationSelectionPreserved: true,
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
