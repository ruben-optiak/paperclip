import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {buildBrief} from "../scripts/render-brief-fixture.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "brief");
const load = (name) => JSON.parse(readFileSync(join(fixtureRoot, name, "input.json"), "utf8"));

test("complete brief preserves source, period, freshness and current data", () => {
  const brief = buildBrief(load("complete"));
  assert.equal(brief.schema, "enki-evidence-envelope/v1");
  assert.equal(brief.data.sources.length, 4);
  assert.equal(brief.data.sources.every((source) => source.schema === brief.schema), true);
  assert.equal(brief.data.sources.every((source) => source.meta.status === "ok" && source.meta.freshness === "live"), true);
  assert.equal(brief.data.sources.every((source) => source.meta.period_start && source.meta.fetched_at), true);
  assert.equal(brief.data.alerts.length, 0);
  assert.equal(brief.meta.status, "ok");
});

test("partial data remains visible and is not upgraded to ok", () => {
  const brief = buildBrief(load("partial"));
  assert.deepEqual(brief.data.sources.filter((source) => source.meta.status === "partial").map((source) => source.meta.source), ["ga4", "google_ads"]);
  assert.equal(brief.data.alerts.length, 2);
  assert.equal(brief.meta.status, "partial");
});

test("stale snapshot data is historical and never presented as current", () => {
  const brief = buildBrief(load("stale"));
  assert.equal(brief.data.sources.every((source) => source.meta.status === "partial"), true);
  assert.equal(brief.data.sources.every((source) => source.meta.freshness === "stale"), true);
  assert.equal(brief.data.sources.every((source) => source.meta.warnings.some((warning) => warning.includes("historical only"))), true);
  assert.equal(brief.data.sources.every((source) => source.data !== null), true);
  assert.equal(JSON.stringify(brief).includes("current_data"), false);
});

test("connector outage reports unavailable rather than zero", () => {
  const brief = buildBrief(load("outage"));
  assert.equal(brief.data.sources.every((source) => source.meta.status === "unavailable"), true);
  assert.equal(brief.data.sources.every((source) => source.data === null), true);
  assert.equal(JSON.stringify(brief).includes('"orders":0'), false);
});

test("brief rejects the legacy ad-hoc source shape", () => {
  assert.throws(() => buildBrief({
    as_of: "2026-08-29T08:00:00+02:00",
    timezone: "Europe/Madrid",
    source_policies: {woocommerce: {max_age_hours: 2}},
    evidence: [{name: "woocommerce", status: "ok", data: {orders: 1}}],
  }), /Evidence envelope/);
});

test("brief requires an explicit instant offset and Europe/Madrid policy", () => {
  const fixture = load("complete");
  assert.throws(() => buildBrief({...fixture, as_of: "2026-08-29T08:00:00"}), /ISO-8601 instant/);
  assert.throws(() => buildBrief({...fixture, timezone: "UTC"}), /Europe\/Madrid/);
});
