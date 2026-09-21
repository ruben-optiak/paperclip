import {z} from "zod";
import {join} from "node:path";
import {assertProductWriteAllowed, assertWriteAllowed} from "./config.mjs";

const idempotencyKey = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits, dot, colon, underscore, or hyphen");
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL");
const term = z.union([z.number().int().positive(), z.string().trim().min(1).max(100)]);
const wordpressStatus = z.enum(["draft", "pending", "future", "publish"]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const slug = z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function result(value) {
  return {content: [{type: "text", text: JSON.stringify(value, null, 2)}]};
}

function safeMessage(error) {
  if (error instanceof z.ZodError) {
    return `Invalid input: ${error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ")}`;
  }
  const message = error instanceof Error ? error.message : "Connector operation failed";
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]")
    .replace(/\b(?:EA[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]");
}

function failure(error) {
  return {isError: true, content: [{type: "text", text: safeMessage(error)}]};
}

function tool(name, description, schema, execute, {readOnly, idempotent = false}) {
  return {
    name,
    description,
    schema,
    annotations: {
      title: description,
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: idempotent,
      openWorldHint: true,
    },
    execute: async (input) => {
      try {
        return result(await execute(schema.parse(input)));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function readTool(name, description, schema, execute) {
  return tool(name, description, schema, execute, {readOnly: true});
}

function writeTool(name, description, schema, execute) {
  return tool(name, description, schema, execute, {readOnly: false, idempotent: true});
}

function requireClient(client, label) {
  if (!client) throw new Error(`${label} is not configured`);
  return client;
}

function sameValues(left, right) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function normalizedHtml(value) {
  return String(value).trim().replace(/>\s+</g, "><");
}

function normalizedAttributes(value) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => ({
    ...item,
    ...(Array.isArray(item?.options) ? {options: [...item.options].sort((left, right) => left.localeCompare(right, "es"))} : {}),
  })).sort((left, right) => Number(left?.id) - Number(right?.id));
}

function sameReadbackField(key, left, right) {
  if (key === "description_html" || key === "short_description_html") {
    return normalizedHtml(left) === normalizedHtml(right);
  }
  if (key === "attributes") return sameValues(normalizedAttributes(left), normalizedAttributes(right));
  return sameValues(left, right);
}

function expectedProductReadback(product, images, input, brandId) {
  return {
    status: "draft",
    type: product.type,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    global_unique_id: product.gtin ?? "",
    catalog_visibility: "hidden",
    description_html: product.descriptionHtml,
    short_description_html: product.shortDescriptionHtml,
    category_ids: [...product.categories].sort((left, right) => left - right),
    brand_ids: [brandId],
    tag_ids: [...product.tags].sort((left, right) => left - right),
    attributes: [...product.attributes].sort((left, right) => left.id - right.id),
    regular_price: product.commerce.regularPrice ?? "",
    sale_price: product.commerce.salePrice ?? "",
    manage_stock: product.commerce.manageStock,
    ...(product.commerce.stockQuantity === undefined ? {} : {stock_quantity: product.commerce.stockQuantity}),
    stock_status: product.type === "variable" ? "outofstock" : product.commerce.stockStatus,
    image_ids: images.filter((image) => image.gallery !== false).map((image) => image.id),
    review_meta: {
      _yoast_wpseo_title: product.seo.title,
      _yoast_wpseo_metadesc: product.seo.description,
      _yoast_wpseo_focuskw: product.seo.focusKeyword,
      _enki_manufacturer_reference: product.manufacturerReference,
      _enki_product_bundle_sha256: input.bundle_sha256,
      _enki_paperclip_issue: input.issue_identifier,
      _enki_approval_document: input.document_key,
      _enki_approval_revision: input.revision_id,
    },
  };
}

function expectedVariationReadback(variation, images, input) {
  const image = variation.imagePosition === undefined
    ? null
    : images.find((item) => item.position === variation.imagePosition);
  return {
    status: "private",
    sku: variation.sku,
    global_unique_id: variation.gtin ?? "",
    regular_price: variation.commerce.regularPrice,
    sale_price: variation.commerce.salePrice ?? "",
    manage_stock: variation.commerce.manageStock,
    ...(variation.commerce.stockQuantity === undefined ? {} : {stock_quantity: variation.commerce.stockQuantity}),
    stock_status: variation.commerce.stockStatus,
    image_id: image?.id ?? null,
    attributes: [...variation.attributes].sort((left, right) => left.id - right.id),
    review_meta: {
      _enki_manufacturer_reference: variation.manufacturerReference,
      _enki_product_bundle_sha256: input.bundle_sha256,
      _enki_paperclip_issue: input.issue_identifier,
      _enki_approval_document: input.document_key,
      _enki_approval_revision: input.revision_id,
    },
  };
}

export function createToolDefinitions({config, wordpress, meta, productBundle, productMedia, woocommerce, ledger}) {
  return [
    readTool(
      "publisher_get_capabilities",
      "Report configured publication providers and the connector kill-switch mode without exposing credentials or account IDs.",
      z.object({}),
      async () => ({
        write_mode: config.writeMode,
        product_write_mode: config.productWriteMode ?? "disabled",
        providers: {
          wordpress: {configured: Boolean(config.wordpress)},
          facebook: {configured: Boolean(config.meta?.facebookPageId)},
          instagram: {configured: Boolean(config.meta?.instagramUserId)},
          product_bundle: {configured: Boolean(config.productBundleRoot)},
          woocommerce_product_drafts: {configured: Boolean(config.productPublisher)},
        },
      }),
    ),
    readTool(
      "woocommerce_list_product_drafts",
      "List the reviewed products in the mounted offline draft bundle without reading WooCommerce customer or order data.",
      z.object({}),
      async () => requireClient(productBundle, "Product draft bundle").list(),
    ),
    readTool(
      "woocommerce_get_product_draft",
      "Read one reviewed offline WooCommerce product draft by stable product key.",
      z.object({product_key: slug}),
      async ({product_key}) => {
        const loaded = await requireClient(productBundle, "Product draft bundle").get(product_key);
        return {bundle_sha256: loaded.bundleSha256, review: loaded.bundle.review, product: loaded.product};
      },
    ),
    writeTool(
      "woocommerce_create_product_draft",
      "Upload the exact reviewed WebP media and create one simple or variable hidden WooCommerce draft. Paperclip must require exact human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        bundle_sha256: sha256,
        product_key: slug,
        issue_identifier: z.string().trim().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_-]*-[0-9]+$/),
        document_key: slug,
        revision_id: z.string().trim().min(1).max(200),
      }),
      async (input) => {
        assertProductWriteAllowed(config);
        const repository = requireClient(productBundle, "Product draft bundle");
        const mediaClient = requireClient(productMedia, "WordPress product media");
        const wooClient = requireClient(woocommerce, "WooCommerce product publishing");
        const loaded = await repository.get(input.product_key, input.bundle_sha256);
        const journalRequest = {
          bundle_sha256: input.bundle_sha256,
          product_key: input.product_key,
          issue_identifier: input.issue_identifier,
          document_key: input.document_key,
          revision_id: input.revision_id,
        };
        let resolvedBrand = null;
        return ledger.execute({
          provider: "woocommerce",
          operation: "create_product_draft",
          idempotencyKey: input.idempotency_key,
          request: journalRequest,
        }, async () => {
          const images = [];
          for (const media of [...loaded.product.images].sort((left, right) => left.position - right.position)) {
            const uploaded = await mediaClient.uploadWebp(join(loaded.root, media.path), {
              alt: media.alt,
              title: loaded.product.name,
              expectedSha256: media.sha256,
            });
            images.push({...uploaded, position: media.position, gallery: media.gallery});
          }
          if (!resolvedBrand) throw new Error("WooCommerce brand preflight did not complete");
          const created = await wooClient.createDraft(loaded.product, images, {
            bundleSha256: input.bundle_sha256,
            issueIdentifier: input.issue_identifier,
            documentKey: input.document_key,
            revisionId: input.revision_id,
          }, {brandId: resolvedBrand.id});
          if (!created.external_id) throw new Error("WooCommerce did not return a product ID");
          const verified = await wooClient.getProduct(created.external_id);
          const expected = expectedProductReadback(loaded.product, images, input, resolvedBrand.id);
          if (!Object.entries(expected).every(([key, value]) => sameReadbackField(key, verified[key], value))) {
            throw new Error("WooCommerce product read-back did not match the approved draft");
          }
          const variationExternalIds = [];
          if (loaded.product.type === "variable") {
            if (!Array.isArray(created.variations) || created.variations.length !== loaded.product.variations.length) {
              throw new Error("WooCommerce did not return every created variation ID");
            }
            for (let index = 0; index < loaded.product.variations.length; index += 1) {
              const createdVariation = created.variations[index];
              if (!createdVariation.external_id) throw new Error("WooCommerce did not return a variation ID");
              const variationReadback = await wooClient.getVariation(created.external_id, createdVariation.external_id);
              const expectedVariation = expectedVariationReadback(loaded.product.variations[index], images, input);
              if (!Object.entries(expectedVariation).every(([key, value]) => sameReadbackField(key, variationReadback[key], value))) {
                throw new Error("WooCommerce variation read-back did not match the approved draft");
              }
              variationExternalIds.push(createdVariation.external_id);
            }
          }
          return {
            ...verified,
            provider: "woocommerce",
            operation: "created",
            uploaded_media_ids: images.map((image) => image.id),
            variation_external_ids: variationExternalIds,
          };
        }, {preflight: async () => {
          resolvedBrand = await wooClient.resolveBrandBySlug(loaded.bundle.sourceSnapshot.brandSlug);
          const skus = [
            loaded.product.sku,
            ...(loaded.product.type === "variable"
              ? loaded.product.variations.map((variation) => variation.sku)
              : []),
          ];
          for (const skuValue of skus) {
            const collision = await wooClient.findBySku(skuValue);
            if (collision) throw new Error(`WooCommerce SKU already exists: ${skuValue}`);
          }
        }});
      },
    ),
    readTool(
      "wordpress_list_posts",
      "List a bounded WordPress post index for editorial memory; returns no users, credentials, comments, or customer data.",
      z.object({
        status: z.enum(["publish", "future", "draft", "pending", "private"]).default("publish"),
        page: z.number().int().min(1).max(100).default(1),
        per_page: z.number().int().min(1).max(100).default(20),
      }),
      async (input) => requireClient(wordpress, "WordPress").listPosts({status: input.status, page: input.page, perPage: input.per_page}),
    ),
    readTool(
      "wordpress_get_article",
      "Read one WordPress blog article and its rendered content by numeric post ID for comparison or review.",
      z.object({post_id: z.number().int().positive()}),
      async ({post_id}) => requireClient(wordpress, "WordPress").getPost(post_id),
    ),
    writeTool(
      "wordpress_upsert_post",
      "Create or update one WordPress post by ID or stable slug. Paperclip must require human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        post_id: z.number().int().positive().optional(),
        title: z.string().trim().min(1).max(300),
        slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        excerpt: z.string().max(2_000).default(""),
        content_html: z.string().min(1).max(500_000),
        status: wordpressStatus.default("draft"),
        date: z.string().datetime({offset: true}).optional(),
        categories: z.array(term).max(30).default([]),
        tags: z.array(term).max(50).default([]),
        create_missing_terms: z.boolean().default(false),
        featured_media: z.number().int().positive().optional(),
        seo_description: z.string().trim().max(500).optional(),
      }).superRefine((input, context) => {
        if (input.status === "future" && !input.date) context.addIssue({code: "custom", path: ["date"], message: "Scheduled posts require an explicit offset-aware date"});
        if (input.status !== "future" && input.date) context.addIssue({code: "custom", path: ["date"], message: "date is accepted only for status future"});
      }),
      async (input) => {
        assertWriteAllowed(config, "wordpress", input.status);
        const client = requireClient(wordpress, "WordPress");
        return ledger.execute({
          provider: "wordpress",
          operation: "upsert_post",
          idempotencyKey: input.idempotency_key,
          request: input,
        }, () => client.upsertPost(input));
      },
    ),
    readTool(
      "facebook_list_page_posts",
      "List bounded posts published by the configured Facebook Page for editorial memory.",
      z.object({limit: z.number().int().min(1).max(100).default(20)}),
      async (input) => requireClient(meta, "Meta").listFacebookPosts(input),
    ),
    writeTool(
      "facebook_publish_page_post",
      "Publish one text/link post to the configured Facebook Page. Paperclip must require human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        message: z.string().trim().min(1).max(63_206),
        link: httpsUrl.optional(),
      }),
      async (input) => {
        assertWriteAllowed(config, "facebook");
        const client = requireClient(meta, "Meta");
        return ledger.execute({
          provider: "facebook",
          operation: "publish_page_post",
          idempotencyKey: input.idempotency_key,
          request: input,
        }, () => client.publishFacebookPost(input));
      },
    ),
    readTool(
      "instagram_list_media",
      "List bounded media published by the configured Instagram professional account for editorial memory.",
      z.object({limit: z.number().int().min(1).max(100).default(20)}),
      async (input) => requireClient(meta, "Meta").listInstagramMedia(input),
    ),
    readTool(
      "instagram_get_publishing_limit",
      "Read current Instagram API publishing quota usage without publishing content.",
      z.object({}),
      async () => requireClient(meta, "Meta").instagramPublishingLimit(),
    ),
    writeTool(
      "instagram_publish_image",
      "Publish one JPEG image from a public HTTPS URL to the configured Instagram professional account. Paperclip must require human approval for every call.",
      z.object({
        idempotency_key: idempotencyKey,
        image_url: httpsUrl,
        caption: z.string().trim().min(1).max(2_200),
        alt_text: z.string().trim().min(1).max(1_000),
      }),
      async (input) => {
        assertWriteAllowed(config, "instagram");
        const client = requireClient(meta, "Meta");
        return ledger.execute({
          provider: "instagram",
          operation: "publish_image",
          idempotencyKey: input.idempotency_key,
          request: input,
        }, () => client.publishInstagramImage(input));
      },
    ),
  ];
}
