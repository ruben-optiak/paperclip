#!/usr/bin/env node
// Host writes only a sanitized receipt. Raw responses and identifiers stay in the connector.
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

const ALLOWED = new Map([[8011, new Set(["get_account_summaries", "get_property_details", "run_report"])],
  [8012, new Set(["gsc_search_analytics", "gsc_inspect_url", "gsc_list_sitemaps"])]]);
const PACIFIC = "America/Los_Angeles";
let remainingCalls = 600;
const safeDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(value) ? value : null;

export function decodeMcp(text) {
  const messages = text.trim().startsWith("{") ? [JSON.parse(text)] : text.split(/\r?\n/)
    .filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
  const reply = messages.findLast(item => item.result || item.error);
  if (!reply || reply.error || reply.result?.isError) throw new Error("provider_error");
  const content = (reply.result.content ?? []).filter(block => block.type === "text").map(block => block.text).join("\n");
  if (/invalid_grant/i.test(content)) throw new Error("oauth_invalid_grant");
  let value;
  try { value = JSON.parse(content); } catch { return decodeGscText(content); }
  if (!value || value.error) throw new Error("provider_error");
  return value;
}

export function decodeGscText(content) {
  if (content.includes("--- Response truncated")) throw new Error("gsc_transport_truncated");
  if (content === "No search analytics data for the specified range.") return {rows: []};
  if (content === "No sitemaps found for this site.") return {sitemap: []};
  if (content.startsWith("# Search Console:")) {
    const count = Number(content.match(/\| (\d+) rows\*/)?.[1]);
    const lines = content.split("\n").filter(line => line.startsWith("| "));
    const headers = lines[0]?.slice(2, -2).split(" | ");
    if (!headers || headers.slice(-4).join() !== "clicks,impressions,ctr,position") throw new Error("unexpected_gsc_table");
    const dimensions = headers.length - 4;
    const rows = lines.slice(2).map(line => {
      const cells = line.slice(2, -2).split(" | ");
      if (cells.length !== headers.length) throw new Error("ambiguous_gsc_table_cell");
      return {keys: cells.slice(0, dimensions), clicks: numeric(cells[dimensions]),
        impressions: numeric(cells[dimensions + 1]), position: numeric(cells[dimensions + 3])};
    });
    if (!Number.isInteger(count) || count !== rows.length) throw new Error("gsc_table_row_count_mismatch");
    return {rows, positionPrecision: 0.1};
  }
  if (content.startsWith("URL: ")) {
    const names = {"Verdict": "verdict", "Coverage state": "coverageState", "Indexing state": "indexingState",
      "Last crawl time": "lastCrawlTime", "Crawled as": "crawledAs", "Robots.txt state": "robotsTxtState", "Page fetch state": "pageFetchState"};
    const indexStatusResult = {};
    for (const line of content.split("\n")) {
      const split = line.indexOf(": ");
      const key = names[line.slice(0, split)];
      if (key) indexStatusResult[key] = line.slice(split + 2);
    }
    if (!indexStatusResult.verdict) throw new Error("unexpected_inspection_response");
    return {inspectionResult: {indexStatusResult}, canonicalFieldsExposed: false};
  }
  if (content.startsWith("# Sitemaps for ")) {
    const sitemap = content.split("\n## ").slice(1).map(block => ({path: block.split("\n")[0],
      lastSubmitted: block.match(/\*\*Last submitted\*\*: ([^\n]+)/)?.[1],
      lastDownloaded: block.match(/\*\*Last downloaded\*\*: ([^\n]+)/)?.[1],
      errors: block.match(/\*\*Errors\*\*: (\d+)/)?.[1], warnings: block.match(/\*\*Warnings\*\*: (\d+)/)?.[1]}));
    if (!sitemap.length || sitemap.some(item => item.errors === undefined || item.warnings === undefined)) throw new Error("unexpected_sitemap_table");
    return {sitemap};
  }
  throw new Error("unexpected_response");
}

export function publicUrl(value, origin) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, origin + "/");
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password || url.search ||
        /[?@#\\\x00-\x1f]/.test(path) || /\b\d{9,}\b/.test(path) ||
        /\/(wp-admin|wp-json|wp-login\.php|cart|checkout|my-account|carrito|finalizar-compra|mi-cuenta|order-pay|order-received)(\/|$)/i.test(path)) return null;
    return url.origin + url.pathname;
  } catch { return null; }
}

