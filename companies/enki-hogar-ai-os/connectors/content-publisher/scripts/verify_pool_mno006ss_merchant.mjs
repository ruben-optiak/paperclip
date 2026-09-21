#!/usr/bin/env node

import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const CONTENT_SCOPE = "https://www.googleapis.com/auth/content";
const EXPECTED_BUNDLE_SHA256 = "f56e19856fb2df28df4989ff4f7c2a09d36c7c8cdb34890694b7391cc8aca10c";
const EXPECTED_PRODUCT_KEY = "sanycces-pool-mno006ss";
const EXPECTED_CANONICAL = "https://www.enkihogar.com/monomando-de-lavabo-pool/";
const EXPECTED_VARIATIONS = new Map([
  ["MNO006SSNB", {wooId: "39915", gtin: "8435737779080", imageToken: "pool-mno-nb", finish: "Níquel cepillado"}],
  ["MNO006SSRM", {wooId: "39916", gtin: "8435737779097", imageToken: "pool-mno-rm", finish: "Metal Raw"}],
]);

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error(`Invalid argument: ${argv[index] ?? ""}`);
    values.set(argv[index], argv[index + 1]);
  }
  for (const required of ["--adc", "--bundle", "--publication-receipt", "--output", "--captured-at"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  return {
    adc: resolve(values.get("--adc")),
    bundle: resolve(values.get("--bundle")),
    publicationReceipt: resolve(values.get("--publication-receipt")),
    output: resolve(values.get("--output")),
    capturedAt: values.get("--captured-at"),
    accountId: values.get("--account-id") ?? null,
    accountDisplayName: values.get("--account-display-name") ?? "Enki Hogar",
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    url.hash = "";
    return url.href;
  } catch {
    return String(value ?? "").trim();
  }
}

function priceAmount(value) {
  if (!value || typeof value !== "object") return null;
  const micros = Number(value.amountMicros);
  if (!Number.isFinite(micros)) return null;
  return {amount: (micros / 1_000_000).toFixed(2), currency: String(value.currencyCode ?? "")};
}

function gtins(attributes) {
  const values = attributes?.gtins ?? attributes?.gtin ?? [];
  return (Array.isArray(values) ? values : [values]).map(String).filter(Boolean);
}

function identifiers(product) {
  const attributes = product?.productAttributes ?? {};
  return new Set([
    product?.offerId,
    attributes?.mpn,
    ...gtins(attributes),
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
}

function expectedVariation(product, expectedBySku) {
  const ids = identifiers(product);
  for (const [sku, expected] of expectedBySku) {
    if (ids.has(sku) || ids.has(expected.wooId) || ids.has(expected.gtin)) return {sku, expected};
  }
  return null;
}

function statusSummary(product) {
  const status = product?.productStatus ?? {};
  const destinations = (status.destinationStatuses ?? []).map((item) => ({
    reportingContext: String(item.reportingContext ?? ""),
    approvedCountries: [...(item.approvedCountries ?? [])].map(String).sort(),
    pendingCountries: [...(item.pendingCountries ?? [])].map(String).sort(),
    disapprovedCountries: [...(item.disapprovedCountries ?? [])].map(String).sort(),
  }));
  const issues = (status.itemLevelIssues ?? []).map((issue) => ({
    code: String(issue.code ?? ""),
    severity: String(issue.severity ?? ""),
    attribute: String(issue.attribute ?? ""),
    reportingContext: String(issue.reportingContext ?? ""),
    applicableCountries: [...(issue.applicableCountries ?? [])].map(String).sort(),
    description: String(issue.description ?? ""),
  }));
  return {
    destinations,
    issues,
    approvedForSpain: destinations.some((item) => item.approvedCountries.includes("ES")),
    pendingForSpain: destinations.some((item) => item.pendingCountries.includes("ES")),
    disapprovedForSpain: destinations.some((item) => item.disapprovedCountries.includes("ES"))
      || issues.some((issue) => issue.severity === "DISAPPROVED" && issue.applicableCountries.includes("ES")),
  };
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

async function accessToken(adc) {
  try {
    const {stdout} = await execFileAsync("gcloud", [
      "auth",
      "application-default",
      "print-access-token",
      `--scopes=${CONTENT_SCOPE}`,
    ], {
      env: {
        ...process.env,
        CLOUDSDK_CONFIG: dirname(adc),
        CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: adc,
      },
      maxBuffer: 1024 * 1024,
    });
    const token = stdout.trim();
    if (!token) throw new Error("gcloud returned an empty access token");
    return token;
  } catch (error) {
    const detail = `${error?.stderr ?? ""} ${error?.message ?? ""}`;
    if (/Invalid (?:value for \[--scopes\]|scopes value)|scopes previously specified/i.test(detail)) {
      throw new Error(`Google ADC lacks the required Merchant read scope: ${CONTENT_SCOPE}`);
    }
    throw new Error("Unable to obtain a Google Merchant access token from the configured ADC");
  }
}

async function merchantJson(url, token) {
  const response = await fetch(url, {
    headers: {accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "EnkiMerchantCanaryVerifier/1.0"},
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    let apiError = {};
    try {
      apiError = JSON.parse(bytes.toString("utf8")).error ?? {};
    } catch {
      // Keep remote response bodies out of logs and evidence.
    }
    const reason = (apiError.details ?? []).find((detail) => detail?.reason)?.reason;
    if (reason === "SERVICE_DISABLED") throw new Error("Merchant API is disabled for the configured OAuth project");
    const status = String(apiError.status ?? "").replace(/[^A-Z_]/g, "");
    throw new Error(`Merchant API returned HTTP ${response.status}${status ? ` (${status})` : ""}`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

async function listProducts(accountName, token) {
  const products = [];
  let pageToken = "";
  let pages = 0;
  do {
    const url = new URL(`https://merchantapi.googleapis.com/products/v1/${accountName}/products`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await merchantJson(url, token);
    products.push(...(page.products ?? []));
    pageToken = String(page.nextPageToken ?? "");
    pages += 1;
  } while (pageToken);
  return {products, pages};
}

const args = parseArgs(process.argv.slice(2));
const [bundleBytes, receiptBytes] = await Promise.all([readFile(args.bundle), readFile(args.publicationReceipt)]);
if (sha256(bundleBytes) !== EXPECTED_BUNDLE_SHA256) throw new Error("The exact approved MNO006SS bundle is required");
const bundle = JSON.parse(bundleBytes);
const receipt = JSON.parse(receiptBytes);
if (receipt.target?.externalId !== 39914 || receipt.target?.status !== "publish"
  || receipt.target?.catalogVisibility !== "visible" || receipt.summary?.otherParentsDraftHidden !== 23) {
  throw new Error("Completed MNO006SS public-canary receipt is required");
}
const candidate = (bundle.products ?? []).find((product) => product.productKey === EXPECTED_PRODUCT_KEY);
if (!candidate) throw new Error("MNO006SS is missing from the reviewed bundle");
const expectedBySku = new Map((candidate.variations ?? []).map((variation) => {
  const fixed = EXPECTED_VARIATIONS.get(variation.sku);
  if (!fixed || fixed.gtin !== variation.gtin) throw new Error(`Unexpected reviewed variation ${variation.sku}`);
  return [variation.sku, {
    ...fixed,
    regularPrice: variation.commerce?.regularPrice,
    salePrice: variation.commerce?.salePrice,
  }];
}));
if (expectedBySku.size !== 2) throw new Error("Exactly two reviewed MNO006SS variations are required");

const token = await accessToken(args.adc);
let account;
if (args.accountId) {
  account = await merchantJson(`https://merchantapi.googleapis.com/accounts/v1/accounts/${encodeURIComponent(args.accountId)}`, token);
  if (String(account.accountName ?? "").trim() !== args.accountDisplayName) {
    throw new Error(`Merchant account ${args.accountId} does not match the expected account name`);
  }
} else {
  const accountsPage = await merchantJson("https://merchantapi.googleapis.com/accounts/v1/accounts?pageSize=500", token);
  const accountMatches = (accountsPage.accounts ?? []).filter((candidateAccount) => (
    String(candidateAccount.accountName ?? "").trim() === args.accountDisplayName
  ));
  if (accountMatches.length !== 1) throw new Error(`Expected one Merchant account named ${args.accountDisplayName}; found ${accountMatches.length}`);
  [account] = accountMatches;
}
const inventory = await listProducts(account.name, token);
const matched = inventory.products.map((product) => ({product, match: expectedVariation(product, expectedBySku)})).filter((row) => row.match);

const expectedShort = normalizeText(candidate.shortDescriptionHtml);
const expectedLong = normalizeText(candidate.descriptionHtml);
const rows = matched.map(({product, match}) => {
  const attributes = product.productAttributes ?? {};
  const merchantDescription = normalizeText(attributes.description);
  const currentPrice = priceAmount(attributes.price);
  const salePrice = priceAmount(attributes.salePrice);
  const effectivePrice = salePrice ?? currentPrice;
  const status = statusSummary(product);
  const productGtins = gtins(attributes);
  const productUrl = normalizeUrl(attributes.link);
  const imageUrl = normalizeUrl(attributes.imageLink);
  const checks = {
    offerIdentityExact: identifiers(product).has(match.sku) || identifiers(product).has(match.expected.wooId),
    mpnExact: String(attributes.mpn ?? "") === match.sku,
    gtinExact: productGtins.includes(match.expected.gtin),
    linkExact: productUrl === EXPECTED_CANONICAL,
    brandExact: String(attributes.brand ?? "").trim().toLowerCase() === "sanycces",
    titleIdentifiesProduct: /monomando.*lavabo.*pool/i.test(String(attributes.title ?? "")),
    priceExact: effectivePrice?.amount === match.expected.salePrice && effectivePrice?.currency === "EUR",
    regularPriceCoherent: currentPrice?.currency === "EUR"
      && [match.expected.regularPrice, match.expected.salePrice].includes(currentPrice.amount),
    availabilityInStock: /^(in.?stock|en.?stock)$/i.test(String(attributes.availability ?? "").replaceAll("_", " ")),
    variationImageExact: imageUrl.toLowerCase().includes(match.expected.imageToken),
    descriptionMapped: merchantDescription === expectedShort || merchantDescription === expectedLong,
    notDisapprovedForSpain: status.disapprovedForSpain === false,
  };
  return {
    sku: match.sku,
    finish: match.expected.finish,
    offerId: String(product.offerId ?? ""),
    feedLabel: String(product.feedLabel ?? ""),
    contentLanguage: String(product.contentLanguage ?? ""),
    dataSourceSha256: sha256(String(product.dataSource ?? "")),
    observed: {
      title: String(attributes.title ?? ""),
      descriptionMapping: merchantDescription === expectedShort ? "woo_short_description"
        : merchantDescription === expectedLong ? "woo_long_description" : "other",
      description: merchantDescription,
      link: productUrl,
      imageLink: imageUrl,
      brand: String(attributes.brand ?? ""),
      mpn: String(attributes.mpn ?? ""),
      gtins: productGtins,
      price: currentPrice,
      salePrice,
      availability: String(attributes.availability ?? ""),
      archived: product.archived === true,
      status,
    },
    checks,
    failedChecks: Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key),
  };
}).sort((left, right) => left.sku.localeCompare(right.sku));

const cardinalityExact = rows.length === 2 && new Set(rows.map((row) => row.sku)).size === 2;
const fieldFailures = rows.flatMap((row) => row.failedChecks.map((check) => `${row.sku}:${check}`));
const pending = rows.some((row) => row.observed.status.pendingForSpain || !row.observed.status.approvedForSpain);
const verdict = !cardinalityExact ? (rows.length === 0 ? "PENDING" : "FAIL")
  : fieldFailures.length > 0 ? "FAIL"
    : pending ? "PENDING" : "PASS";
const evidence = {
  schema: "enki-pool-mno006ss-merchant-canary-verification/v1",
  capturedAt: args.capturedAt,
  source: {
    api: "Google Merchant API v1",
    accountDisplayName: args.accountDisplayName,
    accountResourceSha256: sha256(String(account.name ?? "")),
    bundleSha256: sha256(bundleBytes),
    publicationReceiptSha256: sha256(receiptBytes),
    contentScope: CONTENT_SCOPE,
  },
  scan: {pages: inventory.pages, processedProducts: inventory.products.length, matchedProducts: rows.length},
  products: rows,
  checks: {twoVariationsPresent: cardinalityExact, fieldFailures},
  status: verdict,
  externalWrites: 0,
};
await writeJsonAtomic(args.output, evidence);
console.log(JSON.stringify({status: verdict, scan: evidence.scan, products: rows.map((row) => ({sku: row.sku, failedChecks: row.failedChecks, status: row.observed.status})), externalWrites: 0}, null, 2));
if (verdict === "FAIL") process.exitCode = 1;
else if (verdict === "PENDING") process.exitCode = 2;
