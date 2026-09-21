#!/usr/bin/env node
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {preflightBundleBatch} from "./preflight-bundle-batch.mjs";
import {ProductBundleRepository} from "../src/product-bundle.mjs";

const PRODUCT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function stableBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeDeterministic(path, bytes) {
  const existing = await readFile(path).catch(() => null);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`Refusing to replace a different canary review: ${path}`);
    return;
  }
  await writeFile(path, bytes, {flag: "wx"});
}

export function buildCanaryReview({manifest, expectedBundle, bundle, product, preflight}) {
  const sellables = product.type === "variable" ? product.variations : [product];
  return {
    schema: "enki-product-draft-canary-review/v1",
    reviewKey: `${product.productKey}-canary-review`,
    preparedAt: manifest.createdAt,
    status: "prepared_for_exact_human_approval",
    authority: {
      approvalGranted: false,
      externalWritesPerformed: 0,
      canCreateWooDraft: false,
      canPublish: false,
    },
    source: {
      batchRunId: manifest.runId || null,
      batchManifestSha256: preflight.batchManifestSha256,
      bundleKey: expectedBundle.bundleKey,
      bundleSha256: expectedBundle.sha256,
      productKey: product.productKey,
    },
    candidate: {
      name: product.name,
      type: product.type,
      parentSku: product.sku,
      slug: product.slug,
      categories: product.categories,
      imageSha256: product.images.map((item) => item.sha256),
      sellables: sellables.map((item) => ({
        sku: item.sku,
        gtin: item.gtin || null,
        regularPrice: item.commerce.regularPrice,
        salePrice: item.commerce.salePrice || null,
        status: product.type === "variable" ? item.status : product.status,
      })),
      seo: product.seo,
    },
    verifiedGates: {
      batchPreflightStatus: preflight.status,
      catalogueQa: bundle.review.catalogueQa,
      brandGuardian: bundle.review.brandGuardian,
      webpDimensionsMatch: preflight.checks.webp.dimensionsMatch,
      gtinChecksumErrors: preflight.checks.gtin.checksumErrors,
      seoDuplicateTitles: preflight.checks.seo.duplicateTitles,
      commercialPolicyStatus: preflight.checks.commercialPolicy.status,
    },
    exactApprovalRequired: {
      tool: "woocommerce_create_product_draft",
      writeMode: "woo-drafts",
      arguments: ["bundle_sha256", "product_key", "idempotency_key"],
      note: "This review is not approval and cannot be used to create or publish a product.",
    },
    expectedWriteShapeAfterApproval: {
      parentStatus: "draft",
      variationStatus: product.type === "variable" ? "private" : null,
      manageStock: false,
      stockStatus: "outofstock",
      publicationAllowed: false,
      readbackRequired: true,
    },
    operatorChecklist: [
      "Confirm the exact product name, slug and category in the review artifact.",
      "Inspect the reviewed WebP at native dimensions.",
      "Confirm every sellable SKU, GTIN, regular price and sale price.",
      "Approve only the exact bundle SHA-256 and productKey shown above.",
      "After draft creation, compare the Woo readback and leave write mode disabled again.",
    ],
  };
}

function renderMarkdown(review) {
  const lines = [
    `# Canary review: ${review.candidate.name}`,
    "",
    "Prepared locally for exact human approval. This document grants no WooCommerce write or publication authority.",
    "",
    "## Exact identity",
    "",
    `- Product key: \`${review.source.productKey}\``,
    `- Bundle: \`${review.source.bundleKey}\``,
    `- Bundle SHA-256: \`${review.source.bundleSha256}\``,
    `- Parent SKU: \`${review.candidate.parentSku}\``,
    `- Type: \`${review.candidate.type}\``,
    "",
    "## Sellable SKUs",
    "",
    "| SKU | GTIN | Regular | Sale | Status |",
    "|---|---|---:|---:|---|",
    ...review.candidate.sellables.map((item) => `| \`${item.sku}\` | ${item.gtin || "—"} | ${item.regularPrice || "—"} | ${item.salePrice || "—"} | ${item.status} |`),
    "",
    "## Gates",
    "",
    `- Batch preflight: \`${review.verifiedGates.batchPreflightStatus}\``,
    `- Catalogue QA: \`${review.verifiedGates.catalogueQa}\``,
    `- Brand Guardian: \`${review.verifiedGates.brandGuardian}\``,
    `- Commercial policy: \`${review.verifiedGates.commercialPolicyStatus}\``,
    `- GTIN checksum errors: **${review.verifiedGates.gtinChecksumErrors}**`,
    `- SEO title duplicates: **${review.verifiedGates.seoDuplicateTitles}**`,
    "",
    "## Approval boundary",
    "",
    `A later approval must name \`${review.source.bundleSha256} + ${review.source.productKey}\`. It may create only a hidden draft and private variations; it never authorizes publication.`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function prepareCanaryReview(batchManifestPath, productKey, {outputDirectory = null, writeFiles = true} = {}) {
  if (!PRODUCT_KEY.test(productKey || "")) throw new Error("productKey must be a portable slug");
  const manifestPath = resolve(batchManifestPath);
  const root = dirname(manifestPath);
  const preflight = await preflightBundleBatch(manifestPath, {writeReport: false});
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const matches = manifest.bundles.filter((item) => item.productKeys.includes(productKey));
  if (matches.length !== 1) throw new Error(`Expected exactly one bundle for productKey: ${productKey}`);
  const expectedBundle = matches[0];
  const repository = new ProductBundleRepository(dirname(resolve(root, expectedBundle.path)));
  const loaded = await repository.get(productKey, expectedBundle.sha256);
  const review = buildCanaryReview({
    manifest,
    expectedBundle,
    bundle: loaded.bundle,
    product: loaded.product,
    preflight,
  });
  const jsonBytes = stableBytes(review);
  const markdown = renderMarkdown(review);
  const result = {
    review,
    reviewSha256: digest(jsonBytes),
    jsonName: `${productKey}-canary-review.json`,
    markdownName: `${productKey}-canary-review.md`,
  };
  if (writeFiles) {
    const target = resolve(outputDirectory || root);
    await mkdir(target, {recursive: true});
    await writeDeterministic(join(target, result.jsonName), jsonBytes);
    await writeDeterministic(join(target, result.markdownName), Buffer.from(markdown));
  }
  return result;
}

function parseArgs(argv) {
  const args = {batch: null, productKey: null, outputDirectory: null};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--batch") args.batch = argv[++index];
    else if (argv[index] === "--product-key") args.productKey = argv[++index];
    else if (argv[index] === "--output-dir") args.outputDirectory = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.batch || !args.productKey) throw new Error("Usage: prepare-canary-review.mjs --batch FILE --product-key KEY [--output-dir DIR]");
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await prepareCanaryReview(args.batch, args.productKey, {outputDirectory: args.outputDirectory});
    process.stdout.write(`${JSON.stringify({status: result.review.status, productKey: result.review.source.productKey, reviewSha256: result.reviewSha256, externalWrites: 0}, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
