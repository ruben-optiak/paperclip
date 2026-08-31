function endpoint(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/embeddings`;
}

export function createEmbeddingClient(config, {request = fetch} = {}) {
  if (!config) return null;
  async function embed(inputs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await request(endpoint(config.baseUrl), {
        method: "POST",
        headers: {Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json"},
        body: JSON.stringify({model: config.model, input: inputs}),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
      const payload = await response.json();
      const vectors = payload?.data?.map((entry) => entry.embedding);
      if (!Array.isArray(vectors) || vectors.length !== inputs.length || vectors.some((vector) => !Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value)))) {
        throw new Error("Embedding provider returned an invalid vector payload");
      }
      return vectors;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {model: config.model, embed};
}

export function vectorLiteral(vector) {
  return `[${vector.join(",")}]`;
}

