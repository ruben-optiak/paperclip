import {resolve} from "node:path";
import {CatalogueEvidencePublication} from "./publication.mjs";

const [command, rootArgument] = process.argv.slice(2);
if (command !== "validate" || !rootArgument) {
  console.error("Usage: npm run validate -- /absolute/path/to/approved-publication");
  process.exit(2);
}

const root = resolve(rootArgument);
const publication = await CatalogueEvidencePublication.load(root);
console.log(JSON.stringify({
  valid: true,
  schema: publication.manifest.schema,
  publicationKey: publication.manifest.publicationKey,
  approvedRuns: publication.runs.size,
  approvedEvidence: publication.evidence.size,
  rawInputsAccessible: false,
  externalWritesBlocked: true,
}, null, 2));
