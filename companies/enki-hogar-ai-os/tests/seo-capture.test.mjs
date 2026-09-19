import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {decodeMcp, decodeGscText, envelope, gscPeriod, normalizeGa4, normalizeGsc, normalizeInspection, publicUrl, selectProperty} from "../scripts/seo/capture-sources.mjs";

const origin = "https://www.example.invalid";
const serverRequire = createRequire(new URL("../../../server/package.json", import.meta.url));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");
const known = new Set([origin + "/a/", origin + "/b/"]);
const period = {start: "2026-08-01", end: "2026-08-31"};
const ga4 = {dimension_headers: [{name: "pagePath"}], metric_headers: [{name: "screenPageViews"}], row_count: 1,
  metadata: {time_zone: "Europe/Madrid"}, rows: [{dimension_values: [{value: "/a/"}], metric_values: [{value: "12"}]}]};

test("source normalization wraps evidence with the real source timezone", () => {
  const schema = JSON.parse(readFileSync(new URL("../references/contracts/evidence-envelope-v1.schema.json", import.meta.url)));
  const ajv = new Ajv2020({strict: false}); addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [source, timezone] of [["gsc", "America/Los_Angeles"], ["ga4", "Europe/Madrid"]]) {
    assert.equal(validate(envelope({}, source, period, timezone)), true, JSON.stringify(validate.errors));
  }
  assert.equal(validate(envelope({}, "gsc", period, "Europe/Madrid")), false);
});

test("capture decoder rejects nested failures and does not expose error bodies", () => {
  assert.deepEqual(decodeMcp(JSON.stringify({result: {content: [{type: "text", text: '{"rows":[]}'}]}})), {rows: []});
  assert.throws(() => decodeMcp(JSON.stringify({result: {content: [{type: "text", text: '{"error":"invalid_grant SECRET"}'}]}})), /^Error: oauth_invalid_grant$/);
  assert.throws(() => decodeMcp(JSON.stringify({error: {message: "SECRET"}})), /^Error: provider_error$/);
});

function table(dimensions, rows) {
  const headers = [...dimensions, "clicks", "impressions", "ctr", "position"];
  return `# Search Console: sc-domain:example.invalid\n*2026-08-01 to 2026-08-31 | web | ${rows.length} rows*\n\n| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n` + rows.map(row => `| ${row.join(" | ")} |`).join("\n");
}

test("GSC formatted tables preserve counts and reject ambiguous cells or truncation", () => {
  const text = table(["page"], [[origin + "/a/", 1, 10, "10.00%", "4.1"]]);
  assert.equal(decodeGscText(text).rows[0].position, 4.1);
  assert.throws(() => decodeGscText(text + "\n--- Response truncated"), /truncated/);
  assert.throws(() => decodeGscText(text.replace("/a/", "/a/ | extra")), /ambiguous/);
  assert.deepEqual(decodeGscText("No search analytics data for the specified range."), {rows: []});
  const inspected = decodeGscText("URL: " + origin + "/a/\nVerdict: PASS\nCoverage state: Submitted and indexed");
  assert.equal(inspected.canonicalFieldsExposed, false);
});

test("long URLs are recovered only through independent exact-filter queries", async t => {
  const long = origin + "/" + "a".repeat(90) + "/";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const args = JSON.parse(options.body).params.arguments;
    requests.push(args);
    const content = args.dimension_filters ? table([], [[2, 20, "10.00%", "5.3"]]) : table(["page"], [[long.slice(0, 77) + "...", 2, 20, "10.00%", "5.3"]]);
    return {ok: true, text: async () => JSON.stringify({result: {content: [{type: "text", text: content}]}})};
  });
  const result = await gscPeriod({origin, sources: {gsc: {rowLimit: 100, maxPages: 2}}}, period, ["page"], new Set([long]));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].dimension_filters, [{dimension: "page", operator: "equals", expression: long}]);
  assert.deepEqual(result.rows, [{url: long, clicks: 2, impressions: 20, position: 5.3}]);
  assert.equal(result.recovery[0].rowsRecovered, 1);
});

test("property selection fails closed on ambiguous or unrelated properties", () => {
  const entry = {property: "properties/123", display_name: "Enki Hogar"};
  assert.equal(selectProperty([{property_summaries: [entry]}]), "properties/123");
  assert.throws(() => selectProperty([{property_summaries: [entry, {...entry, property: "properties/456"}]}]), /ambiguous/);
  assert.throws(() => selectProperty([{property_summaries: [{...entry, display_name: "Enki sandbox"}]}]), /ambiguous/);
});

test("retained GSC rows are restricted to exact public URLs and query digests", () => {
  const raw = {rows: [{keys: ["private query", origin + "/a/"], clicks: 1, impressions: 10, position: 4},
    {keys: ["another query", origin + "/outside/"], clicks: 0, impressions: 1, position: 20}]};
  const result = normalizeGsc(raw, ["query", "page"], known, origin);
  assert.equal(result.excludedOutsidePublicScope, 1);
  assert.match(result.rows[0].querySha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("private query"), false);
  assert.throws(() => normalizeGsc({rows: [raw.rows[0], raw.rows[0]]}, ["query", "page"], known, origin), /duplicate/);
  assert.throws(() => normalizeGsc({unexpected: []}, ["page"], known, origin), /unexpected/);
});

test("GA4 validates row count, metric types, headers, timezone and quality flags", () => {
  assert.deepEqual(normalizeGa4(ga4, known, origin, "Europe/Madrid").rows, [{url: origin + "/a/", pageViews: 12}]);
  for (const metadata of [{sampling_metadatas: [{}]}, {subject_to_thresholding: true}, {data_loss_from_other_row: true}]) {
    assert.equal(normalizeGa4({...ga4, metadata: {...ga4.metadata, ...metadata}}, known, origin, "Europe/Madrid").partial, true);
  }
  assert.equal(normalizeGa4({...ga4, row_count: 2}, known, origin, "Europe/Madrid").partial, true);
  assert.throws(() => normalizeGa4(ga4, known, origin, "America/Los_Angeles"), /timezone/);
  assert.throws(() => normalizeGa4({...ga4, metric_headers: [{name: "sessions"}]}, known, origin, "Europe/Madrid"), /headers/);
  assert.throws(() => normalizeGa4({...ga4, rows: [{...ga4.rows[0], metric_values: [{value: ""}]}]}, known, origin, "Europe/Madrid"), /metric/);
});

test("URL identity and inspection whitelist exclude private paths and response links", () => {
  for (const value of ["/cart/", "/a/?email=x", "/a%40b/", "https://evil.invalid/a/", "/%77p-admin/"]) assert.equal(publicUrl(value, origin), null);
  assert.notEqual(publicUrl("/a", origin), publicUrl("/a/", origin));
  const result = normalizeInspection({inspectionResult: {inspectionResultLink: "SECRET", indexStatusResult: {
    verdict: "PASS", googleCanonical: origin + "/a/", userCanonical: origin + "/checkout/", referringUrls: ["SECRET"]}}}, origin + "/a/", origin);
  assert.equal(result.googleCanonical, origin + "/a/");
  assert.equal(result.userCanonical, null);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});
