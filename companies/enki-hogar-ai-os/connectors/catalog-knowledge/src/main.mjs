import {serverConfig} from "./config.mjs";
import {createDatabase, closeDatabase} from "./db.mjs";
import {createEmbeddingClient} from "./embeddings.mjs";
import {ProductSupportRepository} from "./repository.mjs";
import {createHttpServer} from "./server.mjs";

const config = serverConfig();
const sql = createDatabase(config.database);
const repository = new ProductSupportRepository(sql, {embeddingClient: createEmbeddingClient(config.embeddings)});
await repository.health();

const server = createHttpServer({repository, token: config.token});
server.listen(config.port, config.host, () => {
  console.log(`enki-product-support-knowledge-mcp listening on ${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => {
    void closeDatabase(sql).finally(() => process.exit(0));
  }));
}
