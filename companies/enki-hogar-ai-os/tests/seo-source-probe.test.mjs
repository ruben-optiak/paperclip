import assert from "node:assert/strict";
import test from "node:test";
import {decodeReply} from "../scripts/seo/probe-sources.mjs";

test("SEO probe detects nested provider errors even when MCP isError is false", () => {
  const reply = {result: {isError: false, content: [{type: "text", text: JSON.stringify({error: "503 invalid_grant: expired"})}]}};
  assert.deepEqual(decodeReply(JSON.stringify(reply)), {status: "unavailable", reason: "oauth_invalid_grant"});
});

test("SEO probe sanitizes errors and accepts JSON and SSE read results", () => {
  const failed = {result: {isError: true, content: [{type: "text", text: "private provider details"}]}};
  assert.deepEqual(decodeReply(`event: message\r\ndata: ${JSON.stringify(failed)}\r\n\r\n`), {status: "unavailable", reason: "provider_error"});
  assert.equal(decodeReply(JSON.stringify({result: {content: [{type: "text", text: '{"rows":[]}' }]}})).status, "read_succeeded");
  assert.equal(decodeReply('{"result":{}}').status, "unavailable");
});
