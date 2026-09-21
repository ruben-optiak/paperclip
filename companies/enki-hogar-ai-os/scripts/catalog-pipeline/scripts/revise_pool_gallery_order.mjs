#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";

const AUTHORIZATION = "user-approved-pool-metal-raw-gallery-order-2026-09-21";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  for (const required of ["source", "output", "created-at", "authorization"]) {
    if (!values[required]) throw new Error(`Missing --${required}`);
  }
  if (values.authorization !== AUTHORIZATION) throw new Error("Exact Pool gallery-order authorization marker is required");
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

function finish(variation) {
  const option = variation.attributes?.find((attribute) => Number(attribute.id) === 15)?.option;
  if (option === "Níquel cepillado") return "NB";
  if (option === "Metal Raw") return "RM";
  throw new Error(`Unsupported Pool finish for ${variation.sku}`);
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);
const output = resolve(args.output);
if (await stat(output).then(() => true).catch(() => false)) throw new Error("Refusing to overwrite an existing revised batch");

const manifestPath = join(source, "batch-manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
if (manifest.summary?.readyProducts !== 24 || manifest.summary?.variableProducts !== 20
  || manifest.summary?.simpleProducts !== 4 || manifest.summary?.sellableSkus !== 44
  || manifest.bundles?.length !== 5) {
  throw new Error("Source Pool batch must contain the exact reviewed 24-parent/44-SKU scope");
}

await mkdir(output, {recursive: false, mode: 0o750});
for (const file of [
  "discount-policy.json",
  "price-policy-audit.json",
  "primary-image-approval.json",
  "primary-image-policy.json",
  "primary-image-review-manifest.json",
  "taxonomy-snapshot.json",
]) {
  await cp(join(source, file), join(output, file));
}

const approval = {
  schema: "enki-product-gallery-order-approval/v1",
  approvedAt: args["created-at"],
  authority: "chat-user-explicit",
  authorization: AUTHORIZATION,
  scope: {
    parents: 20,
    series: "Pool",
    brand: "Sanycces",
    productType: "variable",
  },
  order: [
    "Metal Raw product cutout",
    "Níquel cepillado product cutout",
    "inspiration when available",
    "dimensions",
    "finish samples",
  ],
  defaultVariationSelectionChanged: false,
  mediaUploads: 0,
};
const approvalBytes = bytes(approval);
await writeFile(join(output, "gallery-order-approval.json"), approvalBytes, {mode: 0o640});

let variableProductsReordered = 0;
let simpleProductsPreserved = 0;
for (const row of manifest.bundles) {
  const sourceBundlePath = join(source, row.path);
  const sourceBundleBytes = await readFile(sourceBundlePath);
  if (sha256(sourceBundleBytes) !== row.sha256) throw new Error(`Source bundle hash drift: ${row.bundleKey}`);
  const bundle = JSON.parse(sourceBundleBytes);
  const outputBundlePath = join(output, row.path);
  const outputBundleRoot = dirname(outputBundlePath);
  await mkdir(outputBundleRoot, {recursive: true, mode: 0o750});
  await cp(join(dirname(sourceBundlePath), "media"), join(outputBundleRoot, "media"), {recursive: true});

  bundle.version = "1.6.0";
  bundle.createdAt = args["created-at"];
  for (const product of bundle.products) {
    if (product.type === "simple") {
      simpleProductsPreserved += 1;
      continue;
    }
    if (product.type !== "variable" || product.variations?.length !== 2) {
      throw new Error(`Unexpected Pool product shape: ${product.sku}`);
    }
    const byFinish = new Map(product.variations.map((variation) => [finish(variation), variation]));
    if (byFinish.size !== 2 || !byFinish.has("NB") || !byFinish.has("RM")) {
      throw new Error(`Exact NB/RM pair missing for ${product.sku}`);
    }
    const nb = product.images.find((image) => image.position === byFinish.get("NB").imagePosition);
    const rm = product.images.find((image) => image.position === byFinish.get("RM").imagePosition);
    if (!nb || !rm || nb.sha256 === rm.sha256) throw new Error(`Distinct NB/RM media missing for ${product.sku}`);
    const remainder = [...product.images]
      .filter((image) => image !== nb && image !== rm && image.gallery !== false)
      .sort((left, right) => left.position - right.position);
    if (remainder.length !== 3) throw new Error(`Expected inspiration, dimensions and finish samples for ${product.sku}`);
    product.images = [rm, nb, ...remainder].map((image, position) => ({...image, gallery: true, position}));
    byFinish.get("RM").imagePosition = 0;
    byFinish.get("NB").imagePosition = 1;
    variableProductsReordered += 1;
  }

  const revisedBundleBytes = bytes(bundle);
  await writeFile(outputBundlePath, revisedBundleBytes, {mode: 0o640});
  row.sha256 = sha256(revisedBundleBytes);
  row.validation = "pending_local_preflight";
}
if (variableProductsReordered !== 20 || simpleProductsPreserved !== 4) {
  throw new Error(`Expected 20 variable and 4 simple products, found ${variableProductsReordered}/${simpleProductsPreserved}`);
}

manifest.runId = basename(output);
manifest.createdAt = args["created-at"];
manifest.sources.galleryOrderApprovalPath = "gallery-order-approval.json";
manifest.sources.galleryOrderApprovalSha256 = sha256(approvalBytes);
const revisedManifestBytes = bytes(manifest);
await writeFile(join(output, "batch-manifest.json"), revisedManifestBytes, {mode: 0o640});

const sourceReadme = await readFile(join(source, "README.md"), "utf8");
const revisionNote = [
  "",
  "## Gallery-order revision v14",
  "",
  "The 20 variable Pool products use Metal Raw as the parent hero, followed by the Níquel cepillado cutout, inspiration, dimensions and finish samples.",
  "Variation images still point to their exact finishes. The four simple Sanybox products are unchanged, and no default variation is selected.",
  "No media upload, title, description, price, taxonomy, brand, stock, status or product-identity change is authorized by this revision.",
  "",
].join("\n");
await writeFile(join(output, "README.md"), `${sourceReadme.trimEnd()}\n${revisionNote}`, {mode: 0o640});

console.log(JSON.stringify({
  status: "complete",
  output,
  variableParentsReordered: variableProductsReordered,
  simpleParentsPreserved: simpleProductsPreserved,
  mediaUploads: 0,
  batchManifestSha256: sha256(revisedManifestBytes),
  approvalSha256: sha256(approvalBytes),
  externalWrites: 0,
}, null, 2));
