import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  evaluateCatalogRegressionFixture,
  validateCatalogRegressionSuite,
  validateWooHeaderFixture,
} from "../skills/enki-catalog-qa/scripts/validate_catalog_regression.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(packageDir, "skills", "enki-catalog-qa");
const regressionDir = join(skillDir, "fixtures", "catalog-regression", "v1");
const manifestPath = join(regressionDir, "manifest.json");
const canonicalSchemaPath = join(packageDir, "references", "contracts", "catalog-regression-v1.schema.json");
const mirrorSchemaPath = join(skillDir, "references", "catalog-regression-v1.schema.json");
const fieldEvidenceSchemaPath = join(packageDir, "references", "contracts", "catalog-field-evidence-v1.schema.json");
const serverRequire = createRequire(join(packageDir, "..", "..", "server", "package.json"));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const manifest = json(manifestPath);
const regressionSchema = json(canonicalSchemaPath);
const fieldEvidenceSchema = json(fieldEvidenceSchemaPath);
const ajv = new Ajv2020({strict: true, allErrors: true});
addFormats(ajv);
const validateRegression = ajv.compile(regressionSchema);
const validateFieldEvidence = ajv.compile(fieldEvidenceSchema);

function fixture(fixtureKey) {
  const entry = manifest.fixtures.find((candidate) => candidate.fixtureKey === fixtureKey);
  return json(join(regressionDir, entry.path));
}

function errorCodes(result) {
  return new Set(result.errors.map((error) => error.code));
}

test("catalogue regression schema compiles strictly and its skill mirror is exact", () => {
  assert.equal(regressionSchema.$id, "urn:enki:catalog-regression:v1");
  assert.equal(sha256(canonicalSchemaPath), sha256(mirrorSchemaPath));
});

test("suite manifest and all six sanitized fixtures pass the strict regression schema", () => {
  assert.equal(validateRegression(manifest), true, JSON.stringify(validateRegression.errors));
  for (const entry of manifest.fixtures) {
    const document = json(join(regressionDir, entry.path));
    assert.equal(validateRegression(document), true, `${entry.fixtureKey}: ${JSON.stringify(validateRegression.errors)}`);
    assert.equal(document.provenance.kind, "sanitized_fixture");
    assert.equal(document.provenance.sourceValuesRetained, false);
    assert.equal(document.provenance.sourceMediaRetained, false);
  }
});

test("multibrand suite covers every required layout and emits 21 deterministic evidence records", () => {
  const result = validateCatalogRegressionSuite({manifestPath});
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.summary, {
    suiteVersion: "1.0.0",
    fixtures: 6,
    brands: ["buades", "chicandbath", "enki-espejos", "mundilite"],
    features: ["columns", "configurator", "detail", "finish_matrix", "grid", "multi_sku_price", "table"],
    pairs: 21,
    evidenceRecords: 21,
    wooRows: 2,
    duplicateWooHeaders: 2,
  });
});

test("every projected observation conforms to catalog-field-evidence/v1 and grants no authority", () => {
  const result = validateCatalogRegressionSuite({manifestPath});
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  for (const evidence of result.evidence) {
    assert.equal(validateFieldEvidence(evidence), true, `${evidence.evidenceKey}: ${JSON.stringify(validateFieldEvidence.errors)}`);
    assert.equal(evidence.provenance, "sanitized_fixture");
    assert.equal(evidence.location.kind, "pdf_region");
    assert.equal(evidence.location.boxes.some((box) => box.role === "reference"), true);
    assert.equal(evidence.location.boxes.some((box) => box.role === "value"), true);
    assert.equal(evidence.authority.isCurrentCommercialTruth, false);
    assert.equal(evidence.authority.isExternalMutationAuthority, false);
    assert.notEqual(evidence.decision.state, "approved");
  }
});

test("geometric oracle preserves grouped prices, independent columns, finish rows and configurator headers", () => {
  const result = validateCatalogRegressionSuite({manifestPath});
  const byKey = new Map(result.fixtures.map((item) => [item.fixtureKey, item]));
  assert.deepEqual(byKey.get("buades-table-multi-price").pairs.map((pair) => [pair.subjectElementKey, pair.valueElementKey]), [
    ["bds-ref-a", "bds-price-shared"],
    ["bds-ref-b", "bds-price-shared"],
    ["bds-ref-c", "bds-price-c"],
  ]);
  assert.deepEqual(byKey.get("enki-espejos-columns").pairs.map((pair) => [pair.subjectElementKey, pair.valueElementKey]), [
    ["enki-col-left-a", "enki-col-left-price-a"],
    ["enki-col-right-a", "enki-col-right-price-a"],
    ["enki-col-left-b", "enki-col-left-price-b"],
    ["enki-col-right-b", "enki-col-right-price-b"],
  ]);
  assert.equal(byKey.get("mundilite-finish-matrix").pairs.length, 4);
  assert.deepEqual(byKey.get("chicandbath-configurator-matrix").pairs.map((pair) => pair.pairKey), [
    "chic-config-a:w60",
    "chic-config-a:w80",
    "chic-config-b:w60",
    "chic-config-b:w80",
  ]);
});

