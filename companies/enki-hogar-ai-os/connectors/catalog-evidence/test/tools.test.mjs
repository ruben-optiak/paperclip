import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {CatalogueEvidencePublication} from "../src/publication.mjs";
import {createToolDefinitions} from "../src/tools.mjs";
import {createApprovedPublication} from "./fixtures.mjs";

test("tool catalog is exact, read-only, bounded and exposes no browsing or mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "enki-catalogue-tools-"));
  createApprovedPublication(root);
  const publication = await CatalogueEvidencePublication.load(root);
  const tools = createToolDefinitions(publication);
  assert.deepEqual(tools.map((tool) => tool.name), [
    "catalogue_list_approved_runs",
    "catalogue_search_field_evidence",
    "catalogue_get_field_evidence",
    "catalogue_get_evidence_crop",
    "catalogue_evidence_coverage",
  ]);
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, {title: tool.description, readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true});
    assert.doesNotMatch(tool.name, /(?:^|_)(?:create|update|delete|publish|import|export|browse|file|raw)(?:_|$)/i);
  }
  const search = tools.find((tool) => tool.name === "catalogue_search_field_evidence");
  assert.equal((await search.execute({})).isError, true);
  const response = await search.execute({series: "demo-series", limit: 1});
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.authority.raw_inputs_accessible, false);
  assert.equal(payload.data.length, 1);
});
