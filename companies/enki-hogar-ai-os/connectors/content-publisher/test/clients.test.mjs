import assert from "node:assert/strict";
import test from "node:test";
import {MetaClient, WordPressClient} from "../src/clients.mjs";

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
