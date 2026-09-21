#!/usr/bin/env node

import {createHash} from "node:crypto";
import {cp, mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";

const CATEGORY_CHAINS = new Map([
  [291, [280, 291]],
  [310, [280, 310]],
  [331, [280, 331]],
  [347, [280, 956, 347]],
  [956, [280, 956]],
  [959, [280, 959]],
  [965, [280, 956, 965]],
  [966, [280, 956, 966]],
  [970, [280, 291, 970]],
  [972, [280, 959, 972]],
  [975, [280, 959, 975]],
  [976, [958, 976]],
  [977, [280, 291, 977]],
]);
const CATEGORY_NAMES = new Map([
  [280, "Grifos de baño"],
  [958, "Fontanería"],
]);
const REFERENCE_PARAGRAPH = /<p><strong>Referencias del catálogo:<\/strong>[^<]*<\/p>$/;
const INTERNAL_COPY_REPLACEMENTS = [
  [
    "La colección Pool combina geometrías redondeadas con acero inoxidable 316L. Esta ficha se ha preparado desde el catálogo PDF suministrado; la web oficial se usa solo como enriquecimiento.",
    "La colección Pool combina geometrías redondeadas, acero inoxidable 316L y soluciones pensadas para integrar la grifería en baños contemporáneos.",
  ],
  [
    "componente técnico de la colección Pool de Sanycces con trazabilidad al catálogo oficial.",
    "componente técnico de la colección Pool de Sanycces para instalaciones compatibles.",
  ],
  [
    "Compatible con las configuraciones indicadas en la ficha PDF de Pool",
    "Compatible con las configuraciones Pool BNCA006 y ROC006",
  ],
];
const FORBIDDEN_CUSTOMER_COPY = /catálogo PDF|web oficial|trazabilidad al catálogo|ficha PDF/i;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Use --source <batch-dir> --output <new-batch-dir> --created-at <ISO instant>");
    values[key.slice(2)] = value;
  }
  if (!values.source || !values.output || !values["created-at"]) throw new Error("Use --source <batch-dir> --output <new-batch-dir> --created-at <ISO instant>");
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

function reviseCommerce(commerce) {
  const revised = {...commerce, manageStock: false, stockStatus: "instock"};
  delete revised.stockQuantity;
  return revised;
}

function sanitizeCustomerCopy(value, productKey) {
  let revised = value.replace(REFERENCE_PARAGRAPH, "");
  for (const [source, replacement] of INTERNAL_COPY_REPLACEMENTS) revised = revised.replace(source, replacement);
  if (FORBIDDEN_CUSTOMER_COPY.test(revised)) throw new Error(`Internal provenance remains in customer copy for ${productKey}`);
  return revised;
}

function reviseProduct(product, taxonomySha256) {
  const leaf = product.categories.at(-1);
  const categories = CATEGORY_CHAINS.get(leaf);
  if (!categories) throw new Error(`Missing reviewed category chain for ${product.productKey}: ${leaf}`);
  const categoryEvidence = product.evidence.find((item) => item.field === "product.categories");
  if (!categoryEvidence) throw new Error(`Missing category evidence for ${product.productKey}`);
  const otherEvidence = product.evidence.filter((item) => item.field !== "product.categories");
  return {
    ...product,
    descriptionHtml: sanitizeCustomerCopy(product.descriptionHtml, product.productKey),
    shortDescriptionHtml: sanitizeCustomerCopy(product.shortDescriptionHtml, product.productKey),
    categories,
    commerce: reviseCommerce(product.commerce),
    evidence: [
      ...categories.map((categoryId) => ({
        ...categoryEvidence,
        evidenceKey: `woo-category:${categoryId}`,
        sourceSha256: taxonomySha256,
      })),
      ...otherEvidence,
    ],
    ...(product.type === "variable" ? {
      variations: product.variations.map((variation) => ({
        ...variation,
        commerce: reviseCommerce(variation.commerce),
      })),
    } : {}),
  };
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);
const output = resolve(args.output);
const createdAt = new Date(args["created-at"]);
if (Number.isNaN(createdAt.getTime()) || !/[zZ]|[+-]\d\d:\d\d$/.test(args["created-at"])) throw new Error("--created-at must include an explicit timezone");
if (await stat(output).then(() => true).catch(() => false)) throw new Error("Refusing to overwrite an existing revised batch");

const manifest = JSON.parse(await readFile(join(source, "batch-manifest.json"), "utf8"));
const taxonomy = JSON.parse(await readFile(join(source, "taxonomy-snapshot.json"), "utf8"));
taxonomy.capturedAt = args["created-at"];
taxonomy.brand = {id: 1410, name: "Sanycces", slug: "sanycces"};
for (const [id, name] of CATEGORY_NAMES) taxonomy.categoryPaths[name] = id;
const taxonomyBytes = bytes(taxonomy);
const taxonomySha256 = sha256(taxonomyBytes);

await mkdir(output, {recursive: false, mode: 0o750});
for (const file of ["README.md", "discount-policy.json", "price-policy-audit.json"]) {
  await cp(join(source, file), join(output, file));
}
await writeFile(join(output, "taxonomy-snapshot.json"), taxonomyBytes, {mode: 0o640});

for (const row of manifest.bundles) {
  const sourceBundlePath = join(source, row.path);
  const outputBundlePath = join(output, row.path);
  const bundle = JSON.parse(await readFile(sourceBundlePath, "utf8"));
  bundle.version = "1.2.0";
  bundle.createdAt = args["created-at"];
  bundle.products = bundle.products.map((product) => reviseProduct(product, taxonomySha256));
  const bundleBytes = bytes(bundle);
  await mkdir(dirname(outputBundlePath), {recursive: true, mode: 0o750});
  await cp(join(dirname(sourceBundlePath), "media"), join(dirname(outputBundlePath), "media"), {recursive: true});
  await writeFile(outputBundlePath, bundleBytes, {mode: 0o640});
  row.sha256 = sha256(bundleBytes);
  row.validation = "pending_external_schema_and_media_validation";
}

manifest.runId = basename(output);
manifest.createdAt = args["created-at"];
manifest.sources.taxonomySnapshotSha256 = taxonomySha256;
await writeFile(join(output, "batch-manifest.json"), bytes(manifest), {mode: 0o640});
console.log(JSON.stringify({
  output,
  stockPolicy: {manageStock: false, stockStatus: "instock", quantity: null},
  brand: taxonomy.brand,
  bundleCount: manifest.bundles.length,
  productCount: manifest.bundles.reduce((sum, row) => sum + row.productCount, 0),
  bundleSha256: Object.fromEntries(manifest.bundles.map((row) => [row.bundleKey, row.sha256])),
}, null, 2));
