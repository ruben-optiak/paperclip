import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = join(packageDir, "scripts", "catalog-pipeline");
const adapterDir = join(runtimeDir, "adapters");
const registryPath = join(adapterDir, "registry.json");
const canonicalSchemaPath = join(packageDir, "references", "contracts", "catalog-adapter-v1.schema.json");
const mirrorSchemaPath = join(packageDir, "skills", "enki-catalog-qa", "references", "catalog-adapter-v1.schema.json");
const serverRequire = createRequire(join(packageDir, "..", "..", "server", "package.json"));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const schema = json(canonicalSchemaPath);
const registry = json(registryPath);
const definitions = registry.adapters.map((entry) => ({entry, path: join(adapterDir, entry.path), document: json(join(adapterDir, entry.path))}));
const ajv = new Ajv2020({strict: true, allErrors: true});
addFormats(ajv);
const validate = ajv.compile(schema);

test("catalogue adapter schema compiles strictly and its skill mirror is exact", () => {
  assert.equal(schema.$id, "urn:enki:catalog-adapter:v1");
  assert.equal(sha256(canonicalSchemaPath), sha256(mirrorSchemaPath));
});

test("registry and four adapter definitions satisfy catalog-adapter/v1", () => {
  assert.equal(validate(registry), true, JSON.stringify(validate.errors));
  for (const {entry, document} of definitions) {
    assert.equal(validate(document), true, `${entry.adapterKey}: ${JSON.stringify(validate.errors)}`);
    assert.equal(document.adapterKey, entry.adapterKey);
    assert.equal(document.brandSlug, entry.brandSlug);
    assert.equal(document.implementation, entry.implementation);
  }
});

test("registry hashes every definition and fixes exact brand/snapshot ownership", () => {
  assert.equal(registry.adapters.length, 4);
  assert.deepEqual(registry.adapters.map((entry) => entry.brandSlug).sort(), ["buades", "chicandbath", "enki-espejos", "mundilite"]);
  for (const {entry, path, document} of definitions) {
    assert.equal(sha256(path), entry.sha256);
    assert.equal(document.scope.unknownSnapshots, "deny");
    assert.equal(document.scope.unknownPages, "deny");
    assert.equal(document.scope.fixtureKeys.length, document.fixtureBindings.length);
  }
});

test("only the three-brand row strategy is promoted into the common core", () => {
  assert.deepEqual(registry.corePromotions.map((item) => item.strategy), ["row_left_to_right"]);
  assert.deepEqual(registry.corePromotions[0].evidenceBrands.sort(), ["buades", "enki-espejos", "mundilite"]);
  const chic = definitions.find(({document}) => document.brandSlug === "chicandbath").document;
  assert.equal(chic.rules[0].strategy, "matrix_by_headers");
  assert.equal(chic.rules[0].strategyOwner, "adapter");
  const core = readFileSync(join(runtimeDir, "src", "enki_catalog_pipeline", "extraction_core.py"), "utf8");
  assert.equal(core.includes("matrix_by_headers"), false);
  assert.equal(core.toLowerCase().includes("chicandbath"), false);
});

test("all adapters require full coverage, zero error and zero external authority", () => {
  assert.equal(definitions.reduce((sum, {document}) => sum + document.qualityGate.expectedFixtureCount, 0), 6);
  assert.equal(definitions.reduce((sum, {document}) => sum + document.qualityGate.expectedPairCount, 0), 21);
  for (const {document} of definitions) {
    assert.deepEqual(document.qualityGate, {
      expectedFixtureCount: document.fixtureBindings.length,
      expectedPairCount: document.fixtureBindings.reduce((sum, item) => sum + item.expectedPairCount, 0),
      minimumFixturePassRate: 1,
      minimumSubjectCoverage: 1,
      maximumPairErrorRate: 0,
    });
    assert.deepEqual(document.authority, {
      isLiveCommercialTruth: false,
      isExternalMutationAuthority: false,
      canGenerateWooImport: false,
      outputMode: "local_observation_only",
    });
  }
});
