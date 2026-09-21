import {createHash} from "node:crypto";
import {lstat, readFile} from "node:fs/promises";
import {dirname, join, resolve, sep} from "node:path";
import {z} from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const officialUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Use HTTPS");
const unsafeHtml = /(?:<\s*(?:script|iframe|object|embed|form|input|button|link|meta|img|svg|math|style)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:)/i;
const safeHtml = (maximum) => z.string().min(1).max(maximum).refine((value) => !unsafeHtml.test(value), "Executable or embedded HTML is forbidden");
const evidence = z.object({
  field: z.string().min(1).max(200),
  evidenceKey: z.string().min(1).max(200),
  sourceSha256: sha256,
  sourceUrl: officialUrl.optional(),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();
const image = z.object({
  path: z.string().regex(/^media\/[a-z0-9][a-z0-9._-]*\.webp$/),
  sha256,
  width: z.number().int().min(256).max(2400),
  height: z.number().int().min(256).max(2400),
  alt: z.string().min(1).max(250),
  position: z.number().int().min(0).max(7),
  gallery: z.boolean().optional(),
  sourceUrl: officialUrl,
  rightsConfirmed: z.literal(true),
}).strict();
const money = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{2})?$/);
function validateInventory(value, context) {
  if (value.manageStock && value.stockQuantity === undefined) {
    context.addIssue({code: "custom", message: "managed stock requires stockQuantity"});
  }
  if (!value.manageStock && value.stockQuantity !== undefined) {
    context.addIssue({code: "custom", message: "stockQuantity requires managed stock"});
  }
  if (value.manageStock && value.stockStatus !== "instock") {
    context.addIssue({code: "custom", message: "positive managed draft stock must be instock"});
  }
}
const attribute = z.object({
  id: z.number().int().positive(),
  options: z.array(z.string().min(1).max(100)).min(1).max(30),
  visible: z.boolean(),
  variation: z.boolean(),
}).strict();
const pricedCommerce = z.object({
  regularPrice: money.optional(),
  priceEvidenceKey: z.string().min(1).max(200).optional(),
  salePrice: money.optional(),
  salePriceEvidenceKey: z.string().min(1).max(200).optional(),
  manageStock: z.boolean(),
  stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
  stockStatus: z.enum(["instock", "outofstock"]),
}).strict().superRefine((value, context) => {
  validateInventory(value, context);
  if (Boolean(value.regularPrice) !== Boolean(value.priceEvidenceKey)) {
    context.addIssue({code: "custom", message: "regularPrice and priceEvidenceKey must appear together"});
  }
  if (Boolean(value.salePrice) !== Boolean(value.salePriceEvidenceKey)) {
    context.addIssue({code: "custom", message: "salePrice and salePriceEvidenceKey must appear together"});
  }
  if (value.salePrice && !value.regularPrice) {
    context.addIssue({code: "custom", message: "salePrice requires regularPrice"});
  }
  if (value.salePrice && value.regularPrice && Number(value.salePrice) >= Number(value.regularPrice)) {
    context.addIssue({code: "custom", message: "salePrice must be lower than regularPrice"});
  }
});
const variationCommerce = z.object({
  regularPrice: money,
  priceEvidenceKey: z.string().min(1).max(200),
  salePrice: money.optional(),
  salePriceEvidenceKey: z.string().min(1).max(200).optional(),
  manageStock: z.boolean(),
  stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
  stockStatus: z.enum(["instock", "outofstock"]),
}).strict().superRefine((value, context) => {
  validateInventory(value, context);
  if (Boolean(value.salePrice) !== Boolean(value.salePriceEvidenceKey)) {
    context.addIssue({code: "custom", message: "salePrice and salePriceEvidenceKey must appear together"});
  }
  if (value.salePrice && Number(value.salePrice) >= Number(value.regularPrice)) {
    context.addIssue({code: "custom", message: "salePrice must be lower than regularPrice"});
  }
});
const variation = z.object({
  variationKey: slug,
  status: z.literal("private"),
  sku: z.string().min(1).max(100),
  manufacturerReference: z.string().min(1).max(100),
  gtin: z.string().regex(/^(?:[0-9]{8}|[0-9]{12,14})$/).optional(),
  attributes: z.array(z.object({
    id: z.number().int().positive(),
    option: z.string().min(1).max(100),
  }).strict()).min(1).max(10),
  imagePosition: z.number().int().min(0).max(7).optional(),
  commerce: variationCommerce,
  evidence: z.array(evidence).min(1).max(50),
}).strict();
const productBase = z.object({
  productKey: slug,
  status: z.literal("draft"),
  name: z.string().min(1).max(200),
  slug,
  sku: z.string().min(1).max(100),
  manufacturerReference: z.string().min(1).max(100),
  gtin: z.string().regex(/^(?:[0-9]{8}|[0-9]{12,14})$/).optional(),
  descriptionHtml: safeHtml(100_000),
  shortDescriptionHtml: safeHtml(10_000),
  categories: z.array(z.number().int().positive()).min(1).max(10),
  tags: z.array(z.number().int().positive()).max(20),
  images: z.array(image).min(1).max(8),
  seo: z.object({
    provider: z.literal("yoast"),
    title: z.string().min(1).max(70),
    description: z.string().min(1).max(170),
    focusKeyword: z.string().min(1).max(100),
  }).strict(),
  evidence: z.array(evidence).min(1).max(200),
}).strict();
const simpleProduct = productBase.extend({
  type: z.literal("simple"),
  attributes: z.array(attribute.extend({variation: z.literal(false)}).strict()).max(30),
  commerce: pricedCommerce,
}).strict();
const variableProduct = productBase.extend({
  type: z.literal("variable"),
  attributes: z.array(attribute).min(1).max(30),
  commerce: z.object({
    manageStock: z.boolean(),
    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    stockStatus: z.enum(["instock", "outofstock"]),
  }).strict().superRefine(validateInventory),
  variations: z.array(variation).min(2).max(30),
}).strict();
const product = z.union([simpleProduct, variableProduct]);
const bundleSchema = z.object({
  schema: z.literal("enki-product-draft-bundle/v1"),
  bundleKey: slug,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAt: z.string().datetime({offset: true}),
  sourceSnapshot: z.object({
    brandSlug: slug,
    catalog: z.object({logicalName: z.string().min(1).max(200), capturedAt: z.string().datetime({offset: true}), sha256}).strict(),
    wooExport: z.object({logicalName: z.string().min(1).max(200), capturedAt: z.string().datetime({offset: true}), sha256}).strict(),
    officialDomains: z.array(z.string().min(1).max(253)).min(1).max(3),
    webPages: z.array(z.object({url: officialUrl, capturedAt: z.string().datetime({offset: true}), sha256}).strict()).max(50),
  }).strict(),
  mediaProfile: z.object({profileKey: slug, sha256}).strict(),
  review: z.object({
    status: z.literal("ready_for_board_review"),
    externalMutationAuthority: z.literal("paperclip_exact_approval_only"),
    brandGuardian: z.enum(["PASS", "WARN"]),
    catalogueQa: z.enum(["PASS", "PARTIAL"]),
  }).strict(),
  products: z.array(product).min(1).max(5),
}).strict();

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function uint24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function inspectWebp(bytes) {
  if (bytes.length < 20
    || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error("invalid RIFF/WebP header");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("WebP RIFF size does not match the file bytes");
  const chunks = [];
  let width = null;
  let height = null;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("truncated WebP chunk header");
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error(`truncated WebP ${type} chunk`);
    const payload = bytes.subarray(dataStart, dataEnd);
    chunks.push(type);
    if (type === "VP8X") {
      if (size !== 10) throw new Error("invalid WebP VP8X chunk");
      width = uint24le(payload, 4) + 1;
      height = uint24le(payload, 7) + 1;
    } else if (type === "VP8 ") {
      if (size < 10 || payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) {
        throw new Error("invalid WebP VP8 frame header");
      }
      width = payload.readUInt16LE(6) & 0x3fff;
      height = payload.readUInt16LE(8) & 0x3fff;
    } else if (type === "VP8L") {
      if (size < 5 || payload[0] !== 0x2f) throw new Error("invalid WebP VP8L frame header");
      const bits = payload.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    offset = dataEnd + (size % 2);
  }
  if (offset !== bytes.length || !width || !height) throw new Error("WebP dimensions are missing or invalid");
  const forbidden = chunks.filter((type) => ["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"].includes(type));
  if (forbidden.length > 0) throw new Error(`WebP contains forbidden metadata or animation chunks: ${forbidden.join(", ")}`);
  return {width, height, chunks};
}

export function isValidGtin(value) {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value || "")) return false;
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function contains(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Product bundle has duplicate ${label}`);
}

export class ProductBundleRepository {
  constructor(root, {maxMediaBytes = 15_000_000} = {}) {
    this.root = root ? resolve(root) : null;
    this.maxMediaBytes = maxMediaBytes;
  }

  async load() {
    if (!this.root) throw new Error("Product draft bundle is not configured");
    const rootStats = await lstat(this.root).catch(() => null);
    if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) throw new Error("Product draft bundle root must be a regular directory");
    const mediaDirectory = join(this.root, "media");
    const mediaDirectoryStats = await lstat(mediaDirectory).catch(() => null);
    if (!mediaDirectoryStats?.isDirectory() || mediaDirectoryStats.isSymbolicLink()) throw new Error("Product draft media directory must be a regular directory");
    const manifestPath = join(this.root, "product-draft-bundle.json");
    const manifestStats = await lstat(manifestPath).catch(() => null);
    if (!manifestStats?.isFile() || manifestStats.isSymbolicLink() || manifestStats.size > 1_000_000) throw new Error("Product draft bundle manifest is missing or unsafe");
    const bytes = await readFile(manifestPath);
    let parsed;
    try {
      parsed = bundleSchema.parse(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      throw new Error(`Product draft bundle is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
    }
    assertUnique(parsed.products.map((entry) => entry.productKey), "productKey");
    assertUnique(parsed.products.map((entry) => entry.slug), "slug");
    assertUnique(parsed.products.flatMap((entry) => [
      entry.sku,
      ...(entry.type === "variable" ? entry.variations.map((item) => item.sku) : []),
    ]), "SKU");
    const officialDomains = parsed.sourceSnapshot.officialDomains.map((entry) => entry.toLowerCase());
    const isOfficial = (raw) => {
      const hostname = new URL(raw).hostname.toLowerCase();
      return officialDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    };
    if (parsed.sourceSnapshot.webPages.some((entry) => !isOfficial(entry.url))) throw new Error("Product bundle contains a web page outside the approved official domains");
    for (const entry of parsed.products) {
      if (entry.gtin && !isValidGtin(entry.gtin)) throw new Error(`Product ${entry.productKey} has an invalid GTIN check digit`);
      assertUnique(entry.images.map((item) => item.position), `image position for ${entry.productKey}`);
      const evidenceKeys = new Set(entry.evidence.map((item) => item.evidenceKey));
      if (entry.commerce.priceEvidenceKey && !evidenceKeys.has(entry.commerce.priceEvidenceKey)) throw new Error(`Product ${entry.productKey} price evidence is missing`);
      if (entry.commerce.salePriceEvidenceKey && !evidenceKeys.has(entry.commerce.salePriceEvidenceKey)) throw new Error(`Product ${entry.productKey} sale-price evidence is missing`);
      if (entry.type === "variable") {
        const variationAttributes = entry.attributes.filter((item) => item.variation);
        if (variationAttributes.length === 0) throw new Error(`Variable product ${entry.productKey} needs at least one variation attribute`);
        assertUnique(entry.variations.map((item) => item.variationKey), `variationKey for ${entry.productKey}`);
        const expectedAttributeIds = variationAttributes.map((item) => item.id).sort((left, right) => left - right);
        const usedOptions = new Map(variationAttributes.map((item) => [item.id, new Set()]));
        const imagePositions = new Set(entry.images.map((item) => item.position));
        for (const child of entry.variations) {
          if (child.gtin && !isValidGtin(child.gtin)) throw new Error(`Variation ${child.variationKey} has an invalid GTIN check digit`);
          assertUnique(child.attributes.map((item) => item.id), `variation attribute for ${child.variationKey}`);
          const actualAttributeIds = child.attributes.map((item) => item.id).sort((left, right) => left - right);
          if (JSON.stringify(actualAttributeIds) !== JSON.stringify(expectedAttributeIds)) throw new Error(`Variation ${child.variationKey} does not cover the exact parent variation attributes`);
          for (const childAttribute of child.attributes) {
            const parentAttribute = variationAttributes.find((item) => item.id === childAttribute.id);
            if (!parentAttribute?.options.includes(childAttribute.option)) throw new Error(`Variation ${child.variationKey} uses an option absent from the parent attribute`);
            usedOptions.get(childAttribute.id).add(childAttribute.option);
          }
          if (child.imagePosition !== undefined && !imagePositions.has(child.imagePosition)) throw new Error(`Variation ${child.variationKey} references an unknown image position`);
          const childEvidenceKeys = new Set(child.evidence.map((item) => item.evidenceKey));
          if (!childEvidenceKeys.has(child.commerce.priceEvidenceKey)) throw new Error(`Variation ${child.variationKey} price evidence is missing`);
          if (child.commerce.salePriceEvidenceKey && !childEvidenceKeys.has(child.commerce.salePriceEvidenceKey)) throw new Error(`Variation ${child.variationKey} sale-price evidence is missing`);
        }
        for (const parentAttribute of variationAttributes) {
          if (parentAttribute.options.some((option) => !usedOptions.get(parentAttribute.id).has(option))) throw new Error(`Variable product ${entry.productKey} has an unused variation option`);
        }
      }
      for (const media of entry.images) {
        if (!isOfficial(media.sourceUrl)) throw new Error(`Product media source is outside the approved official domains: ${media.path}`);
        const path = resolve(this.root, media.path);
        if (!contains(mediaDirectory, path) || dirname(path) !== mediaDirectory) throw new Error("Product media path escapes the approved media directory");
        const stats = await lstat(path).catch(() => null);
        if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > this.maxMediaBytes) throw new Error(`Product media is missing or unsafe: ${media.path}`);
        const mediaBytes = await readFile(path);
        if (digest(mediaBytes) !== media.sha256) throw new Error(`Product media bytes do not match the reviewed WebP: ${media.path}`);
        let inspected;
        try {
          inspected = inspectWebp(mediaBytes);
        } catch (error) {
          throw new Error(`Product media is not a safe static WebP (${media.path}): ${error instanceof Error ? error.message : "inspection failed"}`);
        }
        if (inspected.width !== media.width || inspected.height !== media.height) {
          throw new Error(`Product media dimensions differ from the reviewed manifest: ${media.path}`);
        }
      }
    }
    return {bundle: parsed, sha256: digest(bytes), manifestPath};
  }

  async list() {
    const {bundle, sha256: bundleSha256} = await this.load();
    return {
      bundle_key: bundle.bundleKey,
      bundle_sha256: bundleSha256,
      brand_slug: bundle.sourceSnapshot.brandSlug,
      review: bundle.review,
      products: bundle.products.map((entry) => ({
        product_key: entry.productKey,
        name: entry.name,
        sku: entry.sku,
        slug: entry.slug,
        type: entry.type,
        variation_count: entry.type === "variable" ? entry.variations.length : 0,
        image_count: entry.images.length,
        catalogue_qa: bundle.review.catalogueQa,
        brand_guardian: bundle.review.brandGuardian,
      })),
    };
  }

  async get(productKey, expectedBundleSha256 = null) {
    const loaded = await this.load();
    if (expectedBundleSha256 && loaded.sha256 !== expectedBundleSha256) throw new Error("Product bundle SHA-256 differs from the reviewed approval");
    const productValue = loaded.bundle.products.find((entry) => entry.productKey === productKey);
    if (!productValue) throw new Error(`Unknown productKey: ${productKey}`);
    return {bundle: loaded.bundle, bundleSha256: loaded.sha256, product: productValue, root: this.root};
  }
}

export {bundleSchema};
