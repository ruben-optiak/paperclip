import assert from "node:assert/strict";
import test from "node:test";
import {createHttpServer} from "../src/server.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

const dependencies = {
  config: {writeMode: "disabled", wordpress: null, meta: null},
  wordpress: null,
  meta: null,
  ledger: {},
};

test("health is non-sensitive and MCP requires the connector bearer", async (context) => {
  const server = createHttpServer({dependencies, token: "test-only-bearer"});
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {status: "ok", service: "enki-content-publisher-mcp", version: "0.1.0"});
  assert.equal((await fetch(`${baseUrl}/mcp`, {method: "POST"})).status, 401);

  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-only-bearer",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {protocolVersion: "2025-03-26", capabilities: {}, clientInfo: {name: "enki-test", version: "1.0.0"}},
    }),
  });
  assert.equal(initialized.status, 200);
  assert.match(await initialized.text(), /"name":"enki-content-publisher"/);

  const listed = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-only-bearer",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({jsonrpc: "2.0", id: 2, method: "tools/list", params: {}}),
  });
  assert.equal(listed.status, 200);
  const catalog = await listed.text();
  for (const name of [
    "publisher_get_capabilities",
    "wordpress_list_posts",
    "wordpress_get_article",
    "wordpress_upsert_post",
    "facebook_list_page_posts",
    "facebook_publish_page_post",
    "instagram_list_media",
    "instagram_get_publishing_limit",
    "instagram_publish_image",
  ]) assert.match(catalog, new RegExp(`\"name\":\"${name}\"`));
  assert.match(catalog, /"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true/);
});
