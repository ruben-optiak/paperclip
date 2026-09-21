import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const task = readFileSync(join(packageDir, "projects/organic-growth-catalogue-quality/tasks/catalogue-quality-baseline/TASK.md"), "utf8");
const runbook = readFileSync(join(packageDir, "runbooks/catalog-audit-pilot.md"), "utf8");

test("ENK-7 task requires one exact fresh and bounded audit mandate", () => {
  for (const marker of [
    "one brand and one technical domain",
    "complete, freshly generated Woo export",
    "at most 25 entity keys and 50 field selectors",
    "adapter key/version/definition SHA",
    "all external mutations are unauthorized",
  ]) assert.match(task, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(task, /Sample the catalogue through read-only product queries/);
  assert.match(task, /Never reconstruct the complete Woo snapshot through MCP pagination/);
});

test("bounded pilot produces evidence and reports but grants no import authority", () => {
  for (const marker of [
    "catalog-regression/v1",
    "audit.ignoredColumns: []",
    "catalog-evidence-publication/v1",
    "catalogue-audit-report",
    "PASS`, `PARTIAL` or `FAIL",
    "cannot create or apply a Woo import",
    "issue revision: <exact ENK-7 revision>",
    "complete true",
    "report only; Woo/feed/support imports false; external mutations false",
  ]) assert.ok(runbook.includes(marker), `Missing audit-pilot boundary: ${marker}`);
  assert.match(runbook, /All three are terminal `done` outcomes/);
  assert.match(runbook, /support pack only as a follow-up candidate/);
});
