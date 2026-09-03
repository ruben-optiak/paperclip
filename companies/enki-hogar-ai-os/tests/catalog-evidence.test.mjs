import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {createApprovedPublication} from "../connectors/catalog-evidence/test/fixtures.mjs";
import {CatalogueEvidencePublication} from "../connectors/catalog-evidence/src/publication.mjs";
import {createToolDefinitions} from "../connectors/catalog-evidence/src/tools.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(join(packageDir, "..", "..", "server", "package.json"));
const Ajv2020 = serverRequire("ajv/dist/2020").default;
const addFormats = serverRequire("ajv-formats");

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("approved-publication contract is strict and mirrored byte-for-byte", () => {
  const canonical = join(packageDir, "references/contracts/catalog-evidence-publication-v1.schema.json");
  const mirror = join(packageDir, "skills/enki-catalog-qa/references/catalog-evidence-publication-v1.schema.json");
  assert.equal(digest(canonical), digest(mirror));
  const schema = JSON.parse(readFileSync(canonical, "utf8"));
  const ajv = new Ajv2020({strict: true, allErrors: true});
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const root = mkdtempSync(join(tmpdir(), "enki-eai022-schema-"));
  const {manifest} = createApprovedPublication(root);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  const unsafe = structuredClone(manifest);
  unsafe.authority.rawInputsIncluded = true;
  assert.equal(validate(unsafe), false);
});

test("EAI-022 gate exposes only five read tools over approved projections", async () => {
  const root = mkdtempSync(join(tmpdir(), "enki-eai022-gate-"));
  createApprovedPublication(root);
  const publication = await CatalogueEvidencePublication.load(root);
  const tools = createToolDefinitions(publication);
  assert.equal(tools.length, 5);
  assert.equal(tools.every((tool) => tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false && tool.annotations.openWorldHint === false), true);
  assert.equal(tools.some((tool) => /(?:^|_)(?:create|update|delete|publish|import|export|browse|raw)(?:_|$)/.test(tool.name)), false);
});
