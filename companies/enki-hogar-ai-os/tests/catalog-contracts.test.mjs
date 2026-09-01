import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {validateCatalogBundle} from "../skills/enki-catalog-qa/scripts/validate_catalog_contracts.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractDir = join(packageDir, "references", "contracts");
const skillDir = join(packageDir, "skills", "enki-catalog-qa");
const fixtureDir = join(skillDir, "fixtures", "catalog-contracts");
const serverRequire = createRequire(join(packageDir, "..", "..", "server", "package.json"));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const schemaFiles = {
  run: "catalog-run-v1.schema.json",
  evidenceCurrent: "catalog-field-evidence-v1.schema.json",
  evidenceCandidate: "catalog-field-evidence-v1.schema.json",
  changeSet: "catalog-change-set-v1.schema.json",
};
const schemas = Object.fromEntries([...new Set(Object.values(schemaFiles))].map((name) => [name, json(join(contractDir, name))]));
const ajv = new Ajv2020({strict: true, allErrors: true});
addFormats(ajv);
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));

function loadBundle() {
  const validDir = join(fixtureDir, "valid");
  return {
    run: json(join(validDir, "run.json")),
    evidenceCurrent: json(join(validDir, "evidence-current.json")),
    evidenceCandidate: json(join(validDir, "evidence-candidate.json")),
    changeSet: json(join(validDir, "change-set.json")),
  };
}

function setPointer(document, pointer, value) {
  const parts = pointer.split("/").slice(1).map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let target = document;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)] = structuredClone(value);
}

function fixtureValue(fixture) {
  if (fixture.valueFactory === "host_absolute_path") return ["", "Users", "demo", "catalogo.pdf"].join("/");
  return fixture.value;
}

function semantic(bundle) {
  return validateCatalogBundle({
    run: bundle.run,
    evidence: [bundle.evidenceCurrent, bundle.evidenceCandidate],
    changeSet: bundle.changeSet,
  });
}

test("catalogue v1 schemas compile in strict JSON Schema 2020-12 mode", () => {
  assert.deepEqual(Object.values(schemas).map((schema) => schema.$id).sort(), [
    "urn:enki:catalog-change-set:v1",
    "urn:enki:catalog-field-evidence:v1",
    "urn:enki:catalog-run:v1",
  ]);
  assert.equal(schemas["catalog-run-v1.schema.json"].properties.execution.properties.externalWritesBlocked.const, true);
  assert.equal(schemas["catalog-change-set-v1.schema.json"].properties.execution.properties.publicationAuthority.const, "none");
});

test("catalogue contract mirrors are byte-identical to their canonical schemas", () => {
  for (const name of Object.keys(schemas)) {
    assert.equal(sha256(join(contractDir, name)), sha256(join(skillDir, "references", name)), name);
  }
});

test("sanitized catalogue fixture validates structurally and semantically", () => {
  const bundle = loadBundle();
  for (const [name, document] of Object.entries(bundle)) {
    const validator = validators[schemaFiles[name]];
    assert.equal(validator(document), true, `${name}: ${JSON.stringify(validator.errors)}`);
  }
  assert.deepEqual(semantic(bundle), {valid: true, errors: []});
  assert.equal(bundle.run.provenance.kind, "sanitized_fixture");
  assert.equal(bundle.changeSet.execution.externalWritesBlocked, true);
  assert.equal(bundle.changeSet.changes[0].exportEligibility.eligible, false);
});

test("PDF evidence preserves exact geometry and Woo evidence preserves positional duplicate headers", () => {
  const bundle = loadBundle();
  assert.equal(bundle.evidenceCandidate.location.kind, "pdf_region");
  assert.deepEqual(bundle.evidenceCandidate.location.boxes.map((box) => box.role), ["reference", "value", "header"]);
  assert.equal(bundle.evidenceCurrent.location.kind, "csv_cell");
  assert.equal(bundle.evidenceCurrent.location.columnIndexBase, 0);
  assert.equal(bundle.evidenceCurrent.location.originalHeader, "Precio normal");
  assert.equal(bundle.evidenceCurrent.location.deduplicatedHeader, "Precio normal__26");
});

test("normalization never discards the source value or creates external-write authority", () => {
  const bundle = loadBundle();
  assert.equal(bundle.evidenceCandidate.field.rawValue, "88,47 € + IVA");
  assert.equal(bundle.evidenceCandidate.field.normalizedValue, 107.05);
  assert.equal(bundle.evidenceCandidate.field.transformations.length, 2);
  assert.equal(bundle.evidenceCandidate.authority.isExternalMutationAuthority, false);
  assert.equal(bundle.changeSet.decision.isExternalMutationAuthority, false);
});

test("negative fixtures fail at the expected structural or semantic gate", async (t) => {
  const fixtures = json(join(fixtureDir, "invalid", "cases.json"));
  assert.equal(fixtures.schema, "enki-catalog-contract-negative-fixtures/v1");
  for (const fixture of fixtures.cases) {
    await t.test(fixture.name, () => {
      const bundle = loadBundle();
      setPointer(bundle[fixture.document], fixture.pointer, fixtureValue(fixture));
      for (const mutation of fixture.also || []) setPointer(bundle[fixture.document], mutation.pointer, mutation.value);
      const validator = validators[schemaFiles[fixture.document]];
      const structurallyValid = validator(bundle[fixture.document]);
      if (fixture.expected === "schema") {
        assert.equal(structurallyValid, false, `${fixture.name} unexpectedly passed schema validation`);
        return;
      }
      assert.equal(structurallyValid, true, `${fixture.name}: ${JSON.stringify(validator.errors)}`);
      const result = semantic(bundle);
      assert.equal(result.valid, false, fixture.name);
      assert.equal(result.errors.some((error) => error.code === fixture.expected), true, JSON.stringify(result.errors));
    });
  }
});

test("standalone skill validator accepts the coherent fixture bundle", () => {
  const validDir = join(fixtureDir, "valid");
  const result = spawnSync(process.execPath, [
    join(skillDir, "scripts", "validate_catalog_contracts.mjs"),
    "--run", join(validDir, "run.json"),
    "--evidence", join(validDir, "evidence-current.json"),
    "--evidence", join(validDir, "evidence-candidate.json"),
    "--change-set", join(validDir, "change-set.json"),
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).valid, true);
});
