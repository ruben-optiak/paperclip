import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_NAME } from "../src/contract.mjs";
import { toolDefinition } from "../src/mcp.mjs";

test("the MCP catalog exposes exactly the one approval-gated, idempotent write surface", async () => {
  const publisher = { publish: async () => ({ schema: "optiak-linear-ticket-publication/v1", outcome: "completed", tickets: [] }) };
  const tool = toolDefinition(publisher);
  assert.equal(tool.name, TOOL_NAME);
  assert.deepEqual(tool.annotations, {
    title: "Create approved OPT issue batch",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  const result = await tool.execute({});
  assert.equal(result.isError, false);
});
