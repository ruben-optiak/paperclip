#!/usr/bin/env node
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {basename, dirname, isAbsolute, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const PORTABLE_MEDIA = /^media\/[a-z0-9][a-z0-9._-]*\.webp$/;
const UNSAFE_HTML = /(?:<\s*(?:script|iframe|object|embed|form|input|button|link|meta|img|svg|math|style)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:)/i;

function isValidGtin(value) {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value || "")) return false;
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function inspectWebp(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("invalid RIFF/WebP header");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("RIFF size mismatch");
  let width = null;
  let height = null;
  let offset = 12;
  const forbidden = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("truncated WebP chunk header");
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error(`truncated ${type} chunk`);
    const payload = bytes.subarray(start, end);
    if (["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"].includes(type)) forbidden.push(type);
    if (type === "VP8X") {
      if (size !== 10) throw new Error("invalid VP8X chunk");
      width = payload[4] | (payload[5] << 8) | (payload[6] << 16);
      height = payload[7] | (payload[8] << 8) | (payload[9] << 16);
      width += 1;
      height += 1;
    } else if (type === "VP8 ") {
      if (size < 10 || payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) throw new Error("invalid VP8 frame header");
      width = payload.readUInt16LE(6) & 0x3fff;
      height = payload.readUInt16LE(8) & 0x3fff;
    } else if (type === "VP8L") {
      if (size < 5 || payload[0] !== 0x2f) throw new Error("invalid VP8L frame header");
      const bits = payload.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || !width || !height) throw new Error("missing dimensions");
  if (forbidden.length > 0) throw new Error(`forbidden chunks: ${forbidden.join(", ")}`);
  return {width, height};
}

function officialHostname(url, domains) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && domains.some((domain) => hostname === String(domain).toLowerCase() || hostname.endsWith(`.${String(domain).toLowerCase()}`));
  } catch {
    return false;
  }
}

