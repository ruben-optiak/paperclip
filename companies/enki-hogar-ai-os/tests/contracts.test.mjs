import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const metrics = readFileSync(join(packageDir, "references", "metrics", "metric-contracts.yaml"), "utf8");
const envelopeSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "evidence-envelope-v1.schema.json"), "utf8"));
const contentLedgerSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "content-ledger-v1.schema.json"), "utf8"));
const contentLedgerFixture = JSON.parse(readFileSync(join(packageDir, "skills", "enki-seo-sem", "fixtures", "content-ledger.json"), "utf8"));
const editorialWorkflow = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "editorial-workflow-v1.json"), "utf8"));
const productSupportSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "product-support-result-v1.schema.json"), "utf8"));
const productSupportPackSchema = JSON.parse(readFileSync(join(packageDir, "references", "contracts", "product-support-pack-v1.schema.json"), "utf8"));

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

test("content memory records coverage, freshness and deduplication keys without PII", () => {
  assert.equal(contentLedgerSchema.$id, "urn:enki:content-ledger:v1");
  assert.deepEqual(contentLedgerSchema.required, ["schema", "timezone", "generated_at", "coverage", "entries"]);
  assert.equal(contentLedgerSchema.properties.timezone.const, "Europe/Madrid");
  for (const field of ["record_id", "channel", "status", "title", "published_at", "canonical_url", "external_id", "topic_cluster", "products", "categories", "campaign", "source", "last_verified_at"]) {
    assert.equal(contentLedgerSchema.properties.entries.items.required.includes(field), true, field);
  }
  assert.equal(contentLedgerFixture.schema, "enki-content-ledger/v1");
  assert.equal(contentLedgerFixture.coverage.status, "partial");
  assert.equal(contentLedgerFixture.coverage.sources.some((source) => source.status === "unavailable"), true);
  assert.equal(JSON.stringify(contentLedgerFixture).match(/email|customer|recipient|credential/gi), null);
});

test("editorial handoffs are phase-gated and absence cannot pass brand review", () => {
  assert.equal(editorialWorkflow.schema, "enki-editorial-workflow/v1");
  const stages = new Map(editorialWorkflow.stages.map((stage) => [stage.key, stage]));
  assert.deepEqual(stages.get("draft"), {
    key: "draft",
    owner: "growth-manager",
    documentKey: "content-draft",
    requiresRevisionId: true,
    dependsOn: null,
  });
  assert.equal(stages.get("brand_catalogue_review")?.owner, "ecommerce-catalogue-manager");
  assert.equal(stages.get("brand_catalogue_review")?.dependsOn, "draft");
  assert.equal(stages.get("brand_catalogue_review")?.missingInputDisposition, "blocked_not_reviewed");
  assert.equal(stages.get("brand_catalogue_review")?.zeroClaimsMayPass, false);
  assert.equal(stages.get("publish")?.dependsOn, "brand_catalogue_review");
  assert.equal(stages.get("publish")?.mode, "paperclip_ask_first");
  assert.equal(stages.get("publish")?.connector, "content_publisher");
  assert.equal(stages.get("publish")?.approvalOwner, "board");
  assert.equal(stages.get("publish")?.requiresIdempotencyKey, true);
});

test("product-support contracts preserve the technical/commercial authority split", () => {
  assert.equal(productSupportSchema.properties.schema.const, "enki-product-support-result/v1");
  assert.deepEqual(productSupportSchema.required, ["schema", "as_of", "authority", "data"]);
  const authority = productSupportSchema.properties.authority.properties;
  assert.equal(authority.technical_source.const, "active-approved-support-pack");
  assert.equal(authority.commercial_source.const, "woocommerce-live");
  assert.equal(authority.commercial_fields_included.const, false);
  assert.equal(authority.rebuildable_projection.const, true);

  assert.equal(productSupportPackSchema.properties.schema.const, "enki-product-support-pack/v1");
  assert.deepEqual(productSupportPackSchema.properties.files.required, [
    "technical_entities.csv",
    "technical_facts.csv",
    "technical_relations.csv",
    "configuration_rules.csv",
    "sku_crosswalk.csv",
    "support_chunks.jsonl",
  ]);
  assert.equal(productSupportPackSchema.properties.approval.properties.state.const, "approved");
  assert.deepEqual(productSupportPackSchema.properties.sourceRepository.properties.revisionKind.enum, ["git_commit", "source_snapshot_sha256"]);
  assert.equal(productSupportPackSchema.properties.sourceRepository.allOf[0].then.properties.revision.pattern, "^[0-9a-f]{40}$");
  assert.equal(productSupportPackSchema.properties.sourceRepository.allOf[1].then.properties.revision.pattern, "^[0-9a-f]{64}$");
});
