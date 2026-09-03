import {readFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../references/contracts");
const schemaFiles = {
  publication: "catalog-evidence-publication-v1.schema.json",
  run: "catalog-run-v1.schema.json",
  evidence: "catalog-field-evidence-v1.schema.json",
};
let cached;

export async function contractValidators(root = process.env.CATALOGUE_EVIDENCE_SCHEMA_ROOT || sourceRoot) {
  if (!cached) cached = (async () => {
    const ajv = new Ajv2020({strict: true, allErrors: true});
    addFormats(ajv);
    const validators = {};
    for (const [key, filename] of Object.entries(schemaFiles)) {
      const schema = JSON.parse(await readFile(join(root, filename), "utf8"));
      validators[key] = ajv.compile(schema);
    }
    return validators;
  })();
  return cached;
}

export function assertContract(validator, value, label) {
  if (validator(value)) return;
  const summary = (validator.errors || []).slice(0, 5).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
  throw new Error(`${label} violates its strict contract: ${summary}`);
}