export function validateProductDraftBundle(bundle, {root = null, verifyFiles = false} = {}) {
  const errors = [];
  const add = (code, path, message) => errors.push({code, path, message});
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return {valid: false, errors: [{code: "invalid_document", path: "/", message: "Expected one JSON object."}]};
  }
  if (bundle.schema !== "enki-product-draft-bundle/v1") add("schema", "/schema", "Unexpected bundle schema.");
  if (bundle.review?.externalMutationAuthority !== "paperclip_exact_approval_only") add("authority", "/review/externalMutationAuthority", "Only exact Paperclip approval may authorize the draft write.");
  const products = Array.isArray(bundle.products) ? bundle.products : [];
  if (products.length < 1 || products.length > 5) add("product_count", "/products", "A canary bundle needs one to five products.");
  const domains = bundle.sourceSnapshot?.officialDomains || [];
  const keys = new Set();
  const skus = new Set();
  const slugs = new Set();
  const recordUnique = (values, value, path, label) => {
    if (values.has(value)) add("duplicate_identity", path, `Duplicate ${label}.`);
    values.add(value);
  };
  const validateCommerce = (commerce, evidenceKeys, base, {priceRequired = false} = {}) => {
    if (commerce?.manageStock !== false || commerce?.stockStatus !== "outofstock") add("unsafe_stock", base, "Initial drafts and variations must be unmanaged and out of stock.");
    if (priceRequired && !commerce?.regularPrice) add("missing_regular_price", `${base}/regularPrice`, "A sellable variation needs a regular price.");
    if (commerce?.regularPrice && !commerce?.priceEvidenceKey) add("missing_price_evidence", `${base}/priceEvidenceKey`, "A price needs exact evidence.");
    if (commerce?.priceEvidenceKey && !evidenceKeys.has(commerce.priceEvidenceKey)) add("unknown_price_evidence", `${base}/priceEvidenceKey`, "Price evidence key is absent from entity evidence.");
    if (commerce?.salePrice && !commerce?.salePriceEvidenceKey) add("missing_sale_price_evidence", `${base}/salePriceEvidenceKey`, "A sale price needs exact policy evidence.");
    if (commerce?.salePriceEvidenceKey && !evidenceKeys.has(commerce.salePriceEvidenceKey)) add("unknown_sale_price_evidence", `${base}/salePriceEvidenceKey`, "Sale-price evidence key is absent from entity evidence.");
    if (commerce?.salePrice && (!commerce?.regularPrice || Number(commerce.salePrice) >= Number(commerce.regularPrice))) add("invalid_sale_price", `${base}/salePrice`, "Sale price must be lower than the regular price.");
  };
  for (const [index, product] of products.entries()) {
    const base = `/products/${index}`;
    recordUnique(keys, product?.productKey, `${base}/productKey`, "productKey");
    recordUnique(skus, product?.sku, `${base}/sku`, "SKU");
    recordUnique(slugs, product?.slug, `${base}/slug`, "slug");
    if (product?.gtin && !isValidGtin(product.gtin)) add("invalid_gtin", `${base}/gtin`, "GTIN check digit is invalid.");
    if (!new Set(["simple", "variable"]).has(product?.type) || product?.status !== "draft") add("unsafe_product_mode", base, "v1 accepts only simple or variable draft products.");
    for (const field of ["descriptionHtml", "shortDescriptionHtml"]) {
      if (UNSAFE_HTML.test(product?.[field] || "")) add("unsafe_html", `${base}/${field}`, "Executable, embedded or independently fetched HTML is forbidden.");
    }
    const evidenceKeys = new Set((product?.evidence || []).map((item) => item.evidenceKey));
    validateCommerce(product?.commerce, evidenceKeys, `${base}/commerce`);
    const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
    if (product?.type === "simple") {
      if (Array.isArray(product?.variations)) add("unexpected_variations", `${base}/variations`, "Simple products cannot contain variations.");
      if (attributes.some((item) => item?.variation === true)) add("unexpected_variation_attribute", `${base}/attributes`, "Simple-product attributes cannot drive variations.");
    }
    if (product?.type === "variable") {
      if (product?.commerce?.regularPrice || product?.commerce?.salePrice) add("parent_price_forbidden", `${base}/commerce`, "Variable parent prices must remain on child variations.");
      const variationAttributes = attributes.filter((item) => item?.variation === true);
      if (variationAttributes.length === 0) add("missing_variation_attribute", `${base}/attributes`, "Variable products need at least one variation attribute.");
      const expectedIds = variationAttributes.map((item) => item.id).sort((left, right) => left - right);
      const usedOptions = new Map(variationAttributes.map((item) => [item.id, new Set()]));
      const imagePositions = new Set((product?.images || []).map((item) => item.position));
      const variations = Array.isArray(product?.variations) ? product.variations : [];
      if (variations.length < 2 || variations.length > 30) add("variation_count", `${base}/variations`, "Variable products need two to thirty reviewed variations.");
      const variationKeys = new Set();
      for (const [variationIndex, variation] of variations.entries()) {
        const variationBase = `${base}/variations/${variationIndex}`;
        recordUnique(variationKeys, variation?.variationKey, `${variationBase}/variationKey`, "variationKey");
        recordUnique(skus, variation?.sku, `${variationBase}/sku`, "SKU");
        if (variation?.gtin && !isValidGtin(variation.gtin)) add("invalid_gtin", `${variationBase}/gtin`, "GTIN check digit is invalid.");
        if (variation?.status !== "private") add("unsafe_variation_mode", `${variationBase}/status`, "Child variations must remain private while the parent is a draft.");
        const childEvidenceKeys = new Set((variation?.evidence || []).map((item) => item.evidenceKey));
        validateCommerce(variation?.commerce, childEvidenceKeys, `${variationBase}/commerce`, {priceRequired: true});
        const childAttributes = Array.isArray(variation?.attributes) ? variation.attributes : [];
        const childIds = childAttributes.map((item) => item.id).sort((left, right) => left - right);
        if (JSON.stringify(childIds) !== JSON.stringify(expectedIds)) add("variation_attribute_mismatch", `${variationBase}/attributes`, "Variation must cover the exact parent variation attributes.");
        for (const childAttribute of childAttributes) {
          const parentAttribute = variationAttributes.find((item) => item.id === childAttribute.id);
          if (!parentAttribute?.options?.includes(childAttribute.option)) add("unknown_variation_option", `${variationBase}/attributes`, "Variation option is absent from the parent attribute.");
          else usedOptions.get(childAttribute.id).add(childAttribute.option);
        }
        if (variation?.imagePosition !== undefined && !imagePositions.has(variation.imagePosition)) add("unknown_variation_image", `${variationBase}/imagePosition`, "Variation image position is absent from parent media.");
      }
      for (const parentAttribute of variationAttributes) {
        if ((parentAttribute.options || []).some((option) => !usedOptions.get(parentAttribute.id).has(option))) add("unused_variation_option", `${base}/attributes`, "Every reviewed parent option needs at least one child variation.");
      }
    }
    const positions = new Set();
    for (const [imageIndex, image] of (product?.images || []).entries()) {
      const imageBase = `${base}/images/${imageIndex}`;
      if (!PORTABLE_MEDIA.test(image?.path || "") || isAbsolute(image?.path || "") || (image?.path || "").includes("..")) add("unsafe_media_path", `${imageBase}/path`, "Media path must be a portable WebP below media/.");
      if (positions.has(image?.position)) add("duplicate_media_position", `${imageBase}/position`, "Image positions must be unique per product.");
      positions.add(image?.position);
      if (!officialHostname(image?.sourceUrl, domains)) add("unapproved_media_origin", `${imageBase}/sourceUrl`, "Media must come from an approved official HTTPS domain.");
      if (image?.rightsConfirmed !== true) add("rights_unconfirmed", `${imageBase}/rightsConfirmed`, "Media rights must be explicitly confirmed.");
      if (!SHA256.test(image?.sha256 || "")) add("invalid_sha256", `${imageBase}/sha256`, "Media needs a lowercase SHA-256.");
      if (verifyFiles && root && PORTABLE_MEDIA.test(image?.path || "")) {
        const resolvedRoot = resolve(root);
        const resolvedPath = resolve(resolvedRoot, image.path);
        if (dirname(resolvedPath) !== join(resolvedRoot, "media")) add("unsafe_media_path", `${imageBase}/path`, "Media must be a direct child of media/.");
        else {
          try {
            const bytes = readFileSync(resolvedPath);
            if (createHash("sha256").update(bytes).digest("hex") !== image.sha256) add("media_hash_mismatch", `${imageBase}/sha256`, `Hash mismatch for ${basename(resolvedPath)}.`);
            const inspected = inspectWebp(bytes);
            if (inspected.width !== image.width || inspected.height !== image.height) add("media_dimension_mismatch", imageBase, `Pixel dimensions differ for ${basename(resolvedPath)}.`);
          } catch {
            add("invalid_media", `${imageBase}/path`, `Missing or unsafe WebP file ${image.path}.`);
          }
        }
      }
    }
  }
  for (const [index, page] of (bundle.sourceSnapshot?.webPages || []).entries()) {
    if (!officialHostname(page?.url, domains)) add("unapproved_web_origin", `/sourceSnapshot/webPages/${index}/url`, "Web evidence must use an approved official HTTPS domain.");
  }
  return {valid: errors.length === 0, errors};
}

function parseArgs(argv) {
  const args = {bundle: null, verifyFiles: false};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--bundle") args.bundle = argv[++index];
    else if (argv[index] === "--verify-files") args.verifyFiles = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.bundle) throw new Error("Usage: validate_product_draft_bundle.mjs --bundle FILE [--verify-files]");
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const path = resolve(args.bundle);
    const result = validateProductDraftBundle(JSON.parse(readFileSync(path, "utf8")), {root: dirname(path), verifyFiles: args.verifyFiles});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