function numeric(value, integer = false) {
  if (!(typeof value === "number" || typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) throw new Error("invalid_metric");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || integer && !Number.isSafeInteger(number)) throw new Error("invalid_metric");
  return number;
}

export function envelope(data, source, period, timezone, warnings = [], partial = false) {
  if (!["Europe/Madrid", PACIFIC].includes(timezone)) throw new Error("unsupported_source_timezone");
  return {schema: "enki-evidence-envelope/v1", data, meta: {source, fetched_at: new Date().toISOString(),
    period_start: period?.start ?? null, period_end: period?.end ?? null, timezone,
    currency: null, currencies: [], freshness: "live", status: partial ? "partial" : "ok", partial,
    warnings, contracts: ["enki-evidence-envelope/v1", "enki-seo-pipeline-config/v1"]}};
}

export function selectProperty(accounts) {
  if (!Array.isArray(accounts)) throw new Error("unexpected_account_response");
  const matches = accounts.flatMap(account => account.property_summaries ?? [])
    .filter(property => /^enki(?:\s+hogar)?(?:\s*-\s*ga4)?$/i.test(property.display_name?.trim() ?? ""));
  if (matches.length !== 1 || !/^properties\/\d+$/.test(matches[0].property)) throw new Error("ambiguous_enki_property");
  return matches[0].property;
}

export function normalizeGsc(raw, dimensions, known, origin) {
  if (!Array.isArray(raw.rows) && Object.keys(raw).some(key => !["responseAggregationType"].includes(key))) throw new Error("unexpected_gsc_response");
  const rows = [], seen = new Set();
  let excluded = 0, truncatedDimensions = 0;
  for (const row of raw.rows ?? []) {
    if (!Array.isArray(row.keys) || row.keys.length !== dimensions.length) throw new Error("unexpected_gsc_dimensions");
    if (row.keys.some(value => typeof value === "string" && value.length === 80 && value.endsWith("..."))) { truncatedDimensions++; continue; }
    const url = publicUrl(row.keys[dimensions.indexOf("page")], origin);
    if (!url || !known.has(url)) { excluded++; continue; }
    const value = {url, clicks: numeric(row.clicks), impressions: numeric(row.impressions), position: numeric(row.position)};
    if (value.clicks > value.impressions) throw new Error("invalid_metric");
    if (dimensions.includes("query")) {
      const query = row.keys[dimensions.indexOf("query")];
      if (typeof query !== "string") throw new Error("unexpected_query");
      value.querySha256 = createHash("sha256").update(query).digest("hex");
    }
    const identity = (value.querySha256 ?? "") + ":" + url;
    if (seen.has(identity)) throw new Error("duplicate_gsc_row");
    seen.add(identity); rows.push(value);
  }
  return {rows, returnedRows: raw.rows?.length ?? 0, excludedOutsidePublicScope: excluded, truncatedDimensions};
}

export function normalizeGa4(raw, known, origin, timezone) {
  if (raw.dimension_headers?.map(item => item.name).join() !== "pagePath" ||
      raw.metric_headers?.map(item => item.name).join() !== "screenPageViews") throw new Error("unexpected_ga4_headers");
  const metadata = raw.metadata;
  if (!metadata || metadata.time_zone !== timezone) throw new Error("ga4_timezone_mismatch");
  const coverage = {returnedRows: raw.rows?.length ?? 0, totalRows: numeric(raw.row_count ?? 0, true),
    excludedOutsidePublicScope: 0, sampled: (metadata.sampling_metadatas?.length ?? 0) > 0,
    dataLossFromOtherRow: metadata.data_loss_from_other_row === true,
    subjectToThresholding: metadata.subject_to_thresholding === true,
    metricRestricted: (metadata.schema_restriction_response?.active_metric_restrictions?.length ?? 0) > 0};
  if (coverage.totalRows < coverage.returnedRows) throw new Error("invalid_ga4_row_count");
  const rows = [], seen = new Set();
  for (const row of raw.rows ?? []) {
    const path = row.dimension_values?.[0]?.value;
    const url = typeof path === "string" && path.startsWith("/") ? publicUrl(path, origin) : null;
    if (!url || !known.has(url)) { coverage.excludedOutsidePublicScope++; continue; }
    if (seen.has(url)) throw new Error("duplicate_ga4_row");
    seen.add(url); rows.push({url, pageViews: numeric(row.metric_values?.[0]?.value, true)});
  }
  return {rows, coverage, partial: coverage.sampled || coverage.dataLossFromOtherRow || coverage.subjectToThresholding ||
    coverage.metricRestricted || coverage.returnedRows < coverage.totalRows};
}

