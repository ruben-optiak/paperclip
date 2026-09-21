#!/usr/bin/env node
import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {
  WordPressMediaClient,
  WooCommerceProductClient,
} from "../../../connectors/content-publisher/src/clients.mjs";

const AUTHORIZATION = "user-explicit-pool-v12-update-2026-09-21";
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
  for (const required of ["--bundle-root", "--expected-live", "--journal", "--receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (apply && verifyOnly) throw new Error("Use either --apply or --verify-only");
  if (apply && values.get("--authorization") !== AUTHORIZATION) {
    throw new Error("The exact user authorization marker is required for --apply");
  }
  return {
    apply,
    verifyOnly,
    bundleRoot: resolve(values.get("--bundle-root")),
    expectedLive: resolve(values.get("--expected-live")),
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

async function loadReviewedProducts(root) {
  const manifestPath = join(root, "batch-manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.summary?.readyProducts !== 24 || manifest.summary?.sellableSkus !== 44 || manifest.bundles?.length !== 5) {
    throw new Error("The reviewed Pool batch scope must be exactly 24 parents and 44 sellable SKUs");
  }
  const products = [];
  for (const row of manifest.bundles) {
    if (!SHA256.test(row.sha256)) throw new Error(`Invalid bundle hash: ${row.bundleKey}`);
    const path = join(root, row.path);
    const bytes = await readFile(path);
    if (digest(bytes) !== row.sha256) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    const bundle = JSON.parse(bytes);
    if (bundle.bundleKey !== row.bundleKey || bundle.products.length !== row.productCount) {
      throw new Error(`Bundle identity drift: ${row.bundleKey}`);
    }
    for (const product of bundle.products) {
      products.push({product, bundleRoot: dirname(path), bundleSha256: row.sha256});
    }
  }
  if (new Set(products.map(({product}) => product.sku)).size !== 24) throw new Error("Duplicate Pool parent SKU");
  return {manifest, manifestSha256: digest(manifestBytes), products};
}

function expectedLiveMap(receipt) {
  if (receipt.schema !== "enki-pool-live-correction-verification/v1" || receipt.summary?.products !== 24) {
    throw new Error("Expected-live receipt is not the reviewed 24-product correction receipt");
  }
  return new Map(receipt.products.map((product) => [product.sku, product]));
}

function ids(values) {
  return (Array.isArray(values) ? values : []).map((item) => Number(item?.id)).filter(Number.isSafeInteger).sort((a, b) => a - b);
}

function orderedIds(values) {
  return (Array.isArray(values) ? values : []).map((item) => Number(item?.id)).filter(Number.isSafeInteger);
}

function normalizedHtml(value) {
  return String(value ?? "").trim().replace(/>\s+</g, "><");
}

function normalizedAttributes(values, variation = false) {
  return (Array.isArray(values) ? values : []).map((item) => ({
    id: Number(item.id),
    ...(variation ? {option: String(item.option)} : {
      options: [...item.options].map(String).sort((a, b) => a.localeCompare(b, "es")),
      visible: item.visible === true,
      variation: item.variation === true,
    }),
  })).sort((a, b) => a.id - b.id);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function metadata(row) {
  return Object.fromEntries((Array.isArray(row?.meta_data) ? row.meta_data : []).map((item) => [String(item.key), String(item.value ?? "")]));
}

function expectedMetadata(payload) {
  return Object.fromEntries((payload.meta_data ?? []).map((item) => [String(item.key), String(item.value ?? "")]));
}

function containsMetadata(row, payload) {
  const actual = metadata(row);
  return Object.entries(expectedMetadata(payload)).every(([key, value]) => actual[key] === value);
}

async function resolveLive(woo, reviewed, expected) {
  const rows = await woo.request("GET", "/products", {params: {sku: reviewed.sku, status: "any", per_page: 10}});
  const exact = rows.filter((row) => row?.sku === reviewed.sku);
  if (exact.length !== 1) throw new Error(`Expected exactly one live parent for ${reviewed.sku}`);
  const parent = exact[0];
  if (String(parent.id) !== expected.external_id || parent.status !== "draft" || parent.catalog_visibility !== "hidden") {
    throw new Error(`Live parent safety gate failed for ${reviewed.sku}`);
  }
  if (parent.type !== reviewed.type || !ids(parent.brands).includes(BRAND_ID)) {
    throw new Error(`Live type or brand drift for ${reviewed.sku}`);
  }
  let variations = [];
  if (reviewed.type === "variable") {
    variations = await woo.request("GET", `/products/${parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}});
    const expectedChildren = new Map(expected.variations.map((child) => [child.sku, child]));
    if (variations.length !== reviewed.variations.length || expectedChildren.size !== reviewed.variations.length) {
      throw new Error(`Live variation count drift for ${reviewed.sku}`);
    }
    for (const child of variations) {
      const expectedChild = expectedChildren.get(child.sku);
      if (!expectedChild || String(child.id) !== expectedChild.external_id || child.status !== "publish") {
        throw new Error(`Live variation identity or status drift for ${child.sku || reviewed.sku}`);
      }
    }
  }
  return {parent, variations};
}

function inventory(row) {
  return {
    manage_stock: row.manage_stock === true,
    stock_quantity: row.stock_quantity === null || row.stock_quantity === undefined ? null : Number(row.stock_quantity),
    stock_status: String(row.stock_status),
  };
}

function inventoryPayload(row) {
  const value = inventory(row);
  return {
    manage_stock: value.manage_stock,
    stock_quantity: value.stock_quantity,
    stock_status: value.stock_status,
  };
}

function reviewMeta(reference, bundleSha256) {
  return [
    {key: "_enki_manufacturer_reference", value: reference},
    {key: "_enki_product_bundle_sha256", value: bundleSha256},
    {key: "_enki_paperclip_issue", value: "ENK-38+ENK-39"},
    {key: "_enki_approval_document", value: "chat-user-authorization-2026-09-21"},
    {key: "_enki_approval_revision", value: "v12-natural-titles-media"},
  ];
}

export function parentPayload(product, media, liveParent, bundleSha256) {
  return {
    name: product.name,
    slug: product.slug,
    type: product.type,
    status: "draft",
    catalog_visibility: "hidden",
    sku: product.sku,
    ...(product.gtin ? {global_unique_id: product.gtin} : {}),
    description: product.descriptionHtml,
    short_description: product.shortDescriptionHtml,
    categories: product.categories.map((id) => ({id})),
    brands: [{id: BRAND_ID}],
    tags: product.tags.map((id) => ({id})),
    attributes: product.attributes,
    images: media.filter((image) => image.gallery !== false).map((image) => ({id: image.id, alt: image.alt, name: image.name})),
    ...(product.commerce.regularPrice ? {regular_price: product.commerce.regularPrice} : {}),
    ...(product.commerce.salePrice ? {sale_price: product.commerce.salePrice} : {}),
    ...inventoryPayload(liveParent),
    meta_data: [
      {key: "_yoast_wpseo_title", value: product.seo.title},
      {key: "_yoast_wpseo_metadesc", value: product.seo.description},
      {key: "_yoast_wpseo_focuskw", value: product.seo.focusKeyword},
      ...reviewMeta(product.manufacturerReference, bundleSha256),
    ],
  };
}

export function variationPayload(variation, media, liveVariation, bundleSha256) {
  const image = variation.imagePosition === undefined ? null : media.find((item) => item.position === variation.imagePosition);
  if (variation.imagePosition !== undefined && !image) throw new Error(`Missing variation image for ${variation.sku}`);
  return {
    status: liveVariation.status,
    sku: variation.sku,
    ...(variation.gtin ? {global_unique_id: variation.gtin} : {}),
    regular_price: variation.commerce.regularPrice,
    ...(variation.commerce.salePrice ? {sale_price: variation.commerce.salePrice} : {}),
    ...inventoryPayload(liveVariation),
    attributes: variation.attributes,
    ...(image ? {image: {id: image.id}} : {}),
    meta_data: reviewMeta(variation.manufacturerReference, bundleSha256),
  };
}

function verifyParent(product, live, payload, media) {
  const galleryIds = media.filter((image) => image.gallery !== false).map((image) => image.id);
  const galleryAlts = media.filter((image) => image.gallery !== false).map((image) => image.alt);
  if (live.status !== "draft" || live.catalog_visibility !== "hidden" || live.type !== product.type
    || live.name !== product.name || live.slug !== product.slug
    || live.sku !== product.sku || normalizedHtml(live.description) !== normalizedHtml(product.descriptionHtml)
    || normalizedHtml(live.short_description) !== normalizedHtml(product.shortDescriptionHtml)
    || !same(ids(live.categories), [...product.categories].sort((a, b) => a - b)) || !same(ids(live.brands), [BRAND_ID])
    || !same(ids(live.tags), [...product.tags].sort((a, b) => a - b))
    || !same(orderedIds(live.images), galleryIds) || !same(normalizedAttributes(live.attributes), normalizedAttributes(product.attributes))
    || !same((live.images ?? []).map((image) => String(image.alt ?? "")), galleryAlts)
    || String(live.global_unique_id ?? "") !== String(product.gtin ?? "")
    || String(live.regular_price ?? "") !== String(product.commerce.regularPrice ?? "")
    || String(live.sale_price ?? "") !== String(product.commerce.salePrice ?? "")
    || !same(inventory(live), inventory(payload)) || !containsMetadata(live, payload)) {
    throw new Error(`Parent readback mismatch for ${product.sku}`);
  }
}

function verifyVariation(reviewed, live, payload) {
  if (!live || live.status !== "publish" || live.sku !== reviewed.sku || live.regular_price !== reviewed.commerce.regularPrice
    || live.sale_price !== (reviewed.commerce.salePrice ?? "")
    || String(live.global_unique_id ?? "") !== String(reviewed.gtin ?? "")
    || !same(normalizedAttributes(live.attributes, true), normalizedAttributes(reviewed.attributes, true))
    || Number(live.image?.id ?? 0) !== Number(payload.image?.id ?? 0)
    || !same(inventory(live), inventory(payload)) || !containsMetadata(live, payload)) {
    throw new Error(`Variation readback mismatch for ${reviewed.sku}`);
  }
}

async function loadJournal(path, manifestSha256) {
  try {
    const journal = await readJson(path);
    if (journal.schema !== "enki-pool-v12-update-journal/v1" || journal.batchManifestSha256 !== manifestSha256) {
      throw new Error("Update journal belongs to another batch");
    }
    return journal;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schema: "enki-pool-v12-update-journal/v1",
      batchManifestSha256: manifestSha256,
      authorization: AUTHORIZATION,
      status: "in_progress",
      products: {},
    };
  }
}

async function uploadProductMedia(mediaClient, entry, bundleRoot, journal, journalPath) {
  const skuJournal = journal.products[entry.product.sku] ?? {media: {}, status: "pending"};
  journal.products[entry.product.sku] = skuJournal;
  const uploaded = [];
  for (const image of [...entry.product.images].sort((a, b) => a.position - b.position)) {
    const prior = skuJournal.media[String(image.position)];
    if (prior) {
      if (prior.sha256 !== image.sha256 || !Number.isSafeInteger(prior.id)) throw new Error(`Media journal drift for ${entry.product.sku}`);
      uploaded.push({...image, id: prior.id, name: prior.name});
      continue;
    }
    const created = await mediaClient.uploadWebp(join(bundleRoot, image.path), {
      alt: image.alt,
      title: image.alt,
      expectedSha256: image.sha256,
    });
    skuJournal.media[String(image.position)] = {id: created.id, sha256: image.sha256, name: created.name};
    await writeJsonAtomic(journalPath, journal);
    uploaded.push({...image, id: created.id, name: created.name});
  }
  return uploaded;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {manifestSha256, products} = await loadReviewedProducts(args.bundleRoot);
  const expected = expectedLiveMap(await readJson(args.expectedLive));
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });
  const mediaClient = args.apply ? new WordPressMediaClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    mediaUsername: process.env.PRODUCT_MEDIA_USERNAME,
    mediaAppPassword: process.env.PRODUCT_MEDIA_APP_PASSWORD,
  }) : null;
  if (!process.env.WOO_PUBLISH_BASE_URL || !process.env.WOO_PUBLISH_CONSUMER_KEY || !process.env.WOO_PUBLISH_CONSUMER_SECRET) {
    throw new Error("WooCommerce publishing credentials are incomplete");
  }
  if (args.apply && (!process.env.PRODUCT_MEDIA_USERNAME || !process.env.PRODUCT_MEDIA_APP_PASSWORD)) {
    throw new Error("WordPress product-media credentials are incomplete");
  }

  const liveBySku = new Map();
  for (const entry of products) {
    const expectedProduct = expected.get(entry.product.sku);
    if (!expectedProduct) throw new Error(`Expected-live identity missing for ${entry.product.sku}`);
    liveBySku.set(entry.product.sku, await resolveLive(woo, entry.product, expectedProduct));
  }
  if (args.verifyOnly) {
    const journal = await loadJournal(args.journalPath, manifestSha256);
    if (journal.status !== "complete") throw new Error("Cannot verify an incomplete update journal");
    let variationsVerified = 0;
    for (const entry of products) {
      const live = liveBySku.get(entry.product.sku);
      const skuJournal = journal.products[entry.product.sku];
      if (!skuJournal || skuJournal.status !== "verified") throw new Error(`Incomplete journal entry for ${entry.product.sku}`);
      const media = [...entry.product.images].sort((a, b) => a.position - b.position).map((image) => {
        const recorded = skuJournal.media[String(image.position)];
        if (!recorded || recorded.sha256 !== image.sha256) throw new Error(`Journal media drift for ${entry.product.sku}`);
        return {...image, id: recorded.id, name: recorded.name};
      });
      const parentBody = parentPayload(entry.product, media, live.parent, entry.bundleSha256);
      verifyParent(entry.product, live.parent, parentBody, media);
      const liveVariations = new Map(live.variations.map((row) => [row.sku, row]));
      for (const variation of entry.product.variations ?? []) {
        const current = liveVariations.get(variation.sku);
        verifyVariation(variation, current, variationPayload(variation, media, current, entry.bundleSha256));
        variationsVerified += 1;
      }
    }
    console.log(JSON.stringify({
      mode: "verify_only",
      batchManifestSha256: manifestSha256,
      parentsVerified: products.length,
      variationsVerified,
      mediaAssociationsVerified: products.reduce((sum, entry) => sum + entry.product.images.length, 0),
      descriptionsMatchReviewedBundle: true,
      stockPreservedFromLive: true,
      externalWrites: 0,
    }, null, 2));
    return;
  }
  if (!args.apply) {
    console.log(JSON.stringify({
      mode: "dry_run",
      batchManifestSha256: manifestSha256,
      parentsChecked: products.length,
      variationsChecked: [...liveBySku.values()].reduce((sum, item) => sum + item.variations.length, 0),
      parentsDraftHidden: true,
      variationsPublish: true,
      stockWillBePreservedFromLive: true,
      mediaReferencesToUpload: products.reduce((sum, entry) => sum + entry.product.images.length, 0),
      externalWrites: 0,
    }, null, 2));
    return;
  }

  const journal = await loadJournal(args.journalPath, manifestSha256);
  await writeJsonAtomic(args.journalPath, journal);
  const receipt = {
    schema: "enki-pool-v12-live-update-verification/v1",
    batchManifestSha256: manifestSha256,
    authorization: AUTHORIZATION,
    products: [],
    summary: null,
  };
  for (const entry of products) {
    const {product, bundleRoot, bundleSha256} = entry;
    const live = liveBySku.get(product.sku);
    const skuJournal = journal.products[product.sku] ?? {media: {}, status: "pending"};
    journal.products[product.sku] = skuJournal;
    const media = await uploadProductMedia(mediaClient, entry, bundleRoot, journal, args.journalPath);
    const parentBody = parentPayload(product, media, live.parent, bundleSha256);
    await woo.request("PUT", `/products/${live.parent.id}`, {body: parentBody});
    const liveVariations = new Map(live.variations.map((row) => [row.sku, row]));
    for (const variation of product.variations ?? []) {
      const current = liveVariations.get(variation.sku);
      if (!current) throw new Error(`Live variation missing during update: ${variation.sku}`);
      await woo.request("PUT", `/products/${live.parent.id}/variations/${current.id}`, {
        body: variationPayload(variation, media, current, bundleSha256),
      });
    }
    const verifiedParent = await woo.request("GET", `/products/${live.parent.id}`);
    verifyParent(product, verifiedParent, parentBody, media);
    const verifiedVariations = product.type === "variable"
      ? await woo.request("GET", `/products/${live.parent.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
      : [];
    const verifiedBySku = new Map(verifiedVariations.map((row) => [row.sku, row]));
    for (const variation of product.variations ?? []) {
      const verified = verifiedBySku.get(variation.sku);
      verifyVariation(variation, verified, variationPayload(variation, media, liveVariations.get(variation.sku), bundleSha256));
    }
    skuJournal.status = "verified";
    skuJournal.parentId = Number(live.parent.id);
    await writeJsonAtomic(args.journalPath, journal);
    receipt.products.push({
      sku: product.sku,
      externalId: Number(live.parent.id),
      status: verifiedParent.status,
      catalogVisibility: verifiedParent.catalog_visibility,
      galleryImageIds: media.filter((image) => image.gallery !== false).map((image) => image.id),
      variationImageIds: Object.fromEntries((product.variations ?? []).map((variation) => [
        variation.sku,
        Number(verifiedBySku.get(variation.sku)?.image?.id ?? 0),
      ])),
      descriptionsMatchReviewedBundle: true,
      stockPreservedFromLive: true,
    });
    console.log(JSON.stringify({updated: product.sku, completed: receipt.products.length, total: products.length}));
  }
  journal.status = "complete";
  await writeJsonAtomic(args.journalPath, journal);
  receipt.summary = {
    parentsUpdated: receipt.products.length,
    variationsUpdated: receipt.products.reduce((sum, product) => sum + Object.keys(product.variationImageIds).length, 0),
    mediaUploaded: Object.values(journal.products).reduce((sum, product) => sum + Object.keys(product.media).length, 0),
    parentsDraftHidden: receipt.products.every((product) => product.status === "draft" && product.catalogVisibility === "hidden"),
    descriptionsMatchReviewedBundle: true,
    stockPreservedFromLive: true,
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
