import {timingSafeEqual} from "node:crypto";
import {createServer, request as upstreamRequest} from "node:http";
import {connect} from "node:net";
import {pathToFileURL} from "node:url";

function bearerMatches(value, token) {
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function upstreamReady(upstreamPort) {
  return new Promise((resolve) => {
    const socket = connect({host: "127.0.0.1", port: upstreamPort});
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function createAuthProxyServer({upstreamPort, service, token}) {
  if (!Number.isInteger(upstreamPort) || upstreamPort <= 0 || !service || !token) {
    throw new Error("upstream port, service, and token are required");
  }
  return createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url || "/", "http://localhost");
      if (incoming.method === "GET" && url.pathname === "/health") {
        const ready = await upstreamReady(upstreamPort);
        const body = JSON.stringify({status: ready ? "ok" : "starting", service, runtime: "enki-google-mcps-v0.1.0"});
        outgoing.writeHead(ready ? 200 : 503, {"content-type": "application/json", "content-length": Buffer.byteLength(body)});
        outgoing.end(body);
        return;
      }
      if (!bearerMatches(incoming.headers.authorization, token)) {
        outgoing.writeHead(401, {"content-type": "application/json"});
        outgoing.end('{"error":"Unauthorized"}');
        return;
      }
      const headers = {...incoming.headers, host: `127.0.0.1:${upstreamPort}`};
      // The connector bearer authenticates Paperclip to this boundary. The
      // third-party MCP process behind it neither needs nor receives the token.
      delete headers.authorization;
      delete headers["proxy-authorization"];
      const proxy = upstreamRequest({host: "127.0.0.1", port: upstreamPort, path: incoming.url, method: incoming.method, headers}, (upstream) => {
        outgoing.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(outgoing);
      });
      proxy.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502, {"content-type": "application/json"});
        outgoing.end('{"error":"Upstream unavailable"}');
      });
      incoming.pipe(proxy);
    })().catch(() => {
      if (!outgoing.headersSent) outgoing.writeHead(500, {"content-type": "application/json"});
      outgoing.end('{"error":"Proxy failure"}');
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [listenPortRaw, upstreamPortRaw, service] = process.argv.slice(2);
  const listenPort = Number.parseInt(listenPortRaw, 10);
  const upstreamPort = Number.parseInt(upstreamPortRaw, 10);
  const token = process.env.GOOGLE_MCP_TOKEN?.trim();
  if (!token || !listenPort || !upstreamPort || !service) throw new Error("proxy port, upstream port, service, and GOOGLE_MCP_TOKEN are required");

  const server = createAuthProxyServer({upstreamPort, service, token});
  server.listen(listenPort, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
