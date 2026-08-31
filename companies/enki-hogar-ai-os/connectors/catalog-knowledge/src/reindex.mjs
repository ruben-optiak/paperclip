import {vectorLiteral} from "./embeddings.mjs";

export async function reindexEmbeddings(sql, embeddingClient, {brand = null, domain = null, limit = 1000, batchSize = 32} = {}) {
  if (!embeddingClient) throw new Error("Embedding configuration is required for reindex-embeddings");
  const rows = await sql.unsafe(`
    SELECT k.id, k.content
    FROM support_chunks k
    JOIN support_packs p ON p.id = k.pack_id AND p.status = 'active'
    WHERE ($1::text IS NULL OR p.brand_slug = $1)
      AND ($2::text IS NULL OR p.domain_slug = $2)
    ORDER BY k.id
    LIMIT $3
  `, [brand, domain, limit]);
  let updated = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const vectors = await embeddingClient.embed(batch.map((row) => row.content));
    await sql.begin(async (tx) => {
      for (let offset = 0; offset < batch.length; offset += 1) {
        const vector = vectors[offset];
        await tx.unsafe(`
          UPDATE support_chunks
          SET embedding = $1::vector, embedding_model = $2, embedding_dimensions = $3
          WHERE id = $4
        `, [vectorLiteral(vector), embeddingClient.model, vector.length, batch[offset].id]);
        updated += 1;
      }
    });
  }
  return {selected: rows.length, updated, model: embeddingClient.model};
}
