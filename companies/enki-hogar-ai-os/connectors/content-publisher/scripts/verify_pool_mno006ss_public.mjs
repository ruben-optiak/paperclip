#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const EXPECTED_URL = "https://www.enkihogar.com/monomando-de-lavabo-pool/";
const EXPECTED_ID = 39914;
const EXPECTED_META_DESCRIPTION = "Monomando de lavabo Pool. Acero inoxidable 316L. Consulta acabados y ficha técnica de Sanycces.";
const EXPECTED_CTA = "Ver todos los productos de la serie Pool de Sanycces";
const EXPECTED_FINISHES = ["Níquel cepillado", "Metal Raw"];

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error(`Invalid argument: ${argv[index] ?? ""}`);
    values.set(argv[index], argv[index + 1]);
  }
  for (const required of ["--url", "--output", "--captured-at", "--publication-receipt"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  if (values.get("--url") !== EXPECTED_URL) throw new Error("Unexpected canary URL");
  return {
    url: values.get("--url"),
    output: resolve(values.get("--output")),
    capturedAt: values.get("--captured-at"),
    publicationReceipt: resolve(values.get("--publication-receipt")),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function tagContent(html, pattern) {
  return decodeHtml(html.match(pattern)?.[1] ?? "").trim();
}

function schemaTypes(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) schemaTypes(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const type = value["@type"];
  for (const item of Array.isArray(type) ? type : type ? [type] : []) output.add(String(item));
  for (const child of Object.values(value)) schemaTypes(child, output);
  return output;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {accept: "text/html,application/xhtml+xml", "user-agent": "EnkiCanaryVerifier/1.0"},
    redirect: "follow",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {status: response.status, finalUrl: response.url, bytes, text: bytes.toString("utf8")};
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {accept: "application/json", "user-agent": "EnkiCanaryVerifier/1.0"},
    redirect: "follow",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`Public Store API returned HTTP ${response.status}`);
  return {status: response.status, finalUrl: response.url, bytes, value: JSON.parse(bytes.toString("utf8"))};
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

const args = parseArgs(process.argv.slice(2));
const publicationReceiptBytes = await readFile(args.publicationReceipt);
const publicationReceipt = JSON.parse(publicationReceiptBytes);
if (publicationReceipt.schema !== "enki-pool-mno006ss-v16-publication-verification/v1"
  || publicationReceipt.target?.status !== "publish" || publicationReceipt.target?.catalogVisibility !== "visible"
  || publicationReceipt.summary?.otherParentsDraftHidden !== 23 || publicationReceipt.summary?.failures !== 0) {
  throw new Error("Completed MNO006SS publication receipt is required");
}

const [page, store] = await Promise.all([
  fetchText(args.url),
  fetchJson("https://www.enkihogar.com/wp-json/wc/store/v1/products?slug=monomando-de-lavabo-pool"),
]);
const html = page.text;
const canonical = tagContent(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)
  || tagContent(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
const metaDescription = tagContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
  || tagContent(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
const robots = tagContent(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["'][^>]*>/i)
  || tagContent(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["'][^>]*>/i);
const title = tagContent(html, /<title>([\s\S]*?)<\/title>/i);
const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean)
  .map((value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const types = [...schemaTypes(jsonLd)].sort();
const rows = Array.isArray(store.value) ? store.value : [];
const exact = rows.filter((row) => Number(row?.id) === EXPECTED_ID && row?.slug === "monomando-de-lavabo-pool");
if (exact.length !== 1) throw new Error("Public Store API does not expose exactly one MNO006SS canary");
const product = exact[0];
const finishAttribute = (product.attributes ?? []).find((attribute) => attribute?.taxonomy === "pa_acabado" || attribute?.name === "Acabado");
const finishTerms = (finishAttribute?.terms ?? []).map((term) => String(term?.name ?? "")).sort((left, right) => left.localeCompare(right, "es"));
const checks = {
  http200: page.status === 200,
  finalUrlExact: page.finalUrl === EXPECTED_URL,
  canonicalExact: canonical === EXPECTED_URL,
  indexable: !robots.toLowerCase().includes("noindex"),
  titleIdentifiesProduct: /monomando.*lavabo.*pool/i.test(title),
  metaDescriptionExact: metaDescription === EXPECTED_META_DESCRIPTION,
  productSchemaPresent: types.includes("Product"),
  offerSchemaPresent: types.includes("Offer") || types.includes("AggregateOffer"),
  ctaPresent: html.includes(EXPECTED_CTA),
  ctaStandaloneParagraph: /<p>\s*<a[^>]+href=["']https:\/\/www\.enkihogar\.com\/\?s=Sanycces\+Pool(?:&amp;|&)post_type=product["'][^>]*>Ver todos los productos de la serie Pool de Sanycces<\/a>\s*<\/p>/i.test(html),
  noInternalProcessLanguage: !/catálogo PDF suministrado|web oficial se usa|referencias del catálogo/i.test(html),
  storeApiProductVisible: exact.length === 1,
  storeApiPurchasable: product.is_purchasable === true,
  twoVariationsVisible: Array.isArray(product.variations) && product.variations.length === 2,
  finishesExact: sameArray(finishTerms, [...EXPECTED_FINISHES].sort((left, right) => left.localeCompare(right, "es"))),
  galleryHasExpectedMinimum: Array.isArray(product.images) && product.images.length >= 4,
};

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
const evidence = {
  schema: "enki-pool-mno006ss-public-page-verification/v1",
  capturedAt: args.capturedAt,
  source: {
    pageUrl: args.url,
    pageFinalUrl: page.finalUrl,
    pageHttpStatus: page.status,
    pageSha256: sha256(page.bytes),
    storeApiUrl: store.finalUrl,
    storeApiHttpStatus: store.status,
    storeApiSha256: sha256(store.bytes),
    publicationReceiptSha256: sha256(publicationReceiptBytes),
  },
  observed: {
    productId: Number(product.id),
    title,
    canonical,
    robots,
    metaDescription,
    schemaTypes: types,
    variationIds: product.variations ?? [],
    finishes: finishTerms,
    galleryImageCount: product.images?.length ?? 0,
  },
  checks,
  status: failed.length === 0 ? "PASS" : "FAIL",
  failedChecks: failed,
  externalWrites: 0,
};
await writeJsonAtomic(args.output, evidence);
console.log(JSON.stringify({status: evidence.status, failedChecks: failed, observed: evidence.observed, externalWrites: 0}, null, 2));
if (failed.length > 0) process.exitCode = 1;
