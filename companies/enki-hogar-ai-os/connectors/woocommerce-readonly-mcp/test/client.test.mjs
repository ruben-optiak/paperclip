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
    return response(200, pages[page - 1], {"x-wp-totalpages": "2"});
  }});
  const result = await client.paginate("/products", {}, 10);
  assert.equal(result.rows.length, 101);
  assert.equal(result.truncated, false);
  assert.equal(requests.every(({options}) => options.method === "GET"), true);
  assert.equal(requests.every(({url}) => !url.includes("key") && !url.includes("secret")), true);
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