test("QA and entity roles remain conservative across brands", () => {
  const result = validateCatalogRegressionSuite({manifestPath});
  const decisions = result.evidence.reduce((counts, evidence) => counts.set(evidence.decision.state, (counts.get(evidence.decision.state) || 0) + 1), new Map());
  assert.deepEqual(Object.fromEntries([...decisions.entries()].sort()), {needs_review: 11, observed: 10});
  const chic = result.fixtures.find((item) => item.fixtureKey === "chicandbath-configurator-matrix");
  assert.deepEqual(chic.evidence.map((item) => item.entity.kind), ["configurator_option", "configurator_option", "component", "component"]);
  assert.equal(chic.evidence.every((item) => item.decision.state === "needs_review"), true);
});

test("Woo fixture keeps duplicated columns separate by zero-based position", () => {
  const raw = readFileSync(join(regressionDir, manifest.wooHeaderFixture.path), "utf8");
  const result = validateWooHeaderFixture(raw, manifest.wooHeaderFixture);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.deduplicatedHeaders, ["ID", "Type", "SKU", "Regular Price", "Regular Price__2", "Images", "Images__2"]);
  assert.equal(result.rows[1][3], "120.00");
  assert.equal(result.rows[1][4], "99.00");
  assert.equal(result.rows[1][5], "variant-main.webp");
  assert.equal(result.rows[1][6], "variant-gallery.webp");
});

test("negative mutations are caught at the intended regression gates", async (t) => {
  await t.test("count drift", () => {
    const document = fixture("buades-detail-card");
    document.expected.elementCounts[0].count += 1;
    assert.equal(errorCodes(evaluateCatalogRegressionFixture(document)).has("element_count_mismatch"), true);
  });

  await t.test("geometric pairing drift", () => {
    const document = fixture("buades-table-multi-price");
    const price = document.elements.find((element) => element.elementKey === "bds-price-c");
    price.box = {x0: 10, y0: 400, x1: 60, y1: 420};
    assert.equal(errorCodes(evaluateCatalogRegressionFixture(document)).has("pairing_missing"), true);
  });

  await t.test("QA state drift", () => {
    const document = fixture("enki-espejos-columns");
    document.expected.qaStateCounts = [{key: "auto_clear", count: 4}];
    assert.equal(errorCodes(evaluateCatalogRegressionFixture(document)).has("qa_state_count_mismatch"), true);
  });

  await t.test("host path leakage", () => {
    const document = fixture("mundilite-finish-matrix");
    document.source.documentPath = ["", "tmp"].join("/");
    assert.equal(errorCodes(evaluateCatalogRegressionFixture(document)).has("unsafe_content"), true);
  });

  await t.test("email PII leakage", () => {
    const document = fixture("enki-espejos-grid");
    document.elements[0].text = ["customer", "example.invalid"].join("@");
    assert.equal(errorCodes(evaluateCatalogRegressionFixture(document)).has("unsafe_content"), true);
  });

  await t.test("credential leakage", () => {
    const document = fixture("buades-detail-card");
    document.elements[0].text = ["sk", "proj", "abcdefghijklmnopqrstuv"].join("-");
    assert.equal(errorCodes(evaluateCatalogRegressionFixture(document)).has("unsafe_content"), true);
  });

  await t.test("fixture hash drift", () => {
    const changedManifest = structuredClone(manifest);
    changedManifest.fixtures[0].sha256 = "0".repeat(64);
    assert.equal(errorCodes(validateCatalogRegressionSuite({manifestPath, manifestOverride: changedManifest})).has("fixture_hash_mismatch"), true);
  });

  await t.test("Woo positional header drift", () => {
    const raw = readFileSync(join(regressionDir, manifest.wooHeaderFixture.path), "utf8");
    const expected = structuredClone(manifest.wooHeaderFixture);
    expected.deduplicatedHeaders[4] = "Regular Price__3";
    assert.equal(errorCodes(validateWooHeaderFixture(raw, expected)).has("woo_deduplicated_header_mismatch"), true);
  });
});

test("standalone catalogue regression validator accepts the immutable suite", () => {
  const result = spawnSync(process.execPath, [
    join(skillDir, "scripts", "validate_catalog_regression.mjs"),
    "--manifest", manifestPath,
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.summary.evidenceRecords, 21);
});
