import {serverConfig} from "./config.mjs";
import {CatalogueEvidencePublication} from "./publication.mjs";
import {createHttpServer} from "./server.mjs";

const config = serverConfig();
const publication = await CatalogueEvidencePublication.load(config.publicationRoot, {maxCropBytes: config.maxCropBytes});
const server = createHttpServer({publication, token: config.token});
server.listen(config.port, config.host, () => {
  console.log(`enki-catalogue-evidence-mcp listening on ${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
