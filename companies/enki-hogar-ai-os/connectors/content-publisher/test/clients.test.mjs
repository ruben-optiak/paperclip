import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {MetaClient, WooCommerceProductClient, WordPressClient, WordPressMediaClient} from "../src/clients.mjs";

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json", ...headers}});
}

test("WordPress reads and upserts by slug without putting credentials in URLs", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://shop.example.invalid",
    username: "publisher-user",
    appPassword: "secret-app-password",
  }, {fetch: async (url, options) => {
    calls.push({url: String(url), options});
    if (options.method === "GET" && url.pathname.endsWith("/posts") && url.searchParams.get("slug")) {
      return response(200, url.searchParams.get("status") === "draft" ? [{id: 42, slug: "fixture"}] : []);
    }
    if (options.method === "GET" && /\/(categories|tags)$/.test(url.pathname)) return response(200, []);
    if (options.method === "POST" && url.pathname.endsWith("/posts/42")) {
      return response(200, {id: 42, status: "draft", slug: "fixture", link: "https://shop.example.invalid/fixture", date_gmt: null});
    }
    return response(500, {});
  }});

  const result = await client.upsertPost({
    title: "Fixture",
    slug: "fixture",
    excerpt: "Summary",
    content_html: "<p>Body</p>",
    status: "draft",
    categories: [],
    tags: [],
    create_missing_terms: false,
  });
  assert.equal(result.operation, "updated");
  assert.equal(result.external_id, "42");
  assert.equal(calls.every((entry) => !entry.url.includes("publisher-user") && !entry.url.includes("secret-app-password")), true);
  assert.equal(calls.every((entry) => /^Basic /.test(entry.options.headers.authorization)), true);
  const write = calls.find((entry) => entry.options.method === "POST");
  assert.deepEqual(JSON.parse(write.options.body), {
    title: "Fixture",
    content: "<p>Body</p>",
    excerpt: "Summary",
    slug: "fixture",
    status: "draft",
    categories: [],
    tags: [],
  });
});

test("WordPress lists public history with view context and non-public states with edit context", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://shop.example.invalid",
    username: "publisher-user",
    appPassword: "secret-app-password",
  }, {fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    return response(200, url.searchParams.get("context") === "view" ? [{
      id: 42,
      status: "publish",
      slug: "existing-article",
      title: {rendered: "Existing article"},
      excerpt: {rendered: "Existing summary"},
    }] : []);
  }});

  const published = await client.listPosts({status: "publish", page: 1, perPage: 20});
  const drafts = await client.listPosts({status: "draft", page: 1, perPage: 20});

  assert.equal(published.posts.length, 1);
  assert.equal(published.posts[0].slug, "existing-article");
  assert.deepEqual(drafts.posts, []);
  assert.equal(calls[0].url.searchParams.get("context"), "view");
  assert.equal(calls[1].url.searchParams.get("context"), "edit");
});

test("WordPress reads published articles with view context", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://shop.example.invalid",
    username: "publisher-user",
    appPassword: "secret-app-password",
  }, {fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    return response(200, {
      id: 42,
      status: "publish",
      slug: "existing-article",
      title: {rendered: "Existing article"},
      content: {rendered: "<p>Existing body</p>"},
    });
  }});

  const article = await client.getPost(42);

  assert.equal(article.content_html, "<p>Existing body</p>");
  assert.equal(calls[0].url.searchParams.get("context"), "view");
});

test("WordPress slug lookup sees public posts across authors without widening draft access", async () => {
  const calls = [];
  const client = new WordPressClient({
    baseUrl: "https://shop.example.invalid",
    username: "publisher-user",
    appPassword: "secret-app-password",
  }, {fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    const isPublishedView = url.searchParams.get("status") === "publish"
      && url.searchParams.get("context") === "view";
    return response(200, isPublishedView ? [{id: 42, slug: "existing-article"}] : []);
  }});

  const existing = await client.findPostBySlug("existing-article");

  assert.equal(existing.id, 42);
  assert.equal(calls.find((entry) => entry.url.searchParams.get("status") === "publish").url.searchParams.get("context"), "view");
  assert.equal(calls.filter((entry) => entry.url.searchParams.get("status") !== "publish").every((entry) => entry.url.searchParams.get("context") === "edit"), true);
});

