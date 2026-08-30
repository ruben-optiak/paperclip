import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const metrics = readFileSync(join(packageDir, "references", "metrics", "metric-contracts.yaml"), "utf8");
const envelopeSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "evidence-envelope-v1.schema.json"), "utf8"));

test("metric contract defines every v0.1 commerce and acquisition metric", () => {
  for (const metric of ["orders", "gross_revenue", "net_revenue", "refund_total", "tax_total", "vat", "shipping_total", "ad_spend", "roas", "cac", "gross_margin"]) {
    assert.match(metrics, new RegExp(`^  ${metric}:$`, "m"), metric);
  }
  assert.match(metrics, /includedCurrentStatuses:[\s\S]*- processing[\s\S]*- completed[\s\S]*- refunded/);
  assert.match(metrics, /mixedCurrencies:.*never add or compare currencies/i);
  assert.match(metrics, /missing:.*never coerce missing or invalid input to zero/i);
  assert.match(metrics, /gross_margin:[\s\S]*currentAvailability: unavailable[\s\S]*Verified COGS/i);
  assert.match(metrics, /vat:[\s\S]*currentAvailability: unavailable[\s\S]*tax classes/i);
});

test("evidence schema requires provenance, period, freshness and quality metadata", () => {
  assert.equal(envelopeSchema.$id, "urn:enki:evidence-envelope:v1");
  assert.deepEqual(envelopeSchema.required, ["schema", "data", "meta"]);
  for (const field of ["source", "fetched_at", "period_start", "period_end", "timezone", "currency", "currencies", "freshness", "status", "partial", "warnings", "contracts"]) {
    assert.equal(envelopeSchema.properties.meta.required.includes(field), true, field);
  }
  assert.equal(envelopeSchema.properties.meta.properties.timezone.const, "Europe/Madrid");
  assert.deepEqual(envelopeSchema.properties.meta.properties.status.enum, ["ok", "partial", "unavailable"]);
});
