import {timingSafeEqual} from "node:crypto";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {createToolDefinitions} from "./tools.mjs";

const require = createRequire(import.meta.url);
const {version: CONNECTOR_VERSION} = require("../package.json");

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {"content-type": "application/json", "content-length": Buffer.byteLength(payload)});
  response.end(payload);
}

function bearerMatches(value, token) {
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createMcp(client) {
  const server = new McpServer({name: "enki-woocommerce-readonly", version: CONNECTOR_VERSION});
  for (const tool of createToolDefinitions(client)) {
    server.registerTool(tool.name, {description: tool.description, inputSchema: tool.schema.shape, annotations: tool.annotations}, tool.execute);
  }
  return server;
}

export function createHttpServer({client, token}) {
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {status: "ok", service: "enki-woocommerce-readonly-mcp", version: CONNECTOR_VERSION});
        return;
      }
      if (url.pathname !== "/mcp") {
        sendJson(response, 404, {error: "Not found"});
        return;
      }
      if (!bearerMatches(request.headers.authorization, token)) {
        sendJson(response, 401, {error: "Unauthorized"});
        return;
      }
      let body;
      try {
        body = request.method === "POST" ? await readBody(request) : undefined;
      } catch {
        sendJson(response, 400, {jsonrpc: "2.0", error: {code: -32700, message: "Invalid JSON request body"}, id: null});
        return;
      }
      const mcp = createMcp(client);
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
      response.on("close", () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    })().catch((error) => {
      if (!response.headersSent) sendJson(response, 500, {error: error instanceof Error ? error.message : "Internal error"});
      else response.end();
    });
  });
}