test("provider errors never copy response bodies or tokens into messages", async () => {
  const client = new WordPressClient({baseUrl: "https://shop.example.invalid", username: "publisher", appPassword: "secret"}, {
    fetch: async () => response(403, {message: "backend leaked token EA-really-secret"}, {"x-request-id": "request-7"}),
  });
  await assert.rejects(() => client.getPost(1), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /request-7/);
    assert.doesNotMatch(error.message, /backend|EA-really-secret/);
    return true;
  });
});

test("Meta sends its access token only as a bearer and supports Facebook and Instagram publishing", async () => {
  const calls = [];
  const client = new MetaClient({
    graphApiVersion: "v24.0",
    graphBaseUrl: "https://graph.facebook.example.invalid",
    instagramGraphBaseUrl: "https://graph.instagram.example.invalid",
    accessToken: "EA-secret-token-value",
    facebookPageId: "page-1",
    instagramUserId: "ig-1",
  }, {fetch: async (url, options) => {
    calls.push({url: String(url), options});
    if (url.pathname.endsWith("/page-1/feed")) return response(200, {id: "page-1_post-1"});
    if (url.pathname.endsWith("/ig-1/media_publish")) return response(200, {id: "ig-media-1"});
    if (url.pathname.endsWith("/ig-1/media")) return response(200, {id: "container-1"});
    return response(500, {});
  }});

  const facebook = await client.publishFacebookPost({message: "Hello", link: "https://shop.example.invalid/post"});
  const instagram = await client.publishInstagramImage({image_url: "https://shop.example.invalid/image.jpg", caption: "Hello", alt_text: "Mirror"});
  assert.equal(facebook.external_id, "page-1_post-1");
  assert.equal(instagram.external_id, "ig-media-1");
  assert.equal(calls.length, 3);
  assert.equal(calls.every((entry) => entry.options.headers.authorization === "Bearer EA-secret-token-value"), true);
  assert.equal(calls.every((entry) => !entry.url.includes("EA-secret-token-value")), true);
});

test("Meta provider errors do not expose configured account IDs or response bodies", async () => {
  const client = new MetaClient({
    graphApiVersion: "v24.0",
    graphBaseUrl: "https://graph.facebook.example.invalid",
    instagramGraphBaseUrl: "https://graph.facebook.example.invalid",
    accessToken: "EA-secret-token-value",
    facebookPageId: "sensitive-page-id",
    instagramUserId: null,
  }, {fetch: async () => response(403, {message: "provider body with secret"}, {"x-fb-request-id": "request-9"})});
  await assert.rejects(() => client.listFacebookPosts(), (error) => {
    assert.match(error.message, /Meta GET request failed with HTTP 403/);
    assert.match(error.message, /request-9/);
    assert.doesNotMatch(error.message, /sensitive-page-id|provider body|secret-token/);
    return true;
  });
});

