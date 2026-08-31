import assert from "node:assert/strict";
import {cp, mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {loadSupportPack} from "../src/support-pack.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "packs");

test("representative Enki, Mundilite and Chicandbath packs model different product structures", async () => {
  const enki = await loadSupportPack(join(fixtureRoot, "enki-espejos"));
  assert.equal(enki.crosswalk[0].manufacturerRef, "050101");
  assert.equal(enki.crosswalk[0].wooVariationSku, "ENKI-ESP-050101");
  assert.deepEqual(enki.rules.map((rule) => rule.axis), ["medida"]);
  assert.equal(enki.facts.some((fact) => fact.factKey === "finish_role" && fact.applicability === "informational"), true);

  const mundilite = await loadSupportPack(join(fixtureRoot, "mundilite-select"));
  assert.deepEqual(mundilite.rules.map((rule) => rule.axis), ["acabado", "color"]);
  assert.equal(mundilite.rules.every((rule) => rule.representation === "variation"), true);
  assert.equal(mundilite.facts.some((fact) => fact.factKey === "installation_type"), true);

  const chic = await loadSupportPack(join(fixtureRoot, "chicandbath-prali"));
  assert.deepEqual(new Set(chic.rules.map((rule) => rule.representation)), new Set(["variation", "configurator_option", "component_product", "assisted_sale"]));
  assert.equal(chic.entities.some((entity) => entity.entityKind === "component"), true);
  assert.equal(chic.relations.some((relation) => relation.relationType === "compatible_with"), true);
});

test("support pack rejects a raw catalogue-shaped extra column instead of silently persisting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "enki-support-pack-"));
  await cp(join(fixtureRoot, "enki-espejos"), root, {recursive: true});
  const path = join(root, "technical_entities.csv");
  const source = await readFile(path, "utf8");
  const modified = source.split("\n").map((line, index) => line ? `${line}${index === 0 ? ",sale_price" : ","}` : line).join("\n");
  await writeFile(path, modified, "utf8");
  await assert.rejects(loadSupportPack(root), /must use exactly these ordered headers/);
});

test("support pack manifest hashes and immutable source revision are enforced", async () => {
  const root = await mkdtemp(join(tmpdir(), "enki-support-pack-"));
  await cp(join(fixtureRoot, "enki-espejos"), root, {recursive: true});
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.sourceRepository.revision = "main";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(loadSupportPack(root), /full immutable Git commit/);

  manifest.sourceRepository.revision = "1111111111111111111111111111111111111111";
  manifest.files["technical_facts.csv"].sha256 = "0".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(loadSupportPack(root), /sha256 does not match manifest/);
});

test("support pack accepts an immutable source snapshot digest without pretending it is a Git commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "enki-support-pack-"));
  await cp(join(fixtureRoot, "enki-espejos"), root, {recursive: true});
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.sourceRepository.revisionKind = "source_snapshot_sha256";
  manifest.sourceRepository.revision = "4".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  const pack = await loadSupportPack(root);
  assert.equal(pack.manifest.sourceRepository.revisionKind, "source_snapshot_sha256");

  manifest.sourceRepository.revision = "4".repeat(40);
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(loadSupportPack(root), /source snapshot sha256/);
});

test("review mode validates a candidate but normal validation blocks it until explicit approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "enki-support-pack-"));
  await cp(join(fixtureRoot, "enki-espejos"), root, {recursive: true});
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.approval = {state: "review_required", approvedBy: null, approvedAt: null};
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  const crosswalkPath = join(root, "sku_crosswalk.csv");
  const crosswalk = await readFile(crosswalkPath, "utf8");
  const reviewCrosswalk = crosswalk.split("\n").map((line, index) => {
    if (index === 0 || !line) return line;
    const cells = line.split(",");
    cells[cells.length - 2] = "";
    cells[cells.length - 1] = "";
    return cells.join(",");
  }).join("\n");
  await writeFile(crosswalkPath, reviewCrosswalk, "utf8");
  manifest.files["sku_crosswalk.csv"].sha256 = (await import("../src/normalization.mjs")).sha256(reviewCrosswalk);
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  const candidate = await loadSupportPack(root, {requireApproval: false});
  assert.equal(candidate.manifest.approval.state, "review_required");
  assert.equal(candidate.crosswalk[0].approvedBy, null);
  await assert.rejects(loadSupportPack(root), /approved before import/);
});

test("support packs reject every undeclared sidecar file", async () => {
  const root = await mkdtemp(join(tmpdir(), "enki-support-pack-"));
  await cp(join(fixtureRoot, "enki-espejos"), root, {recursive: true});
  await writeFile(join(root, "README.md"), "This file is outside the signed pack contract.\n", "utf8");
  await assert.rejects(loadSupportPack(root), /unexpected files: README\.md/);
});
