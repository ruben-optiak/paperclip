#!/usr/bin/env node
import {mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseCsv} from "../../connectors/catalog-knowledge/src/csv.mjs";
import {assertInstant, assertSlug, sha256} from "../../connectors/catalog-knowledge/src/normalization.mjs";
import {DATA_FILES, loadSupportPack} from "../../connectors/catalog-knowledge/src/support-pack.mjs";

const CROSSWALK_HEADERS = ["entity_key", "manufacturer_ref", "woo_parent_sku", "woo_variation_sku", "mapping_kind", "evidence_ref", "approved_by", "approved_at"];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(value, label) {
  const cleaned = String(value || "").trim();
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers, rows) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

async function prepareEmptyOutput(directory) {
  await mkdir(directory, {recursive: true});
  const entries = await readdir(directory);
  if (entries.length > 0) throw new Error("Approved pack output must be an empty directory; immutable packs are never overwritten");
}

export async function finalizeSupportPack({
  reviewDirectory,
  outputDirectory,
  approvedBy,
  approvedAt,
  expectedReviewManifestSha256,
  expectedSourceRevision,
}) {
  const review = await loadSupportPack(reviewDirectory, {requireApproval: false});
  if (review.manifest.approval.state !== "review_required") throw new Error("Only review_required candidates can be finalized");
  if (review.manifestSha256 !== expectedReviewManifestSha256) throw new Error("Review manifest changed after approval");
  if (review.manifest.sourceRepository.revision !== expectedSourceRevision) throw new Error("Source revision changed after approval");
  const reviewer = assertSlug(approvedBy, "approved-by");
  const instant = assertInstant(approvedAt, "approved-at");
  const rawManifest = JSON.parse(await readFile(join(reviewDirectory, "manifest.json"), "utf8"));
  const data = Object.fromEntries(await Promise.all(DATA_FILES.map(async (filename) => [filename, await readFile(join(reviewDirectory, filename), "utf8")])));
  const crosswalk = parseCsv(data["sku_crosswalk.csv"], CROSSWALK_HEADERS).map((row) => ({
    ...row,
    approved_by: reviewer,
    approved_at: instant,
  }));
  data["sku_crosswalk.csv"] = csv(CROSSWALK_HEADERS, crosswalk);
  rawManifest.approval = {state: "approved", approvedBy: reviewer, approvedAt: instant};
  rawManifest.files["sku_crosswalk.csv"] = {
    sha256: sha256(data["sku_crosswalk.csv"]),
    rows: crosswalk.length,
  };

  await prepareEmptyOutput(outputDirectory);
  for (const filename of DATA_FILES) await writeFile(join(outputDirectory, filename), data[filename], "utf8");
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(rawManifest, null, 2)}\n`, "utf8");
  const approved = await loadSupportPack(outputDirectory);
  return {
    state: approved.manifest.approval.state,
    pack_key: approved.manifest.packKey,
    version: approved.manifest.version,
    approved_by: approved.manifest.approval.approvedBy,
    approved_at: approved.manifest.approval.approvedAt,
    source_revision: approved.manifest.sourceRepository.revision,
    manifest_sha256: approved.manifestSha256,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await finalizeSupportPack({
    reviewDirectory: resolve(required(options["review-dir"], "--review-dir")),
    outputDirectory: resolve(required(options.output, "--output")),
    approvedBy: required(options["approved-by"], "--approved-by"),
    approvedAt: required(options["approved-at"], "--approved-at"),
    expectedReviewManifestSha256: required(options["expected-review-manifest-sha256"], "--expected-review-manifest-sha256"),
    expectedSourceRevision: required(options["expected-source-revision"], "--expected-source-revision"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`finalize-support-pack: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
