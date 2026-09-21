#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";

const SEO_FIXES = {
  MEN000SS: "Cuerpo empotrado Sanybox Inox para grifos murales de lavabo Pool MEN006. Requerido para completar la instalación.",
  MH2000SS: "Cuerpo empotrado Sanybox Inox para monomandos de ducha Pool de 2 vías. Consulta caudal, conexiones y compatibilidad.",
  RAC00012SS: "Conexión empotrada Sanybox Inox de 1/2 para caño BNCA006 y rociador mural ROC006 de la serie Pool.",
  TH2000SS: "Cuerpo empotrado Sanybox Inox para termostáticos de ducha Pool de 2-3 vías. Consulta conexiones y compatibilidad.",
};

const COPY_REPLACEMENTS = [
  [
    "Caudal de 5,4 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo o bidé.",
    "Caudal de 5,4 l/min a 3 bar: caudal equilibrado para el uso diario del bidé.",
  ],
  [
    "Caudal de 4,7 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo o bidé.",
    "Caudal de 4,7 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo.",
  ],
  [
    "Caudal de 5,7 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo o bidé.",
    "Caudal de 5,7 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo.",
  ],
  [
    "Caudal de 5,8 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo o bidé.",
    "Caudal de 5,8 l/min a 3 bar: caudal equilibrado para el uso diario del lavabo.",
  ],
];

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  for (const required of ["source", "output", "created-at"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  if (Number.isNaN(new Date(values["created-at"]).getTime()) || !/[zZ]|[+-]\d\d:\d\d$/.test(values["created-at"])) {
    throw new Error("--created-at must be a valid instant with explicit timezone");
  }
  return values;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

function bytes(value) {
  return Buffer.from(`${JSON.stringify(sorted(value), null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);
const output = resolve(args.output);
if (await stat(output).then(() => true).catch(() => false)) throw new Error("Refusing to overwrite an existing revised batch");

const manifestBytes = await readFile(join(source, "batch-manifest.json"));
const manifest = JSON.parse(manifestBytes);
if (manifest.summary?.readyProducts !== 24 || manifest.summary?.variableProducts !== 20
  || manifest.summary?.simpleProducts !== 4 || manifest.summary?.sellableSkus !== 44
  || manifest.bundles?.length !== 5) {
  throw new Error("Source Pool batch must contain the exact reviewed 24-parent/44-SKU scope");
}

await mkdir(output, {recursive: false, mode: 0o750});
for (const file of [
  "discount-policy.json",
  "gallery-order-approval.json",
  "price-policy-audit.json",
  "primary-image-approval.json",
  "primary-image-policy.json",
  "primary-image-review-manifest.json",
  "taxonomy-snapshot.json",
]) {
  await cp(join(source, file), join(output, file));
}

const review = {
  schema: "enki-pool-content-seo-review-candidate/v1",
  createdAt: args["created-at"],
  authority: {externalWrites: false, publicationAuthority: false},
  scope: {parents: 24, visibleCopyAdjustments: 8, metadataAdjustments: 4},
  findings: [
    {
      code: "SANYBOX_META_UNSUPPORTED_FINISH_AND_GRADE",
      severity: "FAIL",
      products: Object.keys(SEO_FIXES),
      correction: "Remove the unsupported 316L grade and finish CTA; use exact component purpose and compatibility evidence.",
    },
    {
      code: "FLOW_BENEFIT_PRODUCT_TYPE",
      severity: "WARN",
      products: ["MBD006SS", "MEN006R14SS", "MEN006R18SS", "MEN006S14SS", "MEN006S18SS", "MEX006SS", "MNO006SS", "MOA006SS"],
      correction: "Name lavabo or bidé according to the exact product instead of the generic combined phrase.",
    },
  ],
  proposedSeoDescriptions: SEO_FIXES,
};
const reviewBytes = bytes(review);
await writeFile(join(output, "content-seo-review-candidate.json"), reviewBytes, {mode: 0o640});

let metadataAdjustments = 0;
let visibleCopyAdjustments = 0;
for (const row of manifest.bundles) {
  const sourceBundlePath = join(source, row.path);
  const sourceBundleBytes = await readFile(sourceBundlePath);
  if (sha256(sourceBundleBytes) !== row.sha256) throw new Error(`Source bundle hash drift: ${row.bundleKey}`);
  const bundle = JSON.parse(sourceBundleBytes);
  const outputBundlePath = join(output, row.path);
  const outputBundleRoot = dirname(outputBundlePath);
  await mkdir(outputBundleRoot, {recursive: true, mode: 0o750});
  await cp(join(dirname(sourceBundlePath), "media"), join(outputBundleRoot, "media"), {recursive: true});

  bundle.version = "1.7.0";
  bundle.createdAt = args["created-at"];
  for (const product of bundle.products) {
    if (SEO_FIXES[product.sku]) {
      if (!product.seo.description.includes("Consulta acabados") || !product.seo.description.includes("316L")) {
        throw new Error(`Expected inherited Sanybox metadata is absent for ${product.sku}`);
      }
      product.seo.description = SEO_FIXES[product.sku];
      metadataAdjustments += 1;
    }
    for (const [before, after] of COPY_REPLACEMENTS) {
      if (product.descriptionHtml.includes(before)) {
        product.descriptionHtml = product.descriptionHtml.replace(before, after);
        visibleCopyAdjustments += 1;
      }
    }
  }

  const revisedBundleBytes = bytes(bundle);
  await writeFile(outputBundlePath, revisedBundleBytes, {mode: 0o640});
  row.sha256 = sha256(revisedBundleBytes);
  row.validation = "pending_local_preflight";
}
if (metadataAdjustments !== 4 || visibleCopyAdjustments !== 8) {
  throw new Error(`Expected 4 metadata and 8 copy adjustments, found ${metadataAdjustments}/${visibleCopyAdjustments}`);
}

manifest.runId = basename(output);
manifest.createdAt = args["created-at"];
manifest.sources.contentSeoReviewCandidatePath = "content-seo-review-candidate.json";
manifest.sources.contentSeoReviewCandidateSha256 = sha256(reviewBytes);
const revisedManifestBytes = bytes(manifest);
await writeFile(join(output, "batch-manifest.json"), revisedManifestBytes, {mode: 0o640});

const sourceReadme = await readFile(join(source, "README.md"), "utf8");
const revisionNote = [
  "",
  "## Content and SEO review candidate v15",
  "",
  "Four Sanybox meta descriptions no longer claim an unsupported 316L grade or invite the buyer to inspect nonexistent finish variants.",
  "Eight flow-rate benefit bullets now name the exact lavabo or bidé use instead of the generic combined phrase.",
  "This is a local proposal with zero external writes and no publication authority.",
  "",
].join("\n");
await writeFile(join(output, "README.md"), `${sourceReadme.trimEnd()}\n${revisionNote}`, {mode: 0o640});

console.log(JSON.stringify({
  status: "complete",
  output,
  productsReviewed: 24,
  metadataAdjustments,
  visibleCopyAdjustments,
  batchManifestSha256: sha256(revisedManifestBytes),
  reviewCandidateSha256: sha256(reviewBytes),
  externalWrites: 0,
}, null, 2));
