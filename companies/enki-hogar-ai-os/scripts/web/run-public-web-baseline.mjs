#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultConfig = join(root, "references/web/public-web-baseline-v1.json");

export function evaluateBudget(metrics, budgets) {
  const checks = {
    status2xx: metrics.status >= 200 && metrics.status < 300,
    ttfbMs: metrics.ttfbMs !== null && metrics.ttfbMs <= budgets.ttfbMsMax,
    fcpMs: metrics.fcpMs !== null && metrics.fcpMs <= budgets.fcpMsMax,
    lcpMs: metrics.lcpMs !== null && metrics.lcpMs <= budgets.lcpMsMax,
    cls: metrics.cls !== null && metrics.cls <= budgets.clsMax,
    loadMs: metrics.loadMs !== null && metrics.loadMs <= budgets.loadMsMax,
    encodedBytes: metrics.encodedBytes !== null && metrics.encodedBytes <= budgets.encodedBytesMax
  };
  return {checks, passed: Object.values(checks).every(Boolean)};
}

export function validateConfig(config) {
  const origin = new URL(config.origin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("origin must be a clean HTTPS origin");
  }
  if (config.safety.clicksAllowed || config.safety.formSubmissionAllowed) throw new Error("harness must remain read-only");
  if (config.safety.allowedMethods.join(",") !== "GET,HEAD") throw new Error("only GET and HEAD are allowed");
  for (const target of config.targets) {
    const url = new URL(target.path, origin);
    if (url.origin !== origin.origin) throw new Error(`cross-origin target: ${target.id}`);
  }
  return config;
}

async function inspectTarget(context, origin, target, budgets) {
  const page = await context.newPage();
  let blockedMutationRequests = 0;
  let encodedBytes = 0;
  await page.route("**/*", async (route) => {
    if (!["GET", "HEAD"].includes(route.request().method())) {
      blockedMutationRequests += 1;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.loadingFinished", ({encodedDataLength}) => { encodedBytes += encodedDataLength || 0; });
  await page.addInitScript(() => {
    globalThis.__enkiVitals = {lcp: null, cls: 0};
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries.at(-1);
      if (last) globalThis.__enkiVitals.lcp = last.startTime;
    }).observe({type: "largest-contentful-paint", buffered: true});
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__enkiVitals.cls += entry.value;
    }).observe({type: "layout-shift", buffered: true});
  });

  const response = await page.goto(new URL(target.path, origin).href, {waitUntil: "load", timeout: 45000});
  await page.waitForTimeout(2500);
  const observed = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
    const robots = document.querySelector('meta[name="robots"]')?.content || "";
    return {
      titlePresent: Boolean(document.title.trim()),
      h1: document.querySelectorAll("h1").length,
      canonical,
      noindex: /(?:^|,)\s*noindex\b/i.test(robots),
      jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
      productLinks: document.querySelectorAll('a[href*="/producto/"], li.product a').length,
      purchaseControls: document.querySelectorAll('form.cart, button.single_add_to_cart_button, .single_add_to_cart_button').length,
      ttfbMs: nav ? nav.responseStart : null,
      loadMs: nav ? nav.loadEventEnd : null,
      fcpMs: fcp?.startTime ?? null,
      lcpMs: globalThis.__enkiVitals?.lcp ?? null,
      cls: globalThis.__enkiVitals?.cls ?? null
    };
  });
  const finalUrl = new URL(page.url());
  const requiredChecks = {
    h1: !target.required.includes("h1") || observed.h1 > 0,
    canonical_same_origin: !target.required.includes("canonical_same_origin") || (observed.canonical !== null && new URL(observed.canonical).origin === new URL(origin).origin),
    product_links: !target.required.includes("product_links") || observed.productLinks > 0,
    purchase_control: !target.required.includes("purchase_control") || observed.purchaseControls > 0
  };
  const metrics = {
    status: response?.status() ?? 0,
    ttfbMs: observed.ttfbMs,
    fcpMs: observed.fcpMs,
    lcpMs: observed.lcpMs,
    cls: observed.cls,
    loadMs: observed.loadMs,
    encodedBytes: Math.round(encodedBytes)
  };
  await page.close();
  return {
    id: target.id,
    kind: target.kind,
    path: target.path,
    finalSameOrigin: finalUrl.origin === new URL(origin).origin,
    signals: {
      titlePresent: observed.titlePresent,
      h1Count: observed.h1,
      canonicalPresent: observed.canonical !== null,
      canonicalSameOrigin: observed.canonical ? new URL(observed.canonical).origin === new URL(origin).origin : false,
      noindex: observed.noindex,
      jsonLdCount: observed.jsonLd,
      productLinkCount: observed.productLinks,
      purchaseControlCount: observed.purchaseControls
    },
    requiredChecks,
    functionalPassed: finalUrl.origin === new URL(origin).origin && !observed.noindex && Object.values(requiredChecks).every(Boolean),
    metrics,
    budget: evaluateBudget(metrics, budgets),
    blockedMutationRequests
  };
}

export async function runBaseline(config, options = {}) {
  validateConfig(config);
  const executablePath = options.executablePath || process.env.ENKI_CHROME_PATH;
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  try {
    const context = await browser.newContext({
      viewport: config.environment.viewport,
      locale: config.environment.locale,
      timezoneId: config.environment.timezoneId,
      serviceWorkers: "block"
    });
    const targets = [];
    for (const target of config.targets) targets.push(await inspectTarget(context, config.origin, target, config.budgets));
    await context.close();
    return {
      schema: "enki-public-web-baseline/v1",
      observedAt: new Date().toISOString(),
      configVersion: config.version,
      origin: config.origin,
      environment: {...config.environment, userAgentRetained: false},
      safety: {...config.safety, blockedMutationRequests: targets.reduce((sum, item) => sum + item.blockedMutationRequests, 0)},
      targets,
      summary: {
        functionalPassed: targets.every((item) => item.functionalPassed),
        budgetsPassed: targets.every((item) => item.budget.passed),
        lighthouseAudit: "not_run_dependency_not_packaged",
        lighthouseClaimAllowed: false
      },
      authority: {isObservationOnly: true, isOptimizationAuthority: false, containsPii: false, containsCredentials: false}
    };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await readFile(process.argv[2] || defaultConfig, "utf8"));
  process.stdout.write(`${JSON.stringify(await runBaseline(config), null, 2)}\n`);
}
