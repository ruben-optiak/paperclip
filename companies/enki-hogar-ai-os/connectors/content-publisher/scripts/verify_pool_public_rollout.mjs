#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFile, rename, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const ROLLOUT_MANIFEST_SHA256 = "a1fd74f1b0d169077f374eaf1dcd0f2cd108371c67ce7b1bdcc562baf8494d65";
const ROLLOUT_RECEIPT_SHA256 = "0898f3489bdb55b50c457e0f2350e5e1663fd0170f40a381ca6dbe1afd28bad8";
const CANARY_RECEIPT_SHA256 = "c11a675b2c4ac7ac659866decc0d42f65455df359757f53d02fcbf1b0e395365";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error(`Invalid argument: ${argv[index] ?? ""}`);
    values.set(argv[index], argv[index + 1]);
  }
  for (const required of ["--rollout-receipt", "--canary-receipt", "--output", "--captured-at"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  return {
    rolloutReceiptPath: resolve(values.get("--rollout-receipt")),
    canaryReceiptPath: resolve(values.get("--canary-receipt")),
    outputPath: resolve(values.get("--output")),
    capturedAt: values.get("--captured-at"),
  };
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

function canonicalFromHtml(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=["'][^"']*canonical[^"']*["']/i.test(tag)) continue;
    return tag.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "";
  }
  return "";
}

function robotsFromHtml(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname=["']robots["']/i.test(tag)) continue;
    return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? "";
  }
  return "";
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

async function verifyPage(item) {
  const expectedUrl = normalizeUrl(item.canonicalUrl);
  const response = await fetch(expectedUrl, {
    redirect: "follow",
    headers: {accept: "text/html", "user-agent": "EnkiPoolPublicRolloutVerifier/1.0"},
  });
  const html = await response.text();
  const canonical = canonicalFromHtml(html);
  const robots = robotsFromHtml(html);
  const normalizedHtml = html.replaceAll("&amp;", "&");
  const checks = {
    http200: response.status === 200,
    finalUrlExact: normalizeUrl(response.url) === expectedUrl,
    canonicalExact: canonical !== "" && normalizeUrl(canonical) === expectedUrl,
    indexable: !/\bnoindex\b/i.test(robots),
    productSchema: /["']@type["']\s*:\s*["']Product["']/i.test(html),
    seriesCta: normalizedHtml.includes("?s=Sanycces+Pool&post_type=product"),
    noInternalProcessLanguage: !/(ficha se ha preparado|catálogo PDF suministrado|web oficial se usa solo como enriquecimiento)/i.test(html),
  };
  return {
    sku: item.sku,
    url: expectedUrl,
    httpStatus: response.status,
    finalUrl: normalizeUrl(response.url),
    canonical: canonical ? normalizeUrl(canonical) : "",
    robots,
    checks,
    status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
  };
}

const args = parseArgs(process.argv.slice(2));
const [rolloutBytes, canaryBytes] = await Promise.all([
  readFile(args.rolloutReceiptPath),
  readFile(args.canaryReceiptPath),
]);
if (sha256(rolloutBytes) !== ROLLOUT_RECEIPT_SHA256) throw new Error("Rollout receipt hash mismatch");
if (sha256(canaryBytes) !== CANARY_RECEIPT_SHA256) throw new Error("Canary receipt hash mismatch");
const rollout = JSON.parse(rolloutBytes);
const canary = JSON.parse(canaryBytes);
if (rollout.rolloutManifestSha256 !== ROLLOUT_MANIFEST_SHA256 || rollout.summary?.failures !== 0
  || rollout.targets?.length !== 23 || canary.target?.status !== "publish") {
  throw new Error("Completed Pool publication receipts are required");
}

const items = [
  ...rollout.targets.map((target) => ({sku: target.sku, canonicalUrl: target.canonicalUrl})),
  {sku: canary.sku, canonicalUrl: canary.target.canonicalUrl},
].sort((left, right) => left.sku.localeCompare(right.sku));
const rows = [];
for (let index = 0; index < items.length; index += 4) {
  rows.push(...await Promise.all(items.slice(index, index + 4).map(verifyPage)));
}
const failures = rows.filter((row) => row.status !== "PASS");
const evidence = {
  schema: "enki-pool-public-rollout-verification/v1",
  capturedAt: args.capturedAt,
  rolloutManifestSha256: ROLLOUT_MANIFEST_SHA256,
  rolloutReceiptSha256: ROLLOUT_RECEIPT_SHA256,
  canaryReceiptSha256: CANARY_RECEIPT_SHA256,
  products: rows,
  summary: {
    productsChecked: rows.length,
    pass: rows.length - failures.length,
    fail: failures.length,
    http200: rows.filter((row) => row.checks.http200).length,
    canonicalExact: rows.filter((row) => row.checks.canonicalExact).length,
    indexable: rows.filter((row) => row.checks.indexable).length,
    productSchema: rows.filter((row) => row.checks.productSchema).length,
    seriesCta: rows.filter((row) => row.checks.seriesCta).length,
    noInternalProcessLanguage: rows.filter((row) => row.checks.noInternalProcessLanguage).length,
  },
  status: failures.length === 0 ? "PASS" : "FAIL",
  externalWrites: 0,
};
await writeJsonAtomic(args.outputPath, evidence);
console.log(JSON.stringify({status: evidence.status, ...evidence.summary, externalWrites: 0}, null, 2));
if (failures.length > 0) process.exitCode = 1;
