import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {inspectHtml, inspectPublicWordPress} from "../scripts/web/inspect-public-wordpress.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desired = JSON.parse(readFileSync(join(root, "references/web/wordpress-technical-desired-state.json"), "utf8"));

test("EAI-026 desired state separates WordPress repo and runtime ownership", () => {
  assert.deepEqual(Object.keys(desired.surfaces), ["wordpressLive", "repository", "runtimeConfiguration"]);
  assert.equal(desired.invariants.credentialsAllowed, false);
  assert.equal(desired.invariants.rawHtmlRetentionAllowed, false);
  assert.equal(desired.snapshot.approvedBaselineSha256, null);
  assert.equal(desired.snapshot.approvalStatus, "pending_board_baseline_selection");
  assert.equal(desired.authority.isDeploymentAuthority, false);
});

test("public HTML inspection inventories slugs and fingerprints but redacts GTM IDs", () => {
  const result = inspectHtml('<meta name="generator" content="WordPress 6.8"><link rel="canonical" href="https://www.enkihogar.com/a/"><script src="/wp-content/plugins/woocommerce/x.js?ver=1"></script><link href="/wp-content/themes/storefront/a.css"><script>GTM-ABC123</script>', "https://www.enkihogar.com/");
  assert.equal(result.generator, "WordPress 6.8");
  assert.deepEqual(result.plugins, ["woocommerce"]);
  assert.deepEqual(result.themes, ["storefront"]);
  assert.equal(result.gtm.present, true);
  assert.equal(result.gtm.identifiersRetained, false);
  assert.equal(JSON.stringify(result).includes("GTM-ABC123"), false);
  assert.equal(result.canonical.sameOrigin, true);
});

test("scanner performs only two public GETs and retains no response bodies", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url: String(url), method: options.method});
    const body = String(url).includes("wp-json") ? JSON.stringify({namespaces: ["wp/v2", "wc/v3"]}) : '<link rel="canonical" href="https://www.enkihogar.com/">';
    return new Response(body, {status: 200, headers: {"cache-control": "max-age=60"}});
  };
  const snapshot = await inspectPublicWordPress("https://www.enkihogar.com/", {fetchImpl, now: () => new Date("2026-09-03T12:00:00Z")});
  assert.deepEqual(calls.map(({method}) => method), ["GET", "GET"]);
  assert.deepEqual(snapshot.wordpress.restNamespaces, ["wc/v3", "wp/v2"]);
  assert.equal(snapshot.wordpress.rawHtmlRetained, false);
  assert.equal(snapshot.authority.isMutationAuthority, false);
  assert.rejects(() => inspectPublicWordPress("https://user:secret@www.enkihogar.com/", {fetchImpl}));
});
