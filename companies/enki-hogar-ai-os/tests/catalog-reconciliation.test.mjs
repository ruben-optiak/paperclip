import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {validateCatalogReconciliationFixture} from "../skills/enki-catalog-qa/scripts/validate_catalog_reconciliation.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(packageDir, "references", "contracts", "catalog-reconciliation-v1.schema.json");
const mirrorPath = join(packageDir, "skills", "enki-catalog-qa", "references", "catalog-reconciliation-v1.schema.json");
const fixtureDir = join(packageDir, "skills", "enki-catalog-qa", "fixtures", "catalog-reconciliation", "v1");
const manifestPath = join(fixtureDir, "manifest.json");
const replayReceiptPath = join(packageDir, "references", "replay-receipts", "eai-021-buades-2026-04-26.json");
const profile = JSON.parse(readFileSync(join(fixtureDir, "profile.json"), "utf8"));
const schema = JSON.parse(readFileSync(contractPath, "utf8"));
const serverRequire = createRequire(join(packageDir, "..", "..", "server", "package.json"));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");
const ajv = new Ajv2020({strict: true, allErrors: true});
addFormats(ajv);
const validate = ajv.compile(schema);
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const hash = "0".repeat(64);

test("Woo reconciliation schema compiles strictly and canonical mirror is exact", () => {
  assert.equal(schema.$id, "urn:enki:catalog-reconciliation:v1");
  assert.equal(digest(contractPath), digest(mirrorPath));
  assert.equal(validate(profile), true, JSON.stringify(validate.errors));
});

test("reconciliation report and post-import audit shapes retain local-only authority", () => {
  const report = {
    schema: "enki-catalog-reconciliation-report/v1",
    reportKey: "report-fixture",
    profileKey: profile.profileKey,
    runKey: profile.runKey,
    createdAt: profile.createdAt,
    timezone: "Europe/Madrid",
    provenance: "sanitized_fixture",
    inputs: {profileSha256: hash, candidateEvidenceSha256: hash, wooSnapshotSha256: hash, wooRows: 3, wooColumns: 14},
    positionalLayout: {duplicateHeaders: [{originalHeader: "Title", columnIndexes: [4, 5], deduplicatedHeaders: ["Title", "Title__2"]}]},
    identity: {inScopeEntities: 2, outsideScopeRows: 1, rowKinds: {simple: 1, parent: 1, variation: 1, unknown: 0}, pageOwnerRule: "simple_self_parent_self_variation_parent"},
    results: {candidateFields: 5, matches: 2, changes: 3, criticalChanges: 1},
    outputs: {fieldEvidence: "artifacts/catalog-field-evidence.jsonl", changeSet: "artifacts/catalog-change-set.json", catalogRun: "catalog-run.json"},
    authority: {isLiveCommercialTruth: false, isExternalMutationAuthority: false, canGenerateWooImport: false, outputMode: "local_change_set_only"},
  };
  assert.equal(validate(report), true, JSON.stringify(validate.errors));

  const audit = {
    schema: "enki-catalog-post-import-audit/v1",
    auditKey: "audit-fixture",
    profileKey: profile.profileKey,
    runKey: profile.runKey,
    createdAt: profile.createdAt,
    timezone: "Europe/Madrid",
    provenance: "sanitized_fixture",
    mode: "sanitized_simulation",
    inputs: {profileSha256: hash, changeSetSha256: hash, beforeWooSha256: hash, afterWooSha256: hash},
    expectedChanges: 3,
    verifiedChanges: 3,
    missingExpectedChanges: [],
    unexpectedChanges: [],
    identityDrift: [],
    blockers: [],
    passed: true,
    authority: {isObservation: true, isExternalMutationAuthority: false, canGenerateWooImport: false, containsRawOutOfScopeValues: false},
  };
  assert.equal(validate(audit), true, JSON.stringify(validate.errors));
});

test("schema rejects import authority and ambiguous fiscal comparison", () => {
  const unsafe = structuredClone(profile);
  unsafe.authority.canGenerateWooImport = true;
  assert.equal(validate(unsafe), false);

  const ambiguous = structuredClone(profile);
  ambiguous.scope.targets[0].normalization.fiscalBasis = "not_applicable";
  assert.equal(validate(ambiguous), false);

  const incompleteAudit = structuredClone(profile);
  incompleteAudit.audit.ignoredColumns = [profile.scope.targets[0].wooColumn];
  assert.equal(validate(incompleteAudit), false);
});

test("fixture manifest locks all sanitized files and reviewed oracle metrics", () => {
  assert.deepEqual(validateCatalogReconciliationFixture({manifestPath}), {
    valid: true,
    errors: [],
    summary: {
      fixtureKey: "buades-positional-parent-variation",
      files: 5,
      entities: 2,
      candidates: 5,
      expectedChanges: 3,
      expectedMatches: 2,
    },
  });
});

test("standalone reconciliation fixture validator is portable", () => {
  const result = spawnSync(process.execPath, [
    join(packageDir, "skills", "enki-catalog-qa", "scripts", "validate_catalog_reconciliation.mjs"),
    "--manifest", manifestPath,
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test("bounded historical replay receipt retains aggregates but no commercial authority", () => {
  const receipt = JSON.parse(readFileSync(replayReceiptPath, "utf8"));
  assert.equal(receipt.schema, "enki-bounded-historical-layout-replay-receipt/v1");
  assert.deepEqual(receipt.sourceSnapshot.rowKinds, {
    simple: 84,
    parent: 179,
    variation: 933,
    unknown: 0,
  });
  assert.equal(receipt.sourceSnapshot.rows, 1196);
  assert.equal(receipt.sourceSnapshot.columns, 376);
  assert.equal(receipt.sourceSnapshot.widthAnomalies, 0);
  assert.equal(receipt.sourceSnapshot.duplicateIds, 0);
  assert.equal(receipt.sourceSnapshot.duplicateSkus, 0);
  assert.equal(receipt.sourceSnapshot.orphanVariations, 0);
  assert.deepEqual(receipt.sanitizedReplay, {
    rows: 3,
    inScopeEntities: 2,
    outsideScopeRows: 1,
    candidateFields: 4,
    matches: 2,
    changes: 2,
    criticalChanges: 1,
    artifactFingerprintSha256: "d4ce6190c1abdd1d365ddd83e844852853354d52351f27eaa613392398b72911",
  });
  assert.deepEqual(receipt.authority, {
    sourceValuesRetained: false,
    artifactsPersisted: false,
    isCurrentCommercialTruth: false,
    isExternalMutationAuthority: false,
    canGenerateWooImport: false,
  });
});
