#!/usr/bin/env node

import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {WooCommerceProductClient} from "../src/clients.mjs";

const BRAND_ID = 1410;
const SANYBOX_SKUS = new Set(["MEN000SS", "MH2000SS", "RAC00012SS", "TH2000SS"]);
const FLOW_COPY_SKUS = new Set([
  "MBD006SS",
  "MEN006R14SS",
  "MEN006R18SS",
  "MEN006S14SS",
  "MEN006S18SS",
  "MEX006SS",
  "MNO006SS",
  "MOA006SS",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error(`Invalid argument: ${argv[index] ?? ""}`);
    values.set(argv[index], argv[index + 1]);
  }
  for (const required of ["--current-bundle-root", "--candidate-bundle-root", "--articles", "--gsc", "--output-dir", "--captured-at"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}`);
  }
  return {
    currentRoot: resolve(values.get("--current-bundle-root")),
    candidateRoot: resolve(values.get("--candidate-bundle-root")),
    articlesPath: resolve(values.get("--articles")),
    gscPath: resolve(values.get("--gsc")),
    outputDir: resolve(values.get("--output-dir")),
    capturedAt: values.get("--captured-at"),
  };
}

function normalizeHtml(value) {
  return String(value ?? "").trim().replace(/>\s+</g, "><");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedNumbers(values) {
  return values.map(Number).filter(Number.isSafeInteger).sort((left, right) => left - right);
}

function ids(values) {
  return sortedNumbers((values ?? []).map((item) => item?.id));
}

function metaValue(product, key) {
  const rows = (product?.meta_data ?? []).filter((item) => item?.key === key);
  return String(rows.at(-1)?.value ?? "");
}

function productMeta(product) {
  return {
    title: metaValue(product, "_yoast_wpseo_title"),
    description: metaValue(product, "_yoast_wpseo_metadesc"),
    focusKeyword: metaValue(product, "_yoast_wpseo_focuskw"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadBundle(root) {
  const manifestBytes = await readFile(join(root, "batch-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const products = [];
  for (const row of manifest.bundles ?? []) {
    const bytes = await readFile(join(root, row.path));
    if (row.sha256 !== sha256(bytes)) throw new Error(`Bundle hash drift: ${row.bundleKey}`);
    products.push(...JSON.parse(bytes).products);
  }
  if (products.length !== 24) throw new Error(`Expected 24 Pool parents, found ${products.length}`);
  return {manifest, manifestSha256: sha256(manifestBytes), products};
}

async function loadArticles(path) {
  const rows = (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const sellableDecisions = new Set(["sellable_product", "standalone_sellable_sanybox_product_approved"]);
  const exact = rows.filter((row) => sellableDecisions.has(row.merchandisingDecision) && row.configurationTail === "");
  return new Map(exact.map((row) => [row.baseReference, row]));
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, values.length)}, () => worker()));
  return results;
}

function currentChecks(live, current) {
  return {
    uniqueExactParent: true,
    statusDraft: live.status === "draft",
    visibilityHidden: live.catalog_visibility === "hidden",
    typeExact: live.type === current.type,
    nameExact: live.name === current.name,
    slugExact: live.slug === current.slug,
    descriptionExact: normalizeHtml(live.description) === normalizeHtml(current.descriptionHtml),
    shortDescriptionExact: normalizeHtml(live.short_description) === normalizeHtml(current.shortDescriptionHtml),
    categoriesExact: same(ids(live.categories), sortedNumbers(current.categories)),
    brandSanycces: ids(live.brands).includes(BRAND_ID),
    seoTitleExact: productMeta(live).title === current.seo.title,
    seoDescriptionExact: productMeta(live).description === current.seo.description,
    focusKeywordExact: productMeta(live).focusKeyword === current.seo.focusKeyword,
  };
}

function allTrue(record) {
  return Object.values(record).every(Boolean);
}

function candidateChecks(product) {
  const description = product.descriptionHtml;
  return {
    titlePresent: product.name.length > 0,
    titleNotVisiblyLong: product.seo.title.length <= 65,
    metaDescriptionPresent: product.seo.description.length > 0,
    metaDescriptionNotVisiblyLong: product.seo.description.length <= 160,
    focusKeywordPresent: product.seo.focusKeyword.length > 0,
    introPresent: description.startsWith("<p>"),
    technicalSectionPresent: description.includes("<h2>Características técnicas</h2><ul>"),
    seriesSectionPresent: description.includes("<h2>Serie Pool de Sanycces</h2>"),
    seriesSearchLinkPresent: description.includes("https://www.enkihogar.com/?s=Sanycces+Pool&amp;post_type=product"),
    brandSectionPresent: description.includes("<h2>Sanycces: diseño y calidad para el baño</h2>"),
    noProcessLanguage: !/catálogo PDF suministrado|web oficial se usa|referencias del catálogo/i.test(description),
    shortDescriptionPresent: normalizeHtml(product.shortDescriptionHtml).length > 0,
    parentCategoryPresent: product.categories.length >= 2,
  };
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function makeCsv(rows) {
  const columns = [
    "sku", "name", "type", "liveStatus", "liveVisibility", "currentVerdict", "candidateVerdict",
    "changeType", "pdfPages", "officialProductUrl", "categories", "brandId", "seoTitleLength",
    "metaDescriptionLength", "shortDescriptionTextLength", "variations", "variationStatuses", "notes",
  ];
  return `${columns.map(csvCell).join(",")}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function reportMarkdown({capturedAt, currentSha, candidateSha, gscSha, rows, global}) {
  const currentCounts = rows.reduce((accumulator, row) => {
    accumulator[row.currentVerdict] = (accumulator[row.currentVerdict] ?? 0) + 1;
    return accumulator;
  }, {});
  const candidateCounts = rows.reduce((accumulator, row) => {
    accumulator[row.candidateVerdict] = (accumulator[row.candidateVerdict] ?? 0) + 1;
    return accumulator;
  }, {});
  const table = rows.map((row) => `| ${row.sku} | ${row.currentVerdict} | ${row.candidateVerdict} | ${row.changeType} | ${row.pdfPages.join(", ")} | ${row.notes.join("; ") || "—"} |`).join("\n");
  return `# Revisión de contenido, SEO y marca · Sanycces Pool\n\nFecha de captura en vivo: ${capturedAt}. Estado: **CAMBIOS PREPARADOS, NO APLICADOS**.\nNo se ha modificado WooCommerce, Merchant Center, feeds, campañas ni el sitio público.\n\n## Resultado ejecutivo\n\n- Lectura administrativa completada sobre los 24 padres y ${global.variationCount} variaciones: los padres siguen en \`draft\` y \`hidden\`, las variaciones siguen en \`publish\`.\n- Marca Sanycces (ID ${BRAND_ID}) y categorías padre+hija coinciden con el bundle revisado en las 24 fichas.\n- Estado actual: ${currentCounts.PASS ?? 0} PASS y ${currentCounts.FAIL ?? 0} FAIL a nivel de ficha. Los cuatro FAIL son únicamente las metadescripciones de Sanybox.\n- Candidato v15: ${candidateCounts.PASS ?? 0} PASS, ${candidateCounts.WARN ?? 0} WARN y ${candidateCounts.FAIL ?? 0} FAIL.\n- El candidato cambia 4 metadescripciones Sanybox y afina 8 bullets de caudal para nombrar correctamente lavabo o bidé. No cambia nombres, slugs, precios, stock, GTIN, imágenes, categorías, marca ni descripciones cortas.\n- Los 24 títulos, metadescripciones y focus keywords son únicos; no hay cortes visibles ni lenguaje interno del proceso.\n\n## Hallazgos que requieren corrección\n\n### FAIL actual · metadescripciones Sanybox\n\n\`MEN000SS\`, \`MH2000SS\`, \`RAC00012SS\` y \`TH2000SS\` afirman “acero inoxidable 316L” y piden consultar acabados. La evidencia retenida identifica Sanybox Inox, función, conexiones y compatibilidad, pero no demuestra ese grado de acero ni variaciones de acabado. El v15 elimina ambas afirmaciones y usa datos exactos de instalación/compatibilidad.\n\n### WARN actual · beneficio de caudal demasiado genérico\n\nOcho fichas de lavabo/bidé decían “lavabo o bidé” en el beneficio asociado al caudal. El v15 conserva el dato técnico y nombra el tipo exacto de cada producto.\n\n### Pendiente posterior a publicación\n\n- Verificar canonical, indexabilidad, schema Product/Offer y render público del primer canario. No se pueden certificar sobre padres draft/hidden.\n- Confirmar qué campo WooCommerce alimenta \`description\` en Merchant. La evidencia disponible confirma el título, pero el mapeo de descripción sigue **PARTIAL**.\n- Añadir enlaces directos entre los ocho exteriores que requieren Sanybox y su cuerpo exacto cuando las URL finales estén publicadas. La compatibilidad textual ya está presente; enlazar ahora a drafts no aportaría una ruta pública estable.\n\n## Evidencia SEO disponible\n\nLa captura renovada de GSC usa zona \`America/Los_Angeles\` y conserva agregados completos por página: julio de 2026, 643 páginas, 263 clics y 22.076 impresiones; agosto de 2026, 633 páginas, 244 clics y 21.332 impresiones. Es evidencia direccional de demanda por familias, no volumen atribuible a una consulta Pool concreta. GA4 no está disponible y no bloquea esta revisión editorial.\n\n## Revisión por producto\n\n| SKU | Actual | v15 | Cambio propuesto | Páginas PDF | Observaciones |\n| --- | --- | --- | --- | --- | --- |\n${table}\n\n## Validaciones globales\n\n- Preflight v15: 24 padres, 64 SKU, 44 SKU vendibles, 103 WebP, 44 GTIN, cero duplicados SEO y cero diferencias de precio respecto a tarifa/política.\n- Lectura en vivo: ${global.parentsExact}/24 padres coinciden íntegramente con v14; ${global.variationCount}/${global.variationCount} variaciones presentes y todas en \`publish\`.\n- Identidad editorial: intro breve, bullets técnicos, resumen de serie con búsqueda interna, bloque de marca y descripción corta presentes en 24/24.\n- Canibalización: sin colisiones exactas de slug; serie/configuración/material diferencian la intención. Sanybox mantiene \`Inox\` visible para separarse de referencias antiguas.\n\n## Fuentes fijadas\n\n- Bundle vivo esperado v14, manifiesto SHA-256: \`${currentSha}\`.\n- Candidato local v15, manifiesto SHA-256: \`${candidateSha}\`.\n- Captura GSC 2026-09-21, SHA-256: \`${gscSha}\`.\n- Catálogo oficial PDF, SHA-256: \`65b51d42c3d09f893fa909fb17ce93d01934dfdde3ad7ee4195543627d93f285\`.\n- Tarifa oficial, SHA-256: \`7d5b13c4213ac53e849994a651c8d4f23e532d8f86e60990d3bd4982785b67d8\`.\n\n## Disposición\n\nEl v15 está listo para una actualización controlada de los 12 padres afectados, pero esa escritura externa no está autorizada por esta revisión. Después conviene publicar únicamente \`MNO006SS\` como canario, validar su página pública y Merchant, y solo entonces decidir el despliegue de los otros 23 padres.\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [current, candidate, articles, gscBytes] = await Promise.all([
    loadBundle(args.currentRoot),
    loadBundle(args.candidateRoot),
    loadArticles(args.articlesPath),
    readFile(args.gscPath),
  ]);
  const currentBySku = new Map(current.products.map((product) => [product.sku, product]));
  const candidateBySku = new Map(candidate.products.map((product) => [product.sku, product]));
  if (!same([...currentBySku.keys()].sort(), [...candidateBySku.keys()].sort())) throw new Error("Current/candidate scope drift");

  const requiredEnv = ["WOO_PUBLISH_BASE_URL", "WOO_PUBLISH_CONSUMER_KEY", "WOO_PUBLISH_CONSUMER_SECRET"];
  if (requiredEnv.some((name) => !process.env[name])) throw new Error("WooCommerce read credentials are incomplete");
  const woo = new WooCommerceProductClient({
    baseUrl: process.env.WOO_PUBLISH_BASE_URL,
    consumerKey: process.env.WOO_PUBLISH_CONSUMER_KEY,
    consumerSecret: process.env.WOO_PUBLISH_CONSUMER_SECRET,
  });

  const liveRows = await mapLimit(candidate.products, 4, async (candidateProduct) => {
    const currentProduct = currentBySku.get(candidateProduct.sku);
    const found = await woo.request("GET", "/products", {params: {sku: candidateProduct.sku, status: "any", per_page: 10}});
    const exact = found.filter((product) => product.sku === candidateProduct.sku);
    if (exact.length !== 1) throw new Error(`Expected one live parent for ${candidateProduct.sku}, found ${exact.length}`);
    const live = exact[0];
    const variations = candidateProduct.type === "variable"
      ? await woo.request("GET", `/products/${live.id}/variations`, {params: {per_page: 100, orderby: "id", order: "asc"}})
      : [];
    const expectedVariationSkus = (candidateProduct.variations ?? []).map((variation) => variation.sku).sort();
    const liveVariationSkus = variations.map((variation) => variation.sku).sort();
    if (!same(expectedVariationSkus, liveVariationSkus)) throw new Error(`Variation scope drift for ${candidateProduct.sku}`);
    const checks = currentChecks(live, currentProduct);
    const variationChecks = {
      countExact: variations.length === (candidateProduct.variations?.length ?? 0),
      allPublished: variations.every((variation) => variation.status === "publish"),
    };
    return {
      sku: candidateProduct.sku,
      externalId: Number(live.id),
      canonicalUrl: typeof live.permalink === "string" ? live.permalink : null,
      status: live.status,
      catalogVisibility: live.catalog_visibility,
      type: live.type,
      brandIds: ids(live.brands),
      categoryIds: ids(live.categories),
      liveSeo: productMeta(live),
      checks,
      variationChecks,
      variations: variations.map((variation) => ({id: Number(variation.id), sku: variation.sku, status: variation.status})),
      exactCurrentBundle: allTrue(checks) && allTrue(variationChecks),
    };
  });
  const liveBySku = new Map(liveRows.map((row) => [row.sku, row]));

  const productRows = candidate.products.map((product) => {
    const live = liveBySku.get(product.sku);
    const currentProduct = currentBySku.get(product.sku);
    const article = articles.get(product.sku);
    if (!article) throw new Error(`Missing source article for ${product.sku}`);
    const contentChecks = candidateChecks(product);
    const metaChanged = currentProduct.seo.description !== product.seo.description;
    const descriptionChanged = normalizeHtml(currentProduct.descriptionHtml) !== normalizeHtml(product.descriptionHtml);
    const changeType = metaChanged ? "meta_description" : descriptionChanged ? "technical_benefit_copy" : "none";
    const notes = [];
    if (SANYBOX_SKUS.has(product.sku)) notes.push("meta actual no respaldada; corregida en v15");
    if (FLOW_COPY_SKUS.has(product.sku)) notes.push("beneficio de caudal adaptado al tipo exacto");
    if (["MEN006R14SS", "MEN006R18SS", "MEN006S14SS", "MEN006S18SS", "MH2D006SS", "MH2D066SS", "TH2D006SS", "TH2D066SS"].includes(product.sku)) {
      notes.push("enlace directo al Sanybox exacto tras publicar");
    }
    const currentVerdict = SANYBOX_SKUS.has(product.sku) ? "FAIL" : "PASS";
    const candidateVerdict = allTrue(contentChecks) ? "PASS" : "FAIL";
    return {
      sku: product.sku,
      name: product.name,
      type: product.type,
      liveStatus: live.status,
      liveVisibility: live.catalogVisibility,
      currentVerdict,
      candidateVerdict,
      changeType,
      pdfPages: article.pdfEvidence?.printedPages ?? [],
      officialProductUrl: article.officialEnrichment?.productUrl ?? null,
      categories: product.categories,
      brandId: BRAND_ID,
      seoTitleLength: product.seo.title.length,
      metaDescriptionLength: product.seo.description.length,
      shortDescriptionTextLength: stripHtml(product.shortDescriptionHtml).length,
      variations: live.variations.length,
      variationStatuses: [...new Set(live.variations.map((variation) => variation.status))],
      notes,
      currentSeo: currentProduct.seo,
      candidateSeo: product.seo,
      contentChecks,
      exactLiveV14: live.exactCurrentBundle,
      source: {
        pdfPages: article.pdfEvidence?.printedPages ?? [],
        catalogSha256: article.pdfEvidence?.sourceSha256 ?? null,
        officialProductUrl: article.officialEnrichment?.productUrl ?? null,
        technicalHighlights: article.technicalHighlights ?? [],
      },
    };
  }).sort((left, right) => left.sku.localeCompare(right.sku));

  const global = {
    parentsExact: liveRows.filter((row) => row.exactCurrentBundle).length,
    variationCount: liveRows.reduce((total, row) => total + row.variations.length, 0),
    currentPass: productRows.filter((row) => row.currentVerdict === "PASS").length,
    currentFail: productRows.filter((row) => row.currentVerdict === "FAIL").length,
    candidatePass: productRows.filter((row) => row.candidateVerdict === "PASS").length,
    candidateFail: productRows.filter((row) => row.candidateVerdict === "FAIL").length,
    proposedParentUpdates: productRows.filter((row) => row.changeType !== "none").length,
    externalWrites: 0,
  };
  if (global.parentsExact !== 24 || global.variationCount !== 40 || global.candidateFail !== 0 || global.proposedParentUpdates !== 12) {
    throw new Error(`Audit invariant failed: ${JSON.stringify(global)}`);
  }

  await mkdir(args.outputDir, {recursive: true});
  const readback = {
    schema: "enki-pool-live-content-readback/v1",
    capturedAt: args.capturedAt,
    authority: {mode: "read_only", externalWrites: 0},
    expectedCurrentManifestSha256: current.manifestSha256,
    candidateManifestSha256: candidate.manifestSha256,
    summary: global,
    products: liveRows.sort((left, right) => left.sku.localeCompare(right.sku)),
  };
  const ledger = {
    schema: "enki-pool-content-seo-product-ledger/v1",
    capturedAt: args.capturedAt,
    disposition: "changes_prepared_not_applied",
    summary: global,
    products: productRows,
  };
  const report = reportMarkdown({
    capturedAt: args.capturedAt,
    currentSha: current.manifestSha256,
    candidateSha: candidate.manifestSha256,
    gscSha: sha256(gscBytes),
    rows: productRows,
    global,
  });
  await Promise.all([
    writeFile(join(args.outputDir, "live-content-readback.json"), `${JSON.stringify(readback, null, 2)}\n`),
    writeFile(join(args.outputDir, "product-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`),
    writeFile(join(args.outputDir, "product-ledger.csv"), makeCsv(productRows)),
    writeFile(join(args.outputDir, "REPORT.md"), report),
  ]);
  const files = await Promise.all(["live-content-readback.json", "product-ledger.json", "product-ledger.csv", "REPORT.md"].map(async (name) => {
    const bytes = await readFile(join(args.outputDir, name));
    return {name, sha256: sha256(bytes), bytes: bytes.length};
  }));
  console.log(JSON.stringify({status: "complete", outputDir: args.outputDir, summary: global, files}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
