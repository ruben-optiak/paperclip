import {WooCommerceReadClient} from "./client.mjs";
import {readConfig} from "./config.mjs";
import {createHttpServer} from "./server.mjs";

const config = readConfig();
const client = new WooCommerceReadClient(config);
const server = createHttpServer({client, token: config.token});
server.listen(config.port, config.host, () => {
  console.log(`enki-woocommerce-readonly-mcp listening on ${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
