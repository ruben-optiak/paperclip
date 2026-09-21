import assert from "node:assert/strict";
import test from "node:test";
import {createToolDefinitions} from "../src/tools.mjs";

function definitions(overrides = {}) {
  return createToolDefinitions({
    config: {writeMode: "disabled", productWriteMode: "disabled", productBundleRoot: null, productPublisher: null, wordpress: null, meta: null},
    wordpress: null,
    meta: null,
    productBundle: null,
    productMedia: null,
    woocommerce: null,
    ledger: {execute: async (_input, effect, options = {}) => { if (options.preflight) await options.preflight(); return effect(); }},
    ...overrides,
  });
}

test("publishes the exact reviewed read and ask-first write catalog", () => {
  const tools = definitions();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "publisher_get_capabilities",
    "woocommerce_list_product_drafts",
    "woocommerce_get_product_draft",
    "woocommerce_create_product_draft",
    "wordpress_list_posts",
    "wordpress_get_article",
    "wordpress_upsert_post",
    "facebook_list_page_posts",
    "facebook_publish_page_post",
    "instagram_list_media",
    "instagram_get_publishing_limit",
    "instagram_publish_image",
  ]);
  const writes = tools.filter((tool) => tool.annotations.readOnlyHint === false);
  assert.deepEqual(writes.map((tool) => tool.name), ["woocommerce_create_product_draft", "wordpress_upsert_post", "facebook_publish_page_post", "instagram_publish_image"]);
  assert.equal(writes.every((tool) => tool.annotations.idempotentHint === true && tool.annotations.destructiveHint === false), true);
});

test("product kill switch rejects a draft before reading the bundle", async () => {
  let calls = 0;
  const tool = definitions({
    productBundle: {get: async () => { calls += 1; }},
  }).find((entry) => entry.name === "woocommerce_create_product_draft");
  const response = await tool.execute({
    idempotency_key: "ENK-200:product:1",
    bundle_sha256: "a".repeat(64),
    product_key: "fixture-product",
    issue_identifier: "ENK-200",
    document_key: "approved-product-draft",
    revision_id: "revision-1",
  });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /kill switch/);
  assert.equal(calls, 0);
});

test("approved product tool uploads exact media and verifies the created draft", async () => {
  const calls = [];
  const product = {
    productKey: "fixture-product",
    type: "simple",
    name: "Fixture Product",
    slug: "fixture-product",
    sku: "FIX-1",
    manufacturerReference: "REF-1",
    descriptionHtml: "<p>Body</p>",
    shortDescriptionHtml: "<p>Short</p>",
    categories: [12],
    tags: [31],
    attributes: [{id: 4, options: ["White"], visible: true, variation: false}],
    seo: {title: "SEO title", description: "SEO description", focusKeyword: "fixture"},
    commerce: {manageStock: false, stockStatus: "outofstock"},
    images: [{path: "media/fixture.webp", sha256: "b".repeat(64), alt: "Fixture", position: 0}],
  };
  const tool = definitions({
    config: {
      writeMode: "disabled",
      productWriteMode: "woo-drafts",
      productBundleRoot: "/bundle",
      productPublisher: {baseUrl: "https://shop.example.invalid"},
      wordpress: null,
      meta: null,
    },
    productBundle: {get: async () => ({bundleSha256: "a".repeat(64), bundle: {sourceSnapshot: {brandSlug: "sanycces"}}, product, root: "/bundle"})},
    productMedia: {uploadWebp: async (path, input) => { calls.push({kind: "media", path, input}); return {id: 91, name: "Fixture Product", alt: "Fixture"}; }},
    woocommerce: {
      findBySku: async () => null,
      resolveBrandBySlug: async () => ({id: 1410, name: "Sanycces", slug: "sanycces"}),
      createDraft: async (_product, images, approval) => { calls.push({kind: "create", images, approval}); return {external_id: "44"}; },
      getProduct: async () => ({
        external_id: "44",
        status: "draft",
        type: "simple",
        name: "Fixture Product",
        slug: "fixture-product",
        sku: "FIX-1",
        global_unique_id: "",
        catalog_visibility: "hidden",
        description_html: "<p>Body</p>",
        short_description_html: "<p>Short</p>",
        category_ids: [12],
        brand_ids: [1410],
        tag_ids: [31],
        attributes: [{id: 4, options: ["White"], visible: true, variation: false}],
        regular_price: "",
        sale_price: "",
        manage_stock: false,
        stock_status: "outofstock",
        image_ids: [91],
        review_meta: {
          _yoast_wpseo_title: "SEO title",
          _yoast_wpseo_metadesc: "SEO description",
          _yoast_wpseo_focuskw: "fixture",
          _enki_manufacturer_reference: "REF-1",
          _enki_product_bundle_sha256: "a".repeat(64),
          _enki_paperclip_issue: "ENK-200",
          _enki_approval_document: "approved-product-draft",
          _enki_approval_revision: "revision-1",
        },
      }),
    },
  }).find((entry) => entry.name === "woocommerce_create_product_draft");
  const response = await tool.execute({
    idempotency_key: "ENK-200:product:1",
    bundle_sha256: "a".repeat(64),
    product_key: "fixture-product",
    issue_identifier: "ENK-200",
    document_key: "approved-product-draft",
    revision_id: "revision-1",
  });
  assert.equal(response.isError, undefined);
  assert.equal(calls[0].input.expectedSha256, "b".repeat(64));
  assert.equal(calls[1].approval.issueIdentifier, "ENK-200");
});

