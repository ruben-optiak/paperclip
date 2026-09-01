#!/usr/bin/env node
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function portableDirectPath(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

export function validateCatalogReconciliationFixture({manifestPath}) {
  const errors = [];
  const add = (code, path, message) => errors.push({code, path, message});
  const selected = resolve(manifestPath);
  let manifest;
  try {
    manifest = json(selected);
  } catch (error) {
    return {valid: false, errors: [{code: "invalid_manifest", path: "/", message: String(error)}], summary: null};
  }
  const root = dirname(selected);
  if (manifest.schema !== "enki-catalog-reconciliation-fixture-manifest/v1" || manifest.version !== "1.0.0") {
    add("identity_drift", "/schema", "Unsupported EAI-021 fixture manifest.");
  }
  const expectedPaths = ["profile.json", "candidates.jsonl", "woo-before.csv", "woo-after-expected.csv", "woo-after-drift.csv"];
  const declared = new Map();
  for (const [index, entry] of (manifest.files || []).entries()) {
    if (!portableDirectPath(entry?.path) || declared.has(entry.path)) {
      add("unsafe_or_duplicate_path", `/files/${index}/path`, "Fixture files must be unique direct portable paths.");
      continue;
    }
    declared.set(entry.path, entry);
    try {
      if (sha256(join(root, entry.path)) !== entry.sha256) add("hash_drift", `/files/${index}/sha256`, `Hash drift: ${entry.path}`);
    } catch {
      add("missing_file", `/files/${index}/path`, `Missing fixture file: ${entry.path}`);
    }
  }
  if ([...declared.keys()].sort().join(",") !== expectedPaths.sort().join(",")) {
    add("file_set_drift", "/files", "Fixture manifest must contain exactly the five reviewed files.");
  }

  let profile = {};
  let candidates = [];
  try {
    profile = json(join(root, "profile.json"));
    candidates = readFileSync(join(root, "candidates.jsonl"), "utf8")
      .split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    add("invalid_fixture", "/files", `Profile and candidates must be valid UTF-8 JSON/JSONL: ${String(error)}`);
  }
  if (profile.schema !== "enki-catalog-reconciliation-profile/v1" || profile.version !== "1.0.0") {
    add("profile_identity_drift", "/profile", "Fixture profile contract drift.");
  }
  if (profile.provenance?.kind !== "sanitized_fixture") add("unsafe_provenance", "/profile/provenance/kind", "Committed fixture must remain sanitized.");
  const authority = profile.authority || {};
  if (authority.isLiveCommercialTruth !== false || authority.isExternalMutationAuthority !== false || authority.canGenerateWooImport !== false || authority.outputMode !== "local_change_set_only") {
    add("unsafe_authority", "/profile/authority", "Profile must remain local-only and unable to generate a Woo import.");
  }
  const entities = profile.scope?.entities || [];
  const targets = profile.scope?.targets || [];
  if (entities.length !== 2 || targets.length !== 5 || candidates.length !== 5) add("coverage_drift", "/profile/scope", "Fixture must retain two entities and five exact field candidates.");
  const variation = entities.find((item) => item.expectedKind === "variation");
  const parent = entities.find((item) => item.expectedKind === "parent");
  if (!variation || !parent) add("identity_coverage_drift", "/profile/scope/entities", "Fixture must retain one parent and one variation.");
  for (const [index, target] of targets.entries()) {
    const entity = entities.find((item) => item.entityKey === target.entityKey);
    if (!entity) add("unknown_entity", `/profile/scope/targets/${index}/entityKey`, "Target entity is outside exact scope.");
    if (target.surface === "product_page" && !["parent", "simple"].includes(entity?.expectedKind)) {
      add("variation_page_target", `/profile/scope/targets/${index}/surface`, "A variation cannot own page SEO/media/content.");
    }
  }
  const price = targets.find((item) => item.fieldName === "regular_price_eur_gross");
  if (price?.normalization?.unit !== "EUR" || price?.normalization?.fiscalBasis !== "gross_including_vat") {
    add("fiscal_basis_drift", "/profile/scope/targets", "Price comparison must remain explicitly gross EUR.");
  }
  if (manifest.authority?.sanitized !== true || manifest.authority?.containsLiveCatalogueData !== false || manifest.authority?.isExternalMutationAuthority !== false || manifest.authority?.canGenerateWooImport !== false) {
    add("manifest_authority_drift", "/authority", "Fixture manifest cannot contain live data or write/import authority.");
  }

  const expected = manifest.expected || {};
  const lockedExpected = {
    rows: 3,
    columns: 14,
    duplicateHeaderGroups: 3,
    inScopeEntities: 2,
    outsideScopeRows: 1,
    candidateFields: 5,
    matches: 2,
    changes: 3,
    criticalChanges: 1,
    postImportVerifiedChanges: 3,
    postImportUnexpectedChanges: 0,
    idempotentChanges: 0,
  };
  if (JSON.stringify(expected) !== JSON.stringify(lockedExpected)) add("oracle_drift", "/expected", "Reviewed EAI-021 oracle metrics changed.");
  return {
    valid: errors.length === 0,
    errors,
    summary: errors.length ? null : {
      fixtureKey: manifest.fixtureKey,
      files: declared.size,
      entities: entities.length,
      candidates: candidates.length,
      expectedChanges: expected.changes,
      expectedMatches: expected.matches,
    },
  };
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--manifest") throw new Error("Usage: validate_catalog_reconciliation.mjs --manifest MANIFEST.json");
  return argv[1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = validateCatalogReconciliationFixture({manifestPath: parseArgs(process.argv.slice(2))});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
