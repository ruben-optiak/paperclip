import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateBudget, validateConfig } from "../scripts/web/run-public-web-baseline.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "references/web/public-web-baseline-v1.json"), "utf8"));
const browserSnapshot = JSON.parse(readFileSync(join(root, "references/web/snapshots/eai-027-browser-2026-09-03.json"), "utf8"));
const lighthouseSnapshot = JSON.parse(readFileSync(join(root, "references/web/snapshots/eai-027-lighthouse-home-2026-09-03.json"), "utf8"));

test("EAI-027 config is same-origin and read-only", () => {
  assert.equal(validateConfig(config), config);
  assert.deepEqual(config.safety.allowedMethods, ["GET", "HEAD"]);
  assert.equal(config.safety.clicksAllowed, false);
  assert.equal(config.safety.formSubmissionAllowed, false);
  assert.deepEqual(config.targets.map((target) => target.kind), ["home", "category", "product", "content"]);
});

test("budget failures cannot be promoted to passes", () => {
  const result = evaluateBudget({status: 200, ttfbMs: 1501, fcpMs: 1000, lcpMs: 2000, cls: 0.1, loadMs: 3000, encodedBytes: 1000}, config.budgets);
  assert.equal(result.checks.ttfbMs, false);
  assert.equal(result.passed, false);
  assert.equal(evaluateBudget({status: 200, ttfbMs: 1, fcpMs: null, lcpMs: 2, cls: 0, loadMs: 3, encodedBytes: 4}, config.budgets).passed, false);
});

test("unsafe or cross-origin configurations are rejected", () => {
  assert.throws(() => validateConfig({...config, safety: {...config.safety, clicksAllowed: true}}), /read-only/);
  assert.throws(() => validateConfig({...config, targets: [{id: "bad", path: "https://example.com", required: []}]}), /cross-origin/);
});

test("initial baseline preserves failures and contains no raw browsing data", () => {
  assert.equal(browserSnapshot.summary.functionalPassed, false);
  assert.equal(browserSnapshot.targets.find((target) => target.id === "category").signals.noindex, true);
  assert.equal(browserSnapshot.targets.find((target) => target.id === "product").signals.purchaseControlCount > 0, true);
  assert.equal(lighthouseSnapshot.lighthouseVersion, "13.4.1");
  assert.equal(lighthouseSnapshot.categories.performance, 0.62);
  assert.equal(lighthouseSnapshot.retention.rawReportRetained, false);
  assert.equal(JSON.stringify({browserSnapshot, lighthouseSnapshot}).includes("networkUserAgent"), false);
});
