#!/usr/bin/env node
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";

const MAX_BODY_BYTES = 5_000_000;
const PLUGIN = /\/wp-content\/plugins\/([a-z0-9][a-z0-9_-]*)\//gi;
const THEME = /\/wp-content\/themes\/([a-z0-9][a-z0-9_-]*)\//gi;
const GENERATOR = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i;
const GTM = /\bGTM-[A-Z0-9]+\b/g;

function unique(values) {
  return [...new Set(values)].sort();
}

function captures(pattern, text) {
  return unique([...text.matchAll(pattern)].map((match) => match[1].toLowerCase()));
}

function fingerprint(values) {
  return values.length ? createHash("sha256").update(values.join("\n")).digest("hex") : null;
}

export function inspectHtml(html, baseUrl) {
  const plugins = captures(PLUGIN, html);
  const themes = captures(THEME, html);
  const generator = html.match(GENERATOR)?.[1] ?? null;
  const gtm = unique(html.match(GTM) ?? []);
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
  let canonicalSameOrigin = null;
  if (canonical) canonicalSameOrigin = new URL(canonical, baseUrl).origin === new URL(baseUrl).origin;
  return {
    generator,
    plugins,
    themes,
    gtm: {present: gtm.length > 0, count: gtm.length, fingerprintSha256: fingerprint(gtm), identifiersRetained: false},
    canonical: {present: canonical !== null, sameOrigin: canonicalSameOrigin},
    rawHtmlRetained: false,
  };
}

export function inspectHeaders(headers) {
  const selected = {};
  for (const name of ["server", "x-powered-by", "cf-cache-status", "x-cache", "x-cache-status", "x-litespeed-cache", "cache-control"]) {
    const value = headers.get(name);
    if (value) selected[name] = value.slice(0, 300);
  }
  return selected;
}

async function boundedText(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BODY_BYTES) throw new Error(`Response exceeds ${MAX_BODY_BYTES} bytes`);
  return buffer.toString("utf8");
}

export async function inspectPublicWordPress(input, {fetchImpl = fetch, now = () => new Date()} = {}) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Use a clean HTTPS origin URL without credentials, query or fragment");
  url.pathname = "/";
  const restUrl = new URL("/wp-json/", url);
  const [homepageResponse, restResponse] = await Promise.all([
    fetchImpl(url, {method: "GET", redirect: "follow", headers: {"user-agent": "EnkiTechnicalInventory/1.0"}}),
    fetchImpl(restUrl, {method: "GET", redirect: "follow", headers: {"user-agent": "EnkiTechnicalInventory/1.0"}}),
  ]);
  const homepage = await boundedText(homepageResponse);
  const restText = await boundedText(restResponse);
  let rest = {};
  try { rest = JSON.parse(restText); } catch { rest = {}; }
  const namespaces = unique(Array.isArray(rest.namespaces) ? rest.namespaces.filter((value) => typeof value === "string") : []);
  return {
    schema: "enki-wordpress-public-snapshot/v1",
    observedAt: now().toISOString(),
    origin: url.origin,
    requests: {methods: ["GET"], homepageStatus: homepageResponse.status, restStatus: restResponse.status},
    wordpress: {...inspectHtml(homepage, url), restNamespaces: namespaces},
    infrastructureSignals: {homepageHeaders: inspectHeaders(homepageResponse.headers), restHeaders: inspectHeaders(restResponse.headers)},
    unknown: {activePluginVersions: true, snippets: true, consentConfiguration: true, changeHistory: true},
    authority: {publicObservationOnly: true, containsCredentials: false, containsPii: false, isMutationAuthority: false},
  };
}

async function main() {
  const target = process.argv[2];
  if (!target || process.argv.length !== 3) throw new Error("Usage: inspect-public-wordpress.mjs https://example.invalid/");
  process.stdout.write(`${JSON.stringify(await inspectPublicWordPress(target), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
