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

test("MCP endpoint requires the configured bearer and accepts it", async (context) => {
  const server = createHttpServer({client: {}, token: "test-only-bearer"});
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const missing = await fetch(`${baseUrl}/mcp`, {method: "POST"});
  assert.equal(missing.status, 401);
  const wrong = await fetch(`${baseUrl}/mcp`, {method: "POST", headers: {authorization: "Bearer wrong"}});
  assert.equal(wrong.status, 401);

  const authorized = await fetch(`${baseUrl}/mcp`, {
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
  assert.equal(authorized.status, 200);
  const body = await authorized.text();
  assert.match(body, /"jsonrpc":"2\.0"/);
  assert.match(body, /"id":1/);
  assert.match(body, /"name":"enki-woocommerce-readonly"/);
});
