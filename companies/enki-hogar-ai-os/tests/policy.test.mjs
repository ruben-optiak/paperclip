import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const policy = readFileSync(join(packageDir, "policies", "tool-allowlist.yaml"), "utf8");

test("policy denies every planned mutation surface", () => {
  for (const term of ["mutate", "refund", "budget", "index", "publish", "upload", "delete", "update"]) {
    assert.match(policy, new RegExp(term));
  }
  assert.match(policy, /default: quarantine/);
  assert.match(policy, /deniedPatterns: \[create, update, delete, refund, batch, customer, set, write\]/);
});

test("Google and Woo allowlists contain only expected query tools", () => {
  for (const tool of ["woo_sales_summary", "woo_orders_summary", "search_search", "run_report", "gsc_search_analytics"]) {
    assert.match(policy, new RegExp(`\\b${tool}:`));
  }
  assert.doesNotMatch(policy, /^\s+(?:woo_update|woo_refund|woo_customer|gsc_index|ads_mutate)[^:]*:/m);
});
