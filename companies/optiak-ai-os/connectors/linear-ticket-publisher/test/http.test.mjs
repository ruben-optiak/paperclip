import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../src/http.mjs";
import { TOOL_NAME } from "../src/contract.mjs";

const fixturePath = fileURLToPath(new URL("../fixtures/valid-batch.json", import.meta.url));
const fixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));

async function client(base, token) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const instance = new Client({ name: "publisher-test", version: "0.0.0" });
  await instance.connect(transport);
  return instance;
}

test("health is non-sensitive and MCP auth exposes exactly the approved tool", async (context) => {
  const token = "fixture-connector-token";
  let received = null;
  const publisher = {
    publish: async (input) => {
      received = input;
      return { schema: "optiak-linear-ticket-publication/v1", outcome: "completed", teamKey: "OPT", tickets: [] };
    },
  };
  const server = createHttpServer({ publisher, journal: {}, token, writeMode: "disabled" });
  let port;
  try {
    port = await server.listen(0, "127.0.0.1");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      context.skip("local sandbox does not permit loopback listeners");
      return;
    }
    throw error;
  }
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.status, "ok");
    assert.equal(health.writeMode, "disabled");
    assert.equal(JSON.stringify(health).includes(token), false);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 401);

    const mcp = await client(base, token);
    try {
      const catalog = await mcp.listTools();
      assert.deepEqual(catalog.tools.map((tool) => tool.name), [TOOL_NAME]);
      const result = await mcp.callTool({ name: TOOL_NAME, arguments: fixture() });
      assert.equal(result.isError, false);
      assert.equal(received.schema, "optiak-linear-ticket-batch/v1");
    } finally {
      await mcp.close();
    }
  } finally {
    await server.close();
  }
});
