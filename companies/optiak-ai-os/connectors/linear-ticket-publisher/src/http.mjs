import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp.mjs";
import { TEAM_KEY, TOOL_NAME } from "./contract.mjs";

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  response.end(payload);
}

function bearer(request) {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function sameSecret(received, expected) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 131072) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createHttpServer({ publisher, journal, token, writeMode }) {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "optiak-linear-ticket-publisher",
          writeMode,
          teamKey: TEAM_KEY,
          toolCount: 1,
          tool: TOOL_NAME,
          journal: journal ? "ready" : "unavailable",
        });
        return;
      }
      if (url.pathname !== "/mcp") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (!sameSecret(bearer(request), token)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      let parsed;
      try { parsed = request.method === "POST" ? await body(request) : undefined; }
      catch { sendJson(response, 400, { jsonrpc: "2.0", error: { code: -32700, message: "invalid_request" }, id: null }); return; }
      const { server: mcp } = createMcpServer(publisher);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on("close", () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, parsed);
    })().catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_failure" });
      else response.end();
    });
  });
  return {
    listen: (port, host) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      });
    }),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
