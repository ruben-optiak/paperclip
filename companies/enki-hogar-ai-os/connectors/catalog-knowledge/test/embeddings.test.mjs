import assert from "node:assert/strict";
import test from "node:test";
import {createEmbeddingClient, vectorLiteral} from "../src/embeddings.mjs";

test("embedding client sends only model and supplied text", async () => {
  let captured;
  const client = createEmbeddingClient({baseUrl: "https://embeddings.example.invalid/v1", apiKey: "test-key", model: "test-model", timeoutMs: 1000}, {
    request: async (_url, options) => {
      captured = options;
      return {ok: true, json: async () => ({data: [{embedding: [0.1, 0.2]}]})};
    },
  });
  assert.deepEqual(await client.embed(["texto de prueba"]), [[0.1, 0.2]]);
  assert.deepEqual(JSON.parse(captured.body), {model: "test-model", input: ["texto de prueba"]});
  assert.equal(vectorLiteral([0.1, -0.2]), "[0.1,-0.2]");
});

