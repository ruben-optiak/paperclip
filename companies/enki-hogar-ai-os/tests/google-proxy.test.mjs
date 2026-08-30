import assert from "node:assert/strict";
import {createServer} from "node:http";
import test from "node:test";

import {createAuthProxyServer} from "../connectors/google-mcps/auth-proxy.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("Google proxy authenticates Paperclip and strips its bearer before forwarding", async () => {
  let upstreamAuthorization = "not-called";
  const upstream = createServer((request, response) => {
    upstreamAuthorization = request.headers.authorization ?? null;
    request.resume();
    request.on("end", () => {
      response.writeHead(200, {"content-type": "application/json"});
      response.end('{"ok":true}');
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createAuthProxyServer({
    upstreamPort,
    service: "test-google-mcp",
    token: "fixture-boundary-token",
  });
  const proxyPort = await listen(proxy);
  const baseUrl = `http://127.0.0.1:${proxyPort}`;

  try {
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/mcp`, {method: "POST", body: "{}"})).status, 401);
    assert.equal((await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {authorization: "Bearer wrong-token"},
      body: "{}",
    })).status, 401);

    const accepted = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-boundary-token",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {ok: true});
    assert.equal(upstreamAuthorization, null);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
