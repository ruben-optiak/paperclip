import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CatalogueEvidencePublication} from "../src/publication.mjs";
import {createApprovedPublication, digest} from "./fixtures.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "enki-catalogue-evidence-"));
  const value = createApprovedPublication(root);
  return {root, ...value};
}

function rewriteManifest(root, mutate) {
  const path = join(root, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  mutate(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("approved publication supports exact run and evidence queries", async () => {
  const {root, evidence} = fixture();
  const publication = await CatalogueEvidencePublication.load(root);
  assert.equal(publication.listRuns({brand: "buades", limit: 20}).length, 1);
  assert.equal(publication.listRuns({brand: "mundilite", limit: 20}).length, 0);
  const results = publication.searchEvidence({brand: "buades", series: "demo-series", sku: "bua-demo-001", field_name: "regular_price_eur_gross", limit: 20});
  assert.equal(results.length, 1);
  assert.equal(results[0].evidenceKey, evidence.evidenceKey);
  const record = publication.getEvidence(evidence.evidenceKey);
  assert.equal(record.location.kind, "pdf_region");
  assert.deepEqual(record.location.boxes.map((box) => box.role), ["reference", "value", "header"]);
  assert.equal(record.cropAvailable, false);
  assert.deepEqual(publication.coverage().brands.buades.series, ["demo-series"]);
  await assert.rejects(() => publication.getCrop(evidence.evidenceKey), /use the verified coordinates/);
});

test("pending run approval fails closed", async () => {
  const {root} = fixture();
  const runPath = join(root, "runs/run.json");
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  run.status = "qa_pending";
  run.decision = {state: "pending", actorType: "none", actorRef: null, decidedAt: null, note: null, isExternalMutationAuthority: false};
  writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
  rewriteManifest(root, (manifest) => { manifest.runs[0].sha256 = digest(runPath); });
  await assert.rejects(() => CatalogueEvidencePublication.load(root), /not approved-ready/);
});

test("unapproved evidence fails closed even when its checksum is declared", async () => {
  const {root} = fixture();
  const evidencePath = join(root, "evidence/evidence.json");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  evidence.decision = {state: "candidate", actorType: "none", actorRef: null, decidedAt: null, note: null, isExternalMutationAuthority: false};
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  rewriteManifest(root, (manifest) => { manifest.evidence[0].sha256 = digest(evidencePath); });
  await assert.rejects(() => CatalogueEvidencePublication.load(root), /not Board-approved/);
});

test("raw, undeclared and symlinked files are unreachable by construction", async () => {
  const first = fixture();
  writeFileSync(join(first.root, "raw-export.csv"), "SKU,Price\nsecret,1\n");
  await assert.rejects(() => CatalogueEvidencePublication.load(first.root), /undeclared files/);

  const second = fixture();
  symlinkSync(join(second.root, "evidence/evidence.json"), join(second.root, "evidence/link.json"));
  await assert.rejects(() => CatalogueEvidencePublication.load(second.root), /Symlinks are forbidden/);
});

test("checksum or selector drift fails closed", async () => {
  const first = fixture();
  writeFileSync(join(first.root, "evidence/evidence.json"), "{}\n");
  await assert.rejects(() => CatalogueEvidencePublication.load(first.root), /checksum mismatch/);

  const second = fixture();
  rewriteManifest(second.root, (manifest) => { manifest.evidence[0].sku = "OTHER-SKU"; });
  await assert.rejects(() => CatalogueEvidencePublication.load(second.root), /selector drift/);
});
