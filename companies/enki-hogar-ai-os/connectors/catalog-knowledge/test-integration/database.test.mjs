import assert from "node:assert/strict";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {databaseConfig} from "../src/config.mjs";
import {createDatabase, closeDatabase} from "../src/db.mjs";
import {importSupportPack} from "../src/import-pack.mjs";
import {applyPurge, createPurgePreview, listPacks} from "../src/lifecycle.mjs";
import {migrate} from "../src/migrations.mjs";
import {reindexEmbeddings} from "../src/reindex.mjs";
import {ProductSupportRepository} from "../src/repository.mjs";
import {loadSupportPack} from "../src/support-pack.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "packs");
const realEnkiPack = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "references", "product-support", "packs", "enki", "espejos", "1.0.0");

test("PostgreSQL support projection activates packs atomically and enforces read-only agent access", async (context) => {
  const admin = createDatabase(databaseConfig(process.env, {admin: true}));
  context.after(() => closeDatabase(admin));
  const databaseName = process.env.SUPPORT_DB_NAME || "";
  if (!databaseName.includes("test")) throw new Error("Integration test refuses to reset a database whose name does not contain 'test'");
  await migrate(admin, {readerPassword: process.env.SUPPORT_DB_READER_PASSWORD});
  await admin.unsafe(`TRUNCATE
    support_admin_operation_previews, support_admin_audit, support_chunks,
    support_sku_crosswalks, support_configuration_rules, support_relations,
    support_facts, support_entities, support_sources, support_packs CASCADE`);

  const enki = await loadSupportPack(realEnkiPack);
  const mundilite = await loadSupportPack(join(fixtureRoot, "mundilite-select"));
  const chic = await loadSupportPack(join(fixtureRoot, "chicandbath-prali"));
  for (const pack of [enki, mundilite, chic]) await importSupportPack(admin, pack, {actor: "integration-test"});

  const reader = createDatabase(databaseConfig(process.env));
  context.after(() => closeDatabase(reader));
  const repository = new ProductSupportRepository(reader);
  assert.deepEqual(await repository.health(), {schema_version: 1});
  await assert.rejects(reader`INSERT INTO support_packs (id, pack_key, version, brand_slug, brand_name, domain_slug, domain_name, snapshot_date, approved_by, approved_at, source_repository, source_revision_kind, source_revision, manifest_sha256, status) VALUES (gen_random_uuid(), 'forbidden', '1.0.0', 'x', 'x', 'x', 'x', current_date, 'x', now(), 'enki-repo://x/y', 'git_commit', '1111111111111111111111111111111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'active')`, /read-only|permission denied/i);
  await assert.rejects(reader`CREATE TEMP TABLE forbidden_temp (value text)`, /read-only|permission denied/i);
  await assert.rejects(reader`SELECT * FROM support_admin_audit`, /permission denied/i);
  await assert.rejects(reader`SELECT * FROM support_admin_operation_previews`, /permission denied/i);

  const coverage = await repository.coverage();
  assert.equal(coverage.overall.active_packs, 3);
  assert.equal(coverage.overall.technical_entities, 48);
  assert.equal(coverage.by_brand_domain.find((scope) => scope.brand === "enki")?.technical_entities, 43);
  assert.equal(coverage.by_brand_domain.find((scope) => scope.brand === "enki")?.technical_facts, 288);
  assert.equal(coverage.commercial_fields_persisted, false);

  const resolution = await repository.resolveProduct({woo_sku: "ENKI-ESP-050101", manufacturer_ref: null, query: null, brand: null, domain: null, limit: 10});
  assert.equal(resolution.matches.length, 1);
  assert.equal(resolution.matches[0].manufacturer_ref, "050101");
  assert.equal(resolution.matches[0].woo_variation_sku, "ENKI-ESP-050101");
  assert.equal("price" in resolution.matches[0], false);
  assert.equal("stock" in resolution.matches[0], false);

  const enkiProfile = await repository.getTechnicalProfile({entity_ref: "enki:espejos:lux-050101"});
  assert.equal(enkiProfile.facts.some((fact) => fact.fact_key === "width" && fact.value === "60"), true);
  assert.equal(enkiProfile.authority.commercial_fields_included, false);
  const enkiOptions = await repository.listAllowedOptions({entity_ref: "enki:espejos:lux", axis: null});
  assert.deepEqual(enkiOptions.rules.map((rule) => rule.axis), ["medida"]);

  const mundiliteOptions = await repository.listAllowedOptions({entity_ref: "mundilite:fregaderos:select-660", axis: null});
  assert.deepEqual(mundiliteOptions.rules.map((rule) => rule.representation), ["variation", "variation"]);

  const chicModel = await repository.getConfigurationModel({entity_ref: "chicandbath:muebles-de-bano:prali-05"});
  assert.deepEqual(new Set(chicModel.rules.map((rule) => rule.representation)), new Set(["variation", "configurator_option", "component_product", "assisted_sale"]));
  assert.equal(chicModel.model_contract.cartesian_expansion, "forbidden_unless_each_axis_is_an_approved_sellable_variation");
  const compatibility = await repository.checkCompatibility({left_entity_ref: "chicandbath:muebles-de-bano:prali-05", right_entity_ref: "chicandbath:muebles-de-bano:bonn-basin"});
  assert.equal(compatibility.status, "compatible");
  const unknownCompatibility = await repository.checkCompatibility({left_entity_ref: "chicandbath:muebles-de-bano:bonn-basin", right_entity_ref: "chicandbath:muebles-de-bano:prali-mirror"});
  assert.equal(unknownCompatibility.status, "unknown");

  const lexical = await repository.searchSupport({query: "altavoces Bluetooth", brand: "enki", domain: null, topic: null, entity_ref: null, limit: 5});
  assert.equal(lexical.retrieval_mode, "lexical");
  assert.equal(lexical.results.length, 1);
  assert.equal(lexical.results[0].entity_ref, "enki:espejos:axis");
  assert.equal(lexical.compatibility_authority, false);

  const fixtureEmbeddings = {model: "fixture-model", embed: async (inputs) => inputs.map(() => [1, 0, 0])};
  assert.equal((await reindexEmbeddings(admin, fixtureEmbeddings)).updated, 23);
  const hybridRepository = new ProductSupportRepository(reader, {embeddingClient: fixtureEmbeddings});
  const hybrid = await hybridRepository.searchSupport({query: "instalación", brand: null, domain: null, topic: null, entity_ref: null, limit: 5});
  assert.equal(hybrid.retrieval_mode, "hybrid");
  assert.equal(hybrid.results.length > 0, true);

  const nextEnki = structuredClone(enki);
  nextEnki.manifest.version = "1.0.1";
  nextEnki.manifest.sourceRepository.revision = "4".repeat(64);
  nextEnki.manifestSha256 = "9".repeat(64);
  const activation = await importSupportPack(admin, nextEnki, {actor: "integration-test"});
  assert.equal(activation.superseded.version, "1.0.0");
  const packs = await listPacks(admin, {brand: "enki"});
  assert.deepEqual(packs.map((pack) => pack.status).sort(), ["active", "superseded"]);

  const preview = await createPurgePreview(admin, {packKey: "enki-espejos-support", version: "1.0.0"}, "integration-test");
  assert.equal(preview.impact.entities, 43);
  await applyPurge(admin, preview.confirmation_token, "integration-test");
  await assert.rejects(applyPurge(admin, preview.confirmation_token, "integration-test"), /invalid or already consumed/);
  assert.equal((await listPacks(admin, {brand: "enki"})).length, 1);
});