test("approved variable draft preflights every SKU and verifies every child", async () => {
  const preflightSkus = [];
  const product = {
    productKey: "fixture-variable",
    type: "variable",
    name: "Fixture Variable",
    slug: "fixture-variable",
    sku: "FIX-PARENT",
    manufacturerReference: "FIX-PARENT",
    descriptionHtml: "<p>Body</p>",
    shortDescriptionHtml: "<p>Short</p>",
    categories: [12],
    tags: [31],
    attributes: [{id: 4, options: ["NB", "RM"], visible: true, variation: true}],
    seo: {title: "SEO title", description: "SEO description", focusKeyword: "fixture"},
    commerce: {manageStock: false, stockStatus: "instock"},
    images: [{path: "media/fixture.webp", sha256: "b".repeat(64), alt: "Fixture", position: 0}],
    variations: [
      {
        variationKey: "fixture-variable-nb",
        status: "private",
        sku: "FIX-NB",
        manufacturerReference: "FIX-NB",
        attributes: [{id: 4, option: "NB"}],
        imagePosition: 0,
        commerce: {regularPrice: "121.00", salePrice: "102.85", manageStock: false, stockStatus: "outofstock"},
      },
      {
        variationKey: "fixture-variable-rm",
        status: "private",
        sku: "FIX-RM",
        manufacturerReference: "FIX-RM",
        attributes: [{id: 4, option: "RM"}],
        imagePosition: 0,
        commerce: {regularPrice: "242.00", salePrice: "205.70", manageStock: false, stockStatus: "outofstock"},
      },
    ],
  };
  const reviewMeta = (reference) => ({
    _enki_manufacturer_reference: reference,
    _enki_product_bundle_sha256: "a".repeat(64),
    _enki_paperclip_issue: "ENK-201",
    _enki_approval_document: "approved-variable-draft",
    _enki_approval_revision: "revision-1",
  });
  const tool = definitions({
    config: {
      writeMode: "disabled",
      productWriteMode: "woo-drafts",
      productBundleRoot: "/bundle",
      productPublisher: {baseUrl: "https://shop.example.invalid"},
      wordpress: null,
      meta: null,
    },
    productBundle: {get: async () => ({bundleSha256: "a".repeat(64), bundle: {sourceSnapshot: {brandSlug: "sanycces"}}, product, root: "/bundle"})},
    productMedia: {uploadWebp: async () => ({id: 91, name: "Fixture Variable", alt: "Fixture"})},
    woocommerce: {
      findBySku: async (sku) => { preflightSkus.push(sku); return null; },
      resolveBrandBySlug: async () => ({id: 1410, name: "Sanycces", slug: "sanycces"}),
      createDraft: async () => ({external_id: "44", variations: [{external_id: "45"}, {external_id: "46"}]}),
      getProduct: async () => ({
        external_id: "44",
        status: "draft",
        type: "variable",
        name: "Fixture Variable",
        slug: "fixture-variable",
        sku: "FIX-PARENT",
        global_unique_id: "",
        catalog_visibility: "hidden",
        description_html: "<p>Body</p>\n",
        short_description_html: "<p>Short</p>\n",
        category_ids: [12],
        brand_ids: [1410],
        tag_ids: [31],
        attributes: [{id: 4, options: ["RM", "NB"], visible: true, variation: true}],
        regular_price: "",
        sale_price: "",
        manage_stock: false,
        stock_status: "outofstock",
        image_ids: [91],
        review_meta: {
          _yoast_wpseo_title: "SEO title",
          _yoast_wpseo_metadesc: "SEO description",
          _yoast_wpseo_focuskw: "fixture",
          ...reviewMeta("FIX-PARENT"),
        },
      }),
      getVariation: async (_parentId, variationId) => {
        const child = variationId === "45" ? product.variations[0] : product.variations[1];
        return {
          external_id: variationId,
          status: "private",
          sku: child.sku,
          global_unique_id: "",
          regular_price: child.commerce.regularPrice,
          sale_price: child.commerce.salePrice,
          manage_stock: false,
          stock_status: "outofstock",
          image_id: 91,
          attributes: child.attributes,
          review_meta: reviewMeta(child.manufacturerReference),
        };
      },
    },
  }).find((entry) => entry.name === "woocommerce_create_product_draft");
  const response = await tool.execute({
    idempotency_key: "ENK-201:product:1",
    bundle_sha256: "a".repeat(64),
    product_key: "fixture-variable",
    issue_identifier: "ENK-201",
    document_key: "approved-variable-draft",
    revision_id: "revision-1",
  });
  assert.equal(response.isError, undefined, response.content[0].text);
  assert.deepEqual(preflightSkus, ["FIX-PARENT", "FIX-NB", "FIX-RM"]);
  const value = JSON.parse(response.content[0].text);
  assert.deepEqual(value.variation_external_ids, ["45", "46"]);
});