async function call(port, tool, args) {
  if (!ALLOWED.get(port)?.has(tool)) throw new Error("tool_not_allowed");
  if (--remainingCalls < 0) throw new Error("capture_request_limit");
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: {"content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${process.env.GOOGLE_MCP_TOKEN}`},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: tool, arguments: args}}),
  });
  if (!response.ok) throw new Error("connector_http_error");
  const text = await response.text();
  if (text.length > 16000000) throw new Error("response_limit");
  return decodeMcp(text);
}

async function mapBounded(values, callback) {
  const result = new Array(values.length);
  let index = 0;
  await Promise.all(Array.from({length: Math.min(4, values.length)}, async () => {
    while (index < values.length) { const at = index++; result[at] = await callback(values[at]); }
  }));
  return result;
}

export async function gscPeriod(config, period, dimensions, known, exactUrl = null) {
  const rows = [], pages = [], seen = new Set();
  const recoveryCandidates = new Set();
  let truncated = false, lostQueries = 0;
  const requestedDimensions = exactUrl ? dimensions.filter(dimension => dimension !== "page") : dimensions;
  for (let page = 0; page < config.sources.gsc.maxPages; page++) {
    const raw = envelope(await call(8012, "gsc_search_analytics", {site_url: "sc-domain:enkihogar.com",
      start_date: period.start, end_date: period.end, dimensions: requestedDimensions, type: "web",
      ...(exactUrl ? {dimension_filters: [{dimension: "page", operator: "equals", expression: exactUrl}]} : {}),
      row_limit: config.sources.gsc.rowLimit, start_row: page * config.sources.gsc.rowLimit}), "gsc", period, PACIFIC,
      ["top_rows_only_not_exhaustive", "public_snapshot_scope", "position_rounded_to_0_1_by_connector"]);
    if (exactUrl) raw.data.rows = (raw.data.rows ?? []).map(row => ({...row, keys: [...row.keys, exactUrl]}));
    const pageAt = dimensions.indexOf("page");
    for (const row of raw.data.rows ?? []) {
      const pageKey = row.keys?.[pageAt];
      if (!exactUrl && pageKey?.length === 80 && pageKey.endsWith("...")) {
        for (const url of known) if (url.startsWith(pageKey.slice(0, -3))) recoveryCandidates.add(url);
      }
      if (dimensions.includes("query") && row.keys?.[0]?.length === 80 && row.keys[0].endsWith("...")) lostQueries++;
    }
    // Exact page filters prove URL identity even when its rendered cell would be truncated.
    let normalized;
    if (exactUrl) {
      const placeholder = config.origin + "/";
      const transport = {...raw.data, rows: raw.data.rows.map(row => ({...row, keys: row.keys.map((key, at) => at === pageAt ? placeholder : key)}))};
      normalized = normalizeGsc(transport, dimensions, new Set([placeholder]), config.origin);
      normalized.rows = normalized.rows.map(row => ({...row, url: exactUrl}));
    } else normalized = normalizeGsc(raw.data, dimensions, known, config.origin);
    for (const row of normalized.rows) {
      const key = (row.querySha256 ?? "") + ":" + row.url;
      if (seen.has(key)) throw new Error("duplicate_gsc_pagination");
      seen.add(key); rows.push(row);
    }
    pages.push({startRow: page * config.sources.gsc.rowLimit, returnedRows: normalized.returnedRows,
      excludedOutsidePublicScope: normalized.excludedOutsidePublicScope, truncatedDimensions: normalized.truncatedDimensions,
      evidenceMeta: raw.meta});
    truncated = normalized.returnedRows === config.sources.gsc.rowLimit;
    if (!truncated) break;
  }
  const candidates = [...recoveryCandidates].sort();
  if (candidates.length > 150) throw new Error("exact_url_recovery_limit");
  const recovery = exactUrl ? [] : await mapBounded(candidates, async url => ({url, ...await gscPeriod(config, period, dimensions, known, url)}));
  for (const recovered of recovery) {
    for (const row of recovered.rows) {
      const key = (row.querySha256 ?? "") + ":" + row.url;
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    }
  }
  return {...period, rows, pages, truncated: truncated || recovery.some(item => item.truncated),
    queryCellsOmittedAsTruncated: lostQueries + recovery.reduce((sum, item) => sum + item.queryCellsOmittedAsTruncated, 0), positionPrecision: 0.1,
    recovery: recovery.map(item => ({url: item.url, rowsRecovered: item.rows.length, pages: item.pages,
      queryCellsOmittedAsTruncated: item.queryCellsOmittedAsTruncated}))};
}

