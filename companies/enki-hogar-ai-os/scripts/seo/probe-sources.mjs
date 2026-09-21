#!/usr/bin/env node
// Run within the Google connector. Only sanitized status leaves the container.
import {pathToFileURL} from "node:url";

export function decodeReply(text) {
  const payload = text.trim().startsWith("{") ? text : text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
  const reply = JSON.parse(payload);
  const result = reply.result ?? {};
  const blocks = result.content ?? [];
  const messages = blocks.filter(block => block.type === "text").map(block => block.text).join("\n");
  // Some provider failures arrive as JSON text with isError=false.
  let nested = null;
  try { nested = JSON.parse(messages); } catch { /* Plain text is also an MCP result. */ }
  if (/invalid_grant/i.test(messages)) return {status: "unavailable", reason: "oauth_invalid_grant"};
  if (reply.error || result.isError || nested?.error || /^Error:/i.test(messages)) return {status: "unavailable", reason: "provider_error"};
  if (!reply.result || !blocks.length) return {status: "unavailable", reason: "unexpected_response"};
  return {status: "read_succeeded", reason: null};
}

async function probe(port, tool, args) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: {"content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${process.env.GOOGLE_MCP_TOKEN}`},
      body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: tool, arguments: args}}),
    });
    if (!response.ok) return {tool, status: "unavailable", reason: "connector_http_error"};
    return {tool, ...decodeReply(await response.text())};
  } catch { return {tool, status: "unavailable", reason: "connector_unreachable_or_invalid_response"}; }
}

async function main() {
  if (!process.env.GOOGLE_MCP_TOKEN) throw new Error("Run inside the configured Google connector");
  const site = {site_url: "sc-domain:enkihogar.com"};
  const checks = [];
  checks.push(await probe(8012, "gsc_search_analytics", {...site, start_date: "2026-08-01", end_date: "2026-08-31", dimensions: ["page"], row_limit: 2}));
  checks.push(await probe(8012, "gsc_list_sitemaps", site));
  checks.push(await probe(8011, "get_account_summaries", {}));
  console.log(JSON.stringify({schema: "enki-seo-source-probe/v1", capturedAt: new Date().toISOString(), checks,
    authority: {externalMutation: false, credentialsRetained: false, privateIdentifiersRetained: false}}, null, 2));
}

if (process.argv[1] === "-" || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(() => { console.error("Source probe failed; run inside the configured connector"); process.exitCode = 1; });
}
