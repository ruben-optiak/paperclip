import {createHash} from "node:crypto";
import {cpSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

const connectorDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const packageDir = resolve(connectorDir, "../..");
const contractFixture = join(packageDir, "skills/enki-catalog-qa/fixtures/catalog-contracts/valid");

export function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function createApprovedPublication(root) {
  mkdirSync(join(root, "runs"), {recursive: true});
  mkdirSync(join(root, "evidence"), {recursive: true});
  const run = json(join(contractFixture, "run.json"));
  run.status = "local_export_ready";
  run.stages.qa = {status: "complete", completedAt: "2026-09-01T12:00:00+02:00", artifactKeys: ["change-set-json"]};
  run.stages.approval = {status: "complete", completedAt: "2026-09-01T12:10:00+02:00", artifactKeys: []};
  run.stages.export = {status: "complete", completedAt: "2026-09-01T12:15:00+02:00", artifactKeys: []};
  run.decision = {state: "approved_for_local_export", actorType: "board", actorRef: "board-fixture", decidedAt: "2026-09-01T12:10:00+02:00", note: "Approved fixture publication only.", isExternalMutationAuthority: false};
  const evidence = json(join(contractFixture, "evidence-candidate.json"));
  evidence.decision = {state: "approved", actorType: "board", actorRef: "board-fixture", decidedAt: "2026-09-01T12:10:00+02:00", note: "Approved sanitized evidence.", isExternalMutationAuthority: false};

  const runPath = join(root, "runs/run.json");
  const evidencePath = join(root, "evidence/evidence.json");
  writeJson(runPath, run);
  writeJson(evidencePath, evidence);
  const manifest = {
    schema: "enki-catalog-evidence-publication/v1",
    publicationKey: "eai-022-approved-fixture",
    version: "1.0.0",
    publishedAt: "2026-09-01T12:15:00+02:00",
    timezone: "Europe/Madrid",
    approval: {state: "approved", actorType: "board", actorRef: "board-fixture", decidedAt: "2026-09-01T12:10:00+02:00", note: "Sanitized connector gate."},
    runs: [{runKey: run.runKey, path: "runs/run.json", sha256: digest(runPath)}],
    evidence: [{
      evidenceKey: evidence.evidenceKey,
      runKey: run.runKey,
      path: "evidence/evidence.json",
      sha256: digest(evidencePath),
      brand: "buades",
      series: "demo-series",
      sku: "BUA-DEMO-001",
      manufacturerRef: "DEMO-001",
      fieldGroup: "commercial",
      fieldName: "regular_price_eur_gross",
      crop: null,
    }],
    authority: {approvedRunsOnly: true, approvedFieldEvidenceOnly: true, rawInputsIncluded: false, externalWritesBlocked: true},
  };
  writeJson(join(root, "manifest.json"), manifest);
  return {manifest, run, evidence};
}

export function clonePublication(source, target) {
  cpSync(source, target, {recursive: true});
}
