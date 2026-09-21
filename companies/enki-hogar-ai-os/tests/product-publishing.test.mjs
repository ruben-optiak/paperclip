import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {validateProductDraftBundle} from "../skills/enki-product-publishing/scripts/validate_product_draft_bundle.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractDir = join(packageDir, "references", "contracts");
const skillDir = join(packageDir, "skills", "enki-product-publishing");
const serverRequire = createRequire(join(packageDir, "..", "..", "server", "package.json"));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const mediaSchema = json(join(contractDir, "product-media-profile-v1.schema.json"));
const bundleSchema = json(join(contractDir, "product-draft-bundle-v1.schema.json"));
const mediaFixture = json(join(skillDir, "fixtures", "media-profile.json"));
const bundleFixture = json(join(skillDir, "fixtures", "product-draft-bundle.json"));
const variableBundleFixture = json(join(skillDir, "fixtures", "product-draft-bundle-variable.json"));
const ajv = new Ajv2020({strict: true, allErrors: true});
addFormats(ajv);
const validateMedia = ajv.compile(mediaSchema);
const validateBundle = ajv.compile(bundleSchema);

test("product publishing schemas compile strictly and fixtures validate", () => {
  assert.equal(mediaSchema.$id, "urn:enki:product-media-profile:v1");
  assert.equal(bundleSchema.$id, "urn:enki:product-draft-bundle:v1");
  assert.equal(validateMedia(mediaFixture), true, JSON.stringify(validateMedia.errors));
  assert.equal(validateBundle(bundleFixture), true, JSON.stringify(validateBundle.errors));
  assert.equal(validateBundle(variableBundleFixture), true, JSON.stringify(validateBundle.errors));
  assert.deepEqual(validateProductDraftBundle(bundleFixture), {valid: true, errors: []});
  assert.deepEqual(validateProductDraftBundle(variableBundleFixture), {valid: true, errors: []});
});

test("product publishing runtime references are byte-identical to canonical contracts", () => {
  for (const name of ["product-media-profile-v1.schema.json", "product-draft-bundle-v1.schema.json"]) {
    assert.equal(sha(join(contractDir, name)), sha(join(skillDir, "references", name)), name);
  }
});

test("product bundle blocks publish status, unsupported media origins and prices without evidence", () => {
  const unsafe = structuredClone(bundleFixture);
  unsafe.products[0].status = "publish";
  unsafe.products[0].images[0].sourceUrl = "https://unapproved.example.invalid/image.webp";
  delete unsafe.products[0].commerce.priceEvidenceKey;
  assert.equal(validateBundle(unsafe), false);
  const semantic = validateProductDraftBundle(unsafe);
  assert.equal(semantic.valid, false);
  assert.deepEqual(new Set(semantic.errors.map((entry) => entry.code)), new Set([
    "unsafe_product_mode",
    "missing_price_evidence",
    "unapproved_media_origin",
  ]));
});

test("product media profile cannot upscale or retain metadata", () => {
  assert.equal(mediaFixture.output.allowUpscale, false);
  assert.equal(mediaFixture.output.stripMetadata, true);
  assert.equal(mediaFixture.output.format, "webp");
  assert.equal(mediaFixture.source.rightsConfirmationRequired, true);
});

test("product copy cannot embed executable or independently fetched content", () => {
  const unsafe = structuredClone(bundleFixture);
  unsafe.products[0].descriptionHtml = "<p onclick=\"alert(1)\">Body</p><script>alert(1)</script>";
  assert.equal(validateBundle(unsafe), false);
  assert.equal(validateProductDraftBundle(unsafe).errors.some((entry) => entry.code === "unsafe_html"), true);
});

test("variable bundle pins exact child SKUs, options, prices and private state", () => {
  const unsafe = structuredClone(variableBundleFixture);
  unsafe.products[0].variations[1].sku = unsafe.products[0].variations[0].sku;
  unsafe.products[0].variations[1].attributes[0].option = "Acabado inventado";
  unsafe.products[0].variations[1].status = "publish";
  assert.equal(validateBundle(unsafe), false);
  const semantic = validateProductDraftBundle(unsafe);
  assert.equal(semantic.valid, false);
  assert.deepEqual(new Set(semantic.errors.map((entry) => entry.code)), new Set([
    "duplicate_identity",
    "unsafe_variation_mode",
    "unknown_variation_option",
    "unused_variation_option",
  ]));
});