export function normalizeInspection(raw, url, origin) {
  const status = raw.inspectionResult?.indexStatusResult;
  if (!status) throw new Error("unexpected_inspection_response");
  const value = {url, capturedAt: new Date().toISOString(), lastCrawlTime: safeDate(status.lastCrawlTime),
    userCanonical: publicUrl(status.userCanonical, origin), googleCanonical: publicUrl(status.googleCanonical, origin),
    canonicalFieldsExposed: raw.canonicalFieldsExposed !== false};
  for (const key of ["verdict", "coverageState", "robotsTxtState", "indexingState", "pageFetchState", "crawledAs"]) {
    const text = status[key];
    value[key] = typeof text === "string" && text.length < 160 && !/[@\n\r]|https?:/i.test(text) ? text : null;
  }
  return value;
}

export async function capture(input) {
  remainingCalls = 600;
  const {config} = input;
  if (config.origin !== "https://www.enkihogar.com" || config.periods.length !== 2 ||
      config.sources.gsc.maxPages > 100 || config.sources.gsc.rowLimit > 100 || config.sources.ga4.limit > 250000) throw new Error("invalid_capture_config");
  const known = new Set(input.knownUrls.filter(url => publicUrl(url, config.origin) === url));
  if (!known.size || known.size > 10000) throw new Error("invalid_public_scope");
  const capturedAt = new Date().toISOString();
  const output = {schema: "enki-seo-source-capture/v1", capturedAt, configVersion: config.version,
    scope: {publicSnapshotSha256: input.snapshotSha256, publicUrls: known.size, match: "exact_url_in_snapshot_inventory_or_sample",
      rawQueryTextRetained: false, privateIdentifiersRetained: false},
    authority: {externalMutation: false, credentialsRetained: false}};
  try {
    const periods = [];
    for (const period of config.periods) periods.push(await gscPeriod(config, period, ["page"], known));
    const truncated = periods.some(period => period.truncated);
    output.gsc = {status: truncated ? "partial" : "available", capturedAt: new Date().toISOString(), truncated, timezone: PACIFIC, periods};
  } catch (error) { output.gsc = {status: "unavailable", reason: safeError(error)}; }
  try {
    const period = config.periods.at(-1);
    const data = await gscPeriod(config, period, ["query", "page"], known);
    output.gscOverlap = {status: data.truncated || data.queryCellsOmittedAsTruncated ? "partial" : "available", capturedAt: new Date().toISOString(),
      truncated: data.truncated, timezone: PACIFIC, period, rows: data.rows, pages: data.pages, recovery: data.recovery,
      queryCellsOmittedAsTruncated: data.queryCellsOmittedAsTruncated,
      interpretation: "query_hashes_are_pseudonymous_not_anonymous_overlap_not_proven_cannibalization"};
  } catch (error) { output.gscOverlap = {status: "unavailable", reason: safeError(error)}; }
  try {
    const property = selectProperty(await call(8011, "get_account_summaries", {}));
    const details = await call(8011, "get_property_details", {property_id: property});
    const timezone = details.time_zone;
    if (timezone !== "Europe/Madrid") throw new Error("unsupported_ga4_property_timezone");
    const periods = [];
    for (const period of config.periods) {
      const raw = envelope(await call(8011, "run_report", {property_id: property,
        date_ranges: [{start_date: period.start, end_date: period.end}], dimensions: ["pagePath"], metrics: ["screenPageViews"],
        dimension_filter: {filter: {field_name: "hostName", string_filter: {match_type: 1, value: new URL(config.origin).hostname, case_sensitive: true}}},
        limit: config.sources.ga4.limit, offset: 0, order_bys: [{dimension: {dimension_name: "pagePath", order_type: 1}}]}), "ga4", period, timezone);
      const result = normalizeGa4(raw.data, known, config.origin, timezone);
      periods.push({...period, ...result, evidenceMeta: {...raw.meta, status: result.partial ? "partial" : "ok", partial: result.partial,
        warnings: result.partial ? ["report_quality_or_row_limit"] : ["public_snapshot_scope", "directional_not_commercial_truth"]}});
    }
    output.ga4 = {status: periods.some(period => period.partial) ? "partial" : "available", capturedAt: new Date().toISOString(),
      truncated: periods.some(period => period.coverage.returnedRows < period.coverage.totalRows), timezone,
      propertySelection: "unique_exact_enki_display_name_inside_connector", hostnameFilter: new URL(config.origin).hostname, periods};
  } catch (error) { output.ga4 = {status: "unavailable", reason: safeError(error)}; }
  try {
    const raw = envelope(await call(8012, "gsc_list_sitemaps", {site_url: "sc-domain:enkihogar.com"}), "gsc", null, PACIFIC);
    if (!Array.isArray(raw.data.sitemap)) throw new Error("unexpected_sitemap_response");
    output.sitemaps = {status: "available", capturedAt: new Date().toISOString(), evidenceMeta: raw.meta,
      rows: raw.data.sitemap.filter(item => publicUrl(item.path, config.origin)).map(item => ({url: publicUrl(item.path, config.origin),
        lastSubmitted: safeDate(item.lastSubmitted), lastDownloaded: safeDate(item.lastDownloaded),
        isPending: typeof item.isPending === "boolean" ? item.isPending : null,
        isSitemapsIndex: typeof item.isSitemapsIndex === "boolean" ? item.isSitemapsIndex : null,
        warnings: numeric(item.warnings ?? 0, true), errors: numeric(item.errors ?? 0, true)}))};
  } catch (error) { output.sitemaps = {status: "unavailable", reason: safeError(error)}; }
  const demandUrls = [...(output.gsc?.periods?.at(-1)?.rows ?? [])].sort((a, b) => b.impressions - a.impressions).slice(0, 10).map(row => row.url);
  const inspect = [...new Set([...input.inspectionUrls, ...demandUrls])].filter(url => known.has(url)).slice(0, 20);
  const rows = await mapBounded(inspect, async url => {
    try {
      const raw = envelope(await call(8012, "gsc_inspect_url", {site_url: "sc-domain:enkihogar.com", inspection_url: url}), "gsc", null, PACIFIC);
      return {...normalizeInspection(raw.data, url, config.origin), evidenceMeta: raw.meta};
    } catch (error) { return {url, status: "unavailable", reason: safeError(error)}; }
  });
  output.inspection = {status: rows.some(row => row.status === "unavailable") ? "partial" : "available", capturedAt: new Date().toISOString(),
    scope: "bounded_technical_and_top_impression_sample", liveUrlTest: false, rows};
  output.logicalRequests = 600 - remainingCalls;
  return output;
}