test("kill switch rejects a write before provider or journal execution", async () => {
  let calls = 0;
  const tool = definitions({
    wordpress: {upsertPost: async () => { calls += 1; }},
    ledger: {execute: async (_input, effect) => { calls += 1; return effect(); }},
  }).find((entry) => entry.name === "wordpress_upsert_post");
  const response = await tool.execute({
    idempotency_key: "issue-1:revision-1",
    title: "Fixture",
    slug: "fixture",
    content_html: "<p>Fixture</p>",
    status: "draft",
  });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /kill switch/);
  assert.equal(calls, 0);
});

test("approved mode sends the exact reviewed arguments through the journal", async () => {
  const effects = [];
  const requests = [];
  const tool = definitions({
    config: {
      writeMode: "approved",
      wordpress: {baseUrl: "https://shop.example.invalid"},
      meta: null,
    },
    wordpress: {upsertPost: async (input) => { effects.push(input); return {external_id: "12", status: "draft"}; }},
    ledger: {execute: async (input, effect) => { requests.push(input); return effect(); }},
  }).find((entry) => entry.name === "wordpress_upsert_post");
  const response = await tool.execute({
    idempotency_key: "ENK-100:content-draft:7",
    title: "Fixture",
    slug: "fixture",
    content_html: "<p>Fixture</p>",
    status: "draft",
  });
  assert.equal(response.isError, undefined);
  assert.equal(requests[0].provider, "wordpress");
  assert.equal(requests[0].operation, "upsert_post");
  assert.equal(effects[0].create_missing_terms, false);
});
