import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BATCH_SCHEMA, TOOL_NAME, ticketBatchSchema } from "./contract.mjs";

export function toolDefinition(publisher) {
  return {
    name: TOOL_NAME,
    description: "Create one approved batch of at most five unassigned Linear issues in team OPT. Every exact call requires Paperclip action approval.",
    schema: ticketBatchSchema,
    annotations: {
      title: "Create approved OPT issue batch",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (input) => {
      const result = await publisher.publish(input);
      return {
        isError: result.outcome !== "completed",
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  };
}

export function createMcpServer(publisher) {
  const server = new McpServer({ name: "optiak-linear-ticket-publisher", version: "0.1.0" });
  const tool = toolDefinition(publisher);
  server.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.schema.shape,
    annotations: tool.annotations,
  }, tool.execute);
  return { server, tools: [tool], contract: BATCH_SCHEMA };
}