function safeError(error) {
  const text = error instanceof Error ? error.message : "";
  return /^[a-z_]{3,60}$/.test(text) ? text : "capture_failed";
}

function hostMain() {
  const [configPath, snapshotPath, outputPath] = process.argv.slice(2);
  if (!configPath || !snapshotPath || !outputPath || existsSync(outputPath)) throw new Error("new_config_snapshot_output_paths_required");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const bytes = readFileSync(snapshotPath);
  const snapshot = JSON.parse(bytes);
  if (snapshot.origin !== config.origin) throw new Error("snapshot_origin_mismatch");
  const inspectionUrls = snapshot.pages.filter(page => page.signals?.noindex || page.signals?.h1Count === 0 ||
    snapshot.pages.some(other => other.url !== page.url && page.signals?.titleSha256 && other.signals?.titleSha256 === page.signals.titleSha256)).map(page => page.url);
  const input = {config, snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    knownUrls: [...new Set([...snapshot.inventory.map(row => row.url), ...snapshot.pages.map(row => row.url)])], inspectionUrls};
  const result = spawnSync("docker", ["exec", "-i", "docker-enki-google-mcps-1", "node", "--input-type=module", "-", JSON.stringify(input)],
    {input: readFileSync(fileURLToPath(import.meta.url)), encoding: "utf8", maxBuffer: 24000000, timeout: 900000});
  if (result.status !== 0) throw new Error("connector_capture_failed");
  const receipt = JSON.parse(result.stdout);
  if (receipt.schema !== "enki-seo-source-capture/v1") throw new Error("unexpected_capture_schema");
  writeFileSync(outputPath, JSON.stringify(receipt, null, 2) + "\n", {flag: "wx", mode: 0o600});
  console.log(JSON.stringify(Object.fromEntries(["gsc", "ga4", "gscOverlap", "sitemaps", "inspection"].map(key => [key, {status: receipt[key].status,
    reason: receipt[key].reason ?? null, rowCount: receipt[key].rows?.length ?? null}]))));
}

if (process.argv[1] === "-") {
  capture(JSON.parse(process.argv[2])).then(value => console.log(JSON.stringify(value))).catch(() => {console.error("capture_failed"); process.exitCode = 1;});
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { hostMain(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
