import assert from "node:assert/strict";
import test from "node:test";
import {WooCommerceReadClient} from "../src/client.mjs";
import {response} from "./fixtures.mjs";

const config = {baseUrl: "https://shop.example.invalid", consumerKey: "key", consumerSecret: "secret"};

test("paginates GET requests without putting credentials in the URL", async () => {
  const requests = [];
  const pages = [[...Array(100)].map((_, id) => ({id})), [{id: 101}]];
  const client = new WooCommerceReadClient(config, {fetch: async (url, options) => {
    requests.push({url: String(url), options});
    const page = Number(url.searchParams.get("page"));
    return response(200, pages[page - 1], {"x-wp-totalpages": "2", "x-wp-total": "101"});
  }});
  const result = await client.paginate("/products", {}, 10);
  assert.equal(result.rows.length, 101);
  assert.equal(result.truncated, false);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.totalItems, 101);
  assert.equal(requests.every(({options}) => options.method === "GET"), true);
  assert.equal(requests.every(({url}) => !url.includes("key") && !url.includes("secret")), true);
});

test("fetches known pages with bounded concurrency while preserving page order", async () => {
  let active = 0;
  let maximumActive = 0;
  const requestedPages = [];
  const client = new WooCommerceReadClient(config, {fetch: async (url) => {
    const page = Number(url.searchParams.get("page"));
    requestedPages.push(page);
    if (page > 1) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }
    return response(200, [...Array(100)].map((_, index) => ({id: page * 100 + index})), {"x-wp-totalpages": "4"});
  }});

  const result = await client.paginate("/products", {}, 10, {concurrency: 3});
  assert.deepEqual(requestedPages, [1, 2, 3, 4]);
  assert.equal(maximumActive, 3);
  assert.equal(result.rows.length, 400);
  assert.deepEqual([result.rows[0].id, result.rows[100].id, result.rows[200].id, result.rows[300].id], [100, 200, 300, 400]);
  assert.equal(result.pagesFetched, 4);
  assert.equal(result.totalPages, 4);
  assert.equal(result.truncated, false);
  assert.equal(result.totalItems, null);
});

test("trusts an explicit multi-page header even when the first page is short", async () => {
  const requestedPages = [];
  const client = new WooCommerceReadClient(config, {fetch: async (url) => {
    const page = Number(url.searchParams.get("page"));
    requestedPages.push(page);
    return response(200, [{id: page}], {"x-wp-totalpages": "2", "x-wp-total": "2"});
  }});
  const result = await client.paginate("/products", {}, 10, {concurrency: Number.NaN});
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.truncated, false);
});

test("reports explicit truncation when the page cap is below the remote total", async () => {
  const client = new WooCommerceReadClient(config, {fetch: async (url) => {
    const page = Number(url.searchParams.get("page"));
    return response(200, [...Array(100)].map((_, index) => ({id: page * 100 + index})), {"x-wp-totalpages": "8"});
  }});
  const result = await client.paginate("/products", {}, 2, {concurrency: 6});
  assert.equal(result.rows.length, 200);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.totalPages, 8);
  assert.equal(result.truncated, true);
});

test("retries bounded rate limits and honors a capped retry-after", async () => {
  let calls = 0;
  const waits = [];
  const client = new WooCommerceReadClient(config, {
    fetch: async () => {
      calls += 1;
      return calls === 1 ? response(429, {}, {"retry-after": "99"}) : response(200, []);
    },
    sleep: async (milliseconds) => waits.push(milliseconds),
  });
  await client.get("/orders");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [5000]);
});

test("surfaces a sanitized HTTP error without response content", async () => {
  const client = new WooCommerceReadClient(config, {fetch: async () => response(403, {message: "secret backend detail"})});
  await assert.rejects(() => client.get("/orders"), /HTTP 403/);
  await assert.rejects(() => client.get("/orders"), (error) => !error.message.includes("secret backend detail"));
});
