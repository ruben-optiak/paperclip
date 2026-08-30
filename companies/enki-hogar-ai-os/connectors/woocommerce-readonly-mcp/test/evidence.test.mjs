import assert from "node:assert/strict";
import test from "node:test";
import {assertEvidenceEnvelope, createEvidenceEnvelope} from "../src/evidence.mjs";

test("canonical evidence envelope preserves explicit quality and currency metadata", () => {
  const envelope = createEvidenceEnvelope({
    source: "fixture",
    fetchedAt: "2026-08-29T06:00:00.000Z",
    periodStart: "2026-08-28",
    periodEnd: "2026-08-28",
    currencies: ["eur", "EUR"],
    data: {metric: {value: null, quality: "incomplete"}},
    status: "partial",
    partial: true,
    warnings: ["Metric input is missing"],
  });
  assert.equal(envelope.schema, "enki-evidence-envelope/v1");
  assert.equal(envelope.meta.currency, "EUR");
  assert.deepEqual(envelope.meta.currencies, ["EUR"]);
  assert.equal(envelope.data.metric.value, null);
});

test("canonical envelope fails closed on contradictory unavailable evidence", () => {
  const envelope = createEvidenceEnvelope({
    source: "fixture",
    fetchedAt: "2026-08-29T06:00:00.000Z",
    data: null,
    status: "unavailable",
    freshness: "unavailable",
    warnings: ["Connector unavailable"],
  });
  envelope.data = {orders: 0};
  assert.throws(() => assertEvidenceEnvelope(envelope), /Unavailable evidence must carry null data/);
});
