import {MetaClient, WordPressClient} from "./clients.mjs";
import {readConfig} from "./config.mjs";
import {PublicationLedger} from "./ledger.mjs";
import {createHttpServer} from "./server.mjs";

const config = readConfig();
const dependencies = {
  config,
  wordpress: config.wordpress ? new WordPressClient(config.wordpress) : null,
  meta: config.meta ? new MetaClient(config.meta) : null,
  ledger: new PublicationLedger(config.ledgerPath),
};
const server = createHttpServer({dependencies, token: config.token});
server.listen(config.port, config.host, () => {
  console.log(`enki-content-publisher-mcp listening on ${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
