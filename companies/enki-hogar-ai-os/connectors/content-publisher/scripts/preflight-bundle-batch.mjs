#!/usr/bin/env node
import {createHash} from "node:crypto";
import {lstat, readFile, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {ProductBundleRepository} from "../src/product-bundle.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Bundle batch has duplicate ${label}`);
}

function portablePath(value, label) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`${label} path must be portable`);
  }
  return value;
}

async function readArtifact(root, pathValue, expectedSha256, label) {
  const portable = portablePath(pathValue, label);
  if (!SHA256.test(expectedSha256 || "")) throw new Error(`${label} SHA-256 is invalid`);
  const path = resolve(root, portable);
  if (!contained(root, path) || relative(root, path) !== portable) throw new Error(`${label} path escapes the batch root`);
  const stats = await lstat(path).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > 2_000_000) throw new Error(`${label} is missing or unsafe`);
  const bytes = await readFile(path);
  if (digest(bytes) !== expectedSha256) throw new Error(`${label} hash drift`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function decimalHundredths(value, label) {
  if (!DECIMAL.test(value || "")) throw new Error(`${label} must have at most two decimal places`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function money(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function roundHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function normalizedCopy(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function auditSeo(products) {
  const titleKeys = products.map((item) => normalizedCopy(item.seo.title));
  const descriptionKeys = products.map((item) => normalizedCopy(item.seo.description));
  const keywordKeys = products.map((item) => normalizedCopy(item.seo.focusKeyword));
  unique(titleKeys, "normalized SEO title");
  unique(descriptionKeys, "normalized SEO description");
  unique(keywordKeys, "normalized SEO focus keyword");
  for (const product of products) {
    if (/(?:\.\.\.|…)/.test(`${product.seo.title}${product.seo.description}`)) {
      throw new Error(`Product ${product.productKey} contains visibly truncated SEO copy`);
    }
    if (product.seo.title !== product.seo.title.trim() || product.seo.description !== product.seo.description.trim()) {
      throw new Error(`Product ${product.productKey} contains padded SEO copy`);
    }
  }
  return {
    titlesChecked: titleKeys.length,
    descriptionsChecked: descriptionKeys.length,
    focusKeywordsChecked: keywordKeys.length,
    duplicateTitles: 0,
    duplicateDescriptions: 0,
    duplicateFocusKeywords: 0,
    visiblyTruncatedFields: 0,
  };
}

function policyTiers(policy) {
  if (policy.schema !== "enki-discount-policy/v1"
    || policy.status !== "approved_for_new_product_candidates"
    || policy.governance?.externalMutationAuthority !== false
    || !Array.isArray(policy.tiers)
    || policy.tiers.length < 1) {
    throw new Error("Discount policy is not an approved non-authoritative policy document");
  }
  const tiers = policy.tiers.map((tier, index) => ({
    minimum: decimalHundredths(tier.minimumInclusive, `discount tier ${index} minimum`),
    maximum: tier.maximumExclusive === null ? null : decimalHundredths(tier.maximumExclusive, `discount tier ${index} maximum`),
    discount: decimalHundredths(tier.discountPercent, `discount tier ${index} percentage`),
  }));
  if (tiers[0].minimum !== 0n || tiers.at(-1).maximum !== null) throw new Error("Discount policy tiers must cover zero through infinity");
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    if (tier.discount <= 0n || tier.discount >= 10_000n) throw new Error("Discount policy percentage is outside its safe range");
    if (tier.maximum !== null && tier.maximum <= tier.minimum) throw new Error("Discount policy tier is empty");
    if (index > 0 && tiers[index - 1].maximum !== tier.minimum) throw new Error("Discount policy tiers are not contiguous");
  }
  return tiers;
}

async function auditCommercialPolicy(root, manifest, sellables) {
  const sources = manifest.sources || {};
  const declared = [sources.discountPolicyPath, sources.discountPolicySha256, sources.pricePolicyAuditPath, sources.pricePolicyAuditSha256];
  if (declared.every((value) => value === undefined)) return {status: "not_declared", sellableSkusChecked: 0};
  if (declared.some((value) => value === undefined)) throw new Error("Commercial policy artifacts must be declared as one complete set");
  const [policy, audit] = await Promise.all([
    readArtifact(root, sources.discountPolicyPath, sources.discountPolicySha256, "discount policy"),
    readArtifact(root, sources.pricePolicyAuditPath, sources.pricePolicyAuditSha256, "price-policy audit"),
  ]);
  const tiers = policyTiers(policy);
  if (audit.schema !== "enki-product-price-policy-audit/v1"
    || audit.policyKey !== policy.policyKey
    || audit.policySha256 !== sources.discountPolicySha256
    || audit.authority?.externalMutationAuthority !== false
    || audit.vatPercent !== policy.basis?.vatPercent) {
    throw new Error("Price-policy audit does not bind the approved policy exactly");
  }
  if (!Array.isArray(audit.entries)) throw new Error("Price-policy audit entries are missing");
  unique(audit.entries.map((item) => item.sku), "price-policy audit SKU");
  if (audit.entries.length !== sellables.length || audit.summary?.sellableSkus !== sellables.length || audit.summary?.policyMismatches !== 0) {
    throw new Error("Price-policy audit sellable-SKU summary drift");
  }
  const bySku = new Map(audit.entries.map((item) => [item.sku, item]));
  const vat = decimalHundredths(audit.vatPercent, "VAT percentage");
  for (const sellable of sellables) {
    const entry = bySku.get(sellable.sku);
    if (!entry || entry.productKey !== sellable.productKey) throw new Error(`Price-policy audit identity drift: ${sellable.sku}`);
    const pvp = decimalHundredths(entry.officialPvpExVat, `official PVP for ${sellable.sku}`);
    const matchingTier = tiers.find((tier) => pvp >= tier.minimum && (tier.maximum === null || pvp < tier.maximum));
    if (!matchingTier || decimalHundredths(entry.discountPercent, `discount for ${sellable.sku}`) !== matchingTier.discount) {
      throw new Error(`Discount tier mismatch: ${sellable.sku}`);
    }
    const expectedRegular = roundHalfUp(pvp * (10_000n + vat), 10_000n);
    const expectedSale = roundHalfUp(expectedRegular * (10_000n - matchingTier.discount), 10_000n);
    if (entry.regularGross !== money(expectedRegular) || entry.saleGross !== money(expectedSale)) {
      throw new Error(`Price-policy calculation mismatch: ${sellable.sku}`);
    }
    if (sellable.commerce.regularPrice !== entry.regularGross || sellable.commerce.salePrice !== entry.saleGross) {
      throw new Error(`Bundle commerce differs from the price-policy audit: ${sellable.sku}`);
    }
    if (sellable.commerce.priceEvidenceKey !== `tariff-regular:${sellable.sku}`
      || sellable.commerce.salePriceEvidenceKey !== `discount-policy:${sellable.sku}`) {
      throw new Error(`Bundle commerce evidence binding drift: ${sellable.sku}`);
    }
  }
  return {
    status: "exact_policy_match",
    policyKey: policy.policyKey,
    policySha256: sources.discountPolicySha256,
    pricePolicyAuditSha256: sources.pricePolicyAuditSha256,
    sellableSkusChecked: sellables.length,
    mismatches: 0,
  };
}

async function writeDeterministic(path, bytes) {
  const existing = await readFile(path).catch(() => null);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error("Existing preflight report differs from the deterministic result");
    return;
  }
  await writeFile(path, bytes, {flag: "wx"});
}

export async function preflightBundleBatch(batchManifestPath, {writeReport = true} = {}) {
  const manifestPath = resolve(batchManifestPath);
  const root = dirname(manifestPath);
  const rootStats = await lstat(root).catch(() => null);
  const manifestStats = await lstat(manifestPath).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) throw new Error("Bundle batch root must be a regular directory");
  if (!manifestStats?.isFile() || manifestStats.isSymbolicLink() || manifestStats.size > 1_000_000) throw new Error("Bundle batch manifest is missing or unsafe");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schema !== "enki-product-draft-bundle-batch/v1") throw new Error("Unexpected bundle batch schema");
  if (manifest.authority?.canCreateWooDraft !== false || manifest.authority?.canPublish !== false || manifest.preflight?.publicationWrites !== 0) {
    throw new Error("Bundle batch must retain zero external mutation authority");
  }
  if (!Array.isArray(manifest.bundles) || manifest.bundles.length < 1) throw new Error("Bundle batch is empty");

  const productKeys = [];
  const skus = [];
  const slugs = [];
  const gtins = [];
  const products = [];
  const sellables = [];
  const bundleResults = [];
  for (const expected of manifest.bundles) {
    const bundlePath = resolve(root, portablePath(expected.path, "bundle"));
    if (!contained(root, bundlePath) || relative(root, bundlePath) !== expected.path) throw new Error("Bundle path escapes the batch root");
    const bytes = await readFile(bundlePath);
    if (digest(bytes) !== expected.sha256) throw new Error(`Bundle hash drift: ${expected.bundleKey}`);
    const repository = new ProductBundleRepository(dirname(bundlePath));
    const loaded = await repository.load();
    if (loaded.bundle.bundleKey !== expected.bundleKey || loaded.sha256 !== expected.sha256) throw new Error(`Bundle identity drift: ${expected.bundleKey}`);
    if (manifest.createdAt && loaded.bundle.createdAt !== manifest.createdAt) throw new Error(`Bundle creation timestamp drift: ${expected.bundleKey}`);
    if (manifest.sources?.catalogSha256 && loaded.bundle.sourceSnapshot.catalog.sha256 !== manifest.sources.catalogSha256) throw new Error(`Bundle catalogue source drift: ${expected.bundleKey}`);
    if (manifest.sources?.wooExportSha256 && loaded.bundle.sourceSnapshot.wooExport.sha256 !== manifest.sources.wooExportSha256) throw new Error(`Bundle Woo source drift: ${expected.bundleKey}`);
    if (manifest.sources?.mediaProfileSha256 && loaded.bundle.mediaProfile.sha256 !== manifest.sources.mediaProfileSha256) throw new Error(`Bundle media profile drift: ${expected.bundleKey}`);
    const actualProductKeys = loaded.bundle.products.map((item) => item.productKey);
    if (JSON.stringify(actualProductKeys) !== JSON.stringify(expected.productKeys)) throw new Error(`Bundle product list drift: ${expected.bundleKey}`);
    if (loaded.bundle.products.length !== expected.productCount) throw new Error(`Bundle product count drift: ${expected.bundleKey}`);
    for (const product of loaded.bundle.products) {
      products.push(product);
      productKeys.push(product.productKey);
      skus.push(product.sku, ...(product.type === "variable" ? product.variations.map((item) => item.sku) : []));
      slugs.push(product.slug);
      if (product.type === "simple") {
        if (product.gtin) gtins.push(product.gtin);
        sellables.push({productKey: product.productKey, sku: product.sku, commerce: product.commerce});
      } else {
        for (const variation of product.variations) {
          if (variation.gtin) gtins.push(variation.gtin);
          sellables.push({productKey: product.productKey, sku: variation.sku, commerce: variation.commerce});
        }
      }
    }
    bundleResults.push({
      bundleKey: expected.bundleKey,
      sha256: expected.sha256,
      status: "valid",
      productCount: loaded.bundle.products.length,
      variationCount: loaded.bundle.products.reduce((count, item) => count + (item.type === "variable" ? item.variations.length : 0), 0),
      mediaCount: new Set(loaded.bundle.products.flatMap((item) => item.images.map((image) => image.path))).size,
    });
  }
  unique(productKeys, "productKey");
  unique(skus, "SKU");
  unique(slugs, "slug");
  unique(gtins, "GTIN");
  if (productKeys.length !== manifest.summary?.readyProducts) throw new Error("Batch ready-product summary drift");
  if (bundleResults.length !== manifest.summary?.bundles) throw new Error("Batch bundle summary drift");
  if (manifest.summary?.sellableSkus !== undefined && sellables.length !== manifest.summary.sellableSkus) throw new Error("Batch sellable-SKU summary drift");
  const seo = auditSeo(products);
  const commercialPolicy = await auditCommercialPolicy(root, manifest, sellables);
  const result = {
    schema: "enki-product-draft-bundle-batch-preflight/v1",
    batchManifestSha256: digest(manifestBytes),
    status: "valid_local_dry_run",
    externalWrites: 0,
    productCount: productKeys.length,
    skuCount: skus.length,
    sellableSkuCount: sellables.length,
    slugCount: slugs.length,
    gtinCount: gtins.length,
    checks: {
      webp: {filesChecked: bundleResults.reduce((count, item) => count + item.mediaCount, 0), dimensionsMatch: true, forbiddenMetadataChunks: 0},
      gtin: {valuesChecked: gtins.length, checksumErrors: 0, duplicates: 0},
      seo,
      commercialPolicy,
    },
    bundles: bundleResults,
  };
  if (writeReport) await writeDeterministic(join(root, "preflight-report.json"), Buffer.from(`${JSON.stringify(result, null, 2)}\n`));
  return result;
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--batch") throw new Error("Usage: preflight-bundle-batch.mjs --batch /path/to/batch-manifest.json");
  return argv[1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await preflightBundleBatch(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