test("product media uploads only the reviewed WebP bytes and then sets alt text", async () => {
  const root = await mkdtemp(join(tmpdir(), "enki-product-media-"));
  try {
    const path = join(root, "fixture.webp");
    const bytes = Buffer.from("RIFF0000WEBPfixture");
    await writeFile(path, bytes);
    const calls = [];
    const client = new WordPressMediaClient({
      baseUrl: "https://shop.example.invalid",
      mediaUsername: "media-user",
      mediaAppPassword: "media-password",
    }, {fetch: async (url, options) => {
      calls.push({url: new URL(url), options});
      return response(200, calls.length === 1 ? {id: 91, source_url: "https://shop.example.invalid/fixture.webp"} : {id: 91});
    }});
    const uploaded = await client.uploadWebp(path, {
      alt: "Fixture alt",
      title: "Fixture title",
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    assert.equal(uploaded.id, 91);
    assert.equal(calls[0].options.headers["content-type"], "image/webp");
    assert.deepEqual(JSON.parse(calls[1].options.body), {alt_text: "Fixture alt", title: "Fixture title"});
    await assert.rejects(() => client.uploadWebp(path, {alt: "x", title: "x", expectedSha256: "0".repeat(64)}), /changed after bundle review/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("WooCommerce product client uses Basic auth and enforces draft-only payload defaults", async () => {
  const calls = [];
  const client = new WooCommerceProductClient({
    baseUrl: "https://shop.example.invalid",
    consumerKey: "ck_fixture",
    consumerSecret: "cs_fixture",
  }, {fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    if (options.method === "GET") return response(200, []);
    return response(200, {id: 44, status: "draft", type: "simple", slug: "fixture", sku: "FIX-1", images: [{id: 91}]});
  }});
  assert.equal(await client.findBySku("FIX-1"), null);
  const created = await client.createDraft({
    type: "simple",
    name: "Fixture",
    slug: "fixture",
    sku: "FIX-1",
    manufacturerReference: "REF-1",
    descriptionHtml: "<p>Body</p>",
    shortDescriptionHtml: "<p>Short</p>",
    categories: [12],
    tags: [31],
    attributes: [],
    seo: {title: "SEO title", description: "SEO description", focusKeyword: "fixture"},
    commerce: {regularPrice: "10.00", manageStock: true, stockQuantity: 1000, stockStatus: "instock"},
  }, [{id: 91, name: "Fixture", alt: "Fixture alt"}], {
    bundleSha256: "a".repeat(64), issueIdentifier: "ENK-200", documentKey: "approved-product-draft", revisionId: "revision-1",
  }, {brandId: 1410});
  assert.equal(created.external_id, "44");
  const write = calls.find((entry) => entry.options.method === "POST");
  const body = JSON.parse(write.options.body);
  assert.equal(body.status, "draft");
  assert.equal(body.type, "simple");
  assert.equal(body.catalog_visibility, "hidden");
  assert.deepEqual(body.brands, [{id: 1410}]);
  assert.equal(body.manage_stock, true);
  assert.equal(body.stock_quantity, 1000);
  assert.equal(body.stock_status, "instock");
  assert.equal(calls.every((entry) => entry.options.headers.authorization.startsWith("Basic ")), true);
  assert.equal(calls.every((entry) => !entry.url.toString().includes("ck_fixture") && !entry.url.toString().includes("cs_fixture")), true);
});

test("WooCommerce product client creates a draft parent and private child variations", async () => {
  const calls = [];
  let nextVariationId = 45;
  const client = new WooCommerceProductClient({
    baseUrl: "https://shop.example.invalid",
    consumerKey: "ck_fixture",
    consumerSecret: "cs_fixture",
  }, {fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    if (options.method === "POST" && url.pathname.endsWith("/products")) {
      return response(200, {id: 44, status: "draft", type: "variable", slug: "pool", sku: "POOL-PARENT", images: [{id: 91}]});
    }
    if (options.method === "POST" && url.pathname.endsWith("/variations")) {
      const body = JSON.parse(options.body);
      return response(200, {id: nextVariationId++, ...body});
    }
    return response(500, {});
  }});
  const created = await client.createDraft({
    type: "variable",
    name: "Pool",
    slug: "pool",
    sku: "POOL-PARENT",
    manufacturerReference: "POOL",
    descriptionHtml: "<p>Body</p>",
    shortDescriptionHtml: "<p>Short</p>",
    categories: [12],
    tags: [31],
    attributes: [{id: 4, options: ["NB", "RM"], visible: true, variation: true}],
    seo: {title: "Pool", description: "Pool description", focusKeyword: "pool"},
    commerce: {manageStock: false, stockStatus: "outofstock"},
    variations: [
      {
        sku: "POOL-NB",
        manufacturerReference: "POOL-NB",
        status: "private",
        attributes: [{id: 4, option: "NB"}],
        imagePosition: 0,
        commerce: {regularPrice: "121.00", salePrice: "102.85", manageStock: true, stockQuantity: 1000, stockStatus: "instock"},
      },
      {
        sku: "POOL-RM",
        manufacturerReference: "POOL-RM",
        status: "private",
        attributes: [{id: 4, option: "RM"}],
        imagePosition: 0,
        commerce: {regularPrice: "242.00", salePrice: "205.70", manageStock: true, stockQuantity: 1000, stockStatus: "instock"},
      },
    ],
  }, [{id: 91, name: "Pool", alt: "Pool", position: 0}], {
    bundleSha256: "a".repeat(64), issueIdentifier: "ENK-201", documentKey: "approved-variable-draft", revisionId: "revision-1",
  });
  assert.equal(created.type, "variable");
  assert.deepEqual(created.variations.map((item) => item.external_id), ["45", "46"]);
  const writes = calls.map((entry) => JSON.parse(entry.options.body));
  assert.equal(writes[0].status, "draft");
  assert.equal(writes[0].type, "variable");
  assert.equal(writes[1].status, "private");
  assert.equal(writes[1].sku, "POOL-NB");
  assert.equal(writes[1].manage_stock, true);
  assert.equal(writes[1].stock_quantity, 1000);
  assert.equal(writes[1].stock_status, "instock");
  assert.deepEqual(writes[1].image, {id: 91});
  assert.equal(writes[2].sku, "POOL-RM");
});

test("WooCommerce keeps variation-only media out of the parent gallery", async () => {
  const calls = [];
  const client = new WooCommerceProductClient({
    baseUrl: "https://shop.example.invalid",
    consumerKey: "ck_fixture",
    consumerSecret: "cs_fixture",
  }, {fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    if (url.pathname.endsWith("/products")) {
      return response(200, {id: 44, status: "draft", type: "variable", slug: "pool", sku: "POOL-PARENT", images: [{id: 91}]});
    }
    const body = JSON.parse(options.body);
    return response(200, {id: 45 + calls.length, ...body});
  }});
  await client.createDraft({
    type: "variable",
    name: "Pool",
    slug: "pool",
    sku: "POOL-PARENT",
    manufacturerReference: "POOL",
    descriptionHtml: "<p>Body</p>",
    shortDescriptionHtml: "<p>Short</p>",
    categories: [12],
    tags: [],
    attributes: [{id: 4, options: ["NB", "RM"], visible: true, variation: true}],
    seo: {title: "Pool", description: "Pool description", focusKeyword: "pool"},
    commerce: {manageStock: false, stockStatus: "outofstock"},
    variations: [
      {sku: "POOL-NB", manufacturerReference: "POOL-NB", status: "private", attributes: [{id: 4, option: "NB"}], imagePosition: 0, commerce: {regularPrice: "121.00", manageStock: true, stockQuantity: 1000, stockStatus: "instock"}},
      {sku: "POOL-RM", manufacturerReference: "POOL-RM", status: "private", attributes: [{id: 4, option: "RM"}], imagePosition: 3, commerce: {regularPrice: "242.00", manageStock: true, stockQuantity: 1000, stockStatus: "instock"}},
    ],
  }, [
    {id: 91, name: "Pool NB", alt: "Pool NB", position: 0, gallery: true},
    {id: 92, name: "Pool dimensions", alt: "Pool dimensions", position: 1, gallery: true},
    {id: 93, name: "Pool finishes", alt: "Pool finishes", position: 2, gallery: true},
    {id: 94, name: "Pool RM", alt: "Pool RM", position: 3, gallery: false},
  ], {
    bundleSha256: "a".repeat(64), issueIdentifier: "ENK-201", documentKey: "approved-variable-draft", revisionId: "revision-1",
  });
  const writes = calls.map((entry) => JSON.parse(entry.options.body));
  assert.deepEqual(writes[0].images.map((image) => image.id), [91, 92, 93]);
  assert.deepEqual(writes[1].image, {id: 91});
  assert.deepEqual(writes[2].image, {id: 94});
});

test("WooCommerce variable draft reports a reconcilable partial failure", async () => {
  let variationCalls = 0;
  const client = new WooCommerceProductClient({
    baseUrl: "https://shop.example.invalid",
    consumerKey: "ck_fixture",
    consumerSecret: "cs_fixture",
  }, {fetch: async (url, options) => {
    if (url.pathname.endsWith("/products")) return response(200, {id: 44, status: "draft", type: "variable", sku: "POOL-PARENT"});
    variationCalls += 1;
    return variationCalls === 1
      ? response(200, {id: 45, status: "private", sku: "POOL-NB"})
      : response(500, {message: "provider detail must not escape"});
  }});
  await assert.rejects(() => client.createDraft({
    type: "variable",
    name: "Pool",
    slug: "pool",
    sku: "POOL-PARENT",
    manufacturerReference: "POOL",
    descriptionHtml: "<p>Body</p>",
    shortDescriptionHtml: "<p>Short</p>",
    categories: [12],
    tags: [],
    attributes: [{id: 4, options: ["NB", "RM"], visible: true, variation: true}],
    seo: {title: "Pool", description: "Pool description", focusKeyword: "pool"},
    commerce: {manageStock: false, stockStatus: "outofstock"},
    variations: [
      {sku: "POOL-NB", manufacturerReference: "POOL-NB", attributes: [{id: 4, option: "NB"}], commerce: {regularPrice: "121.00", manageStock: true, stockQuantity: 1000, stockStatus: "instock"}},
      {sku: "POOL-RM", manufacturerReference: "POOL-RM", attributes: [{id: 4, option: "RM"}], commerce: {regularPrice: "242.00", manageStock: true, stockQuantity: 1000, stockStatus: "instock"}},
    ],
  }, [], {
    bundleSha256: "a".repeat(64), issueIdentifier: "ENK-201", documentKey: "approved-variable-draft", revisionId: "revision-1",
  }), /reconcile parent 44 and created variations 45/);
});
