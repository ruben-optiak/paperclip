#!/usr/bin/env node
import {readFile, mkdir, readdir, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseCsv} from "../../connectors/catalog-knowledge/src/csv.mjs";
import {sha256, slugify} from "../../connectors/catalog-knowledge/src/normalization.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_FILES = [
  "technical_entities.csv",
  "technical_facts.csv",
  "technical_relations.csv",
  "configuration_rules.csv",
  "sku_crosswalk.csv",
  "support_chunks.jsonl",
];
const OUTPUT_FILES = new Set(["manifest.json", ...DATA_FILES]);

const HEADERS = {
  "technical_entities.csv": ["entity_key", "entity_kind", "manufacturer_ref", "name", "series", "category", "summary"],
  "technical_facts.csv": ["entity_key", "fact_key", "value", "unit", "applicability", "evidence_ref", "source_page", "confidence"],
  "technical_relations.csv": ["from_entity_key", "relation_type", "to_entity_key", "condition_json", "evidence_ref", "source_page"],
  "configuration_rules.csv": ["entity_key", "rule_key", "axis", "representation", "affects_sku", "affects_price", "affects_stock", "allowed_values_json", "condition_json", "effect_json", "evidence_ref", "source_page"],
  "sku_crosswalk.csv": ["entity_key", "manufacturer_ref", "woo_parent_sku", "woo_variation_sku", "mapping_kind", "evidence_ref", "approved_by", "approved_at"],
};

const SOURCE_FILES = {
  catalog: "productos/enki-hogar/precios-oficiales/2026-05-31/Espejos Catalog 2026.pdf",
  master: "productos/enki-hogar/normalizado/2026-05-31/pdf_catalog_master.csv",
  qaIssues: "productos/enki-hogar/qa/2026-05-31/pdf_extraction_issues.csv",
  qaQueue: "productos/enki-hogar/qa/2026-05-31/pdf_validation_queue.csv",
  decisions: "productos/enki-hogar/README.md",
  parents: "productos/enki-hogar/exports/2026-05-31/export_altas_enki_hogar_espejos_variables_woocommerce_native_parents.csv",
  variations: "productos/enki-hogar/exports/2026-05-31/export_altas_enki_hogar_espejos_variables_woocommerce_native_variations.csv",
  publication: "productos/enki-hogar/analisis/2026-05-31/wp-publish-2026-06-01.md",
};

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(value, label) {
  const cleaned = String(value || "").trim();
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers, rows) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

function sameValues(left, right) {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function dimensionLabel(row) {
  if (row.diameter_cm) return `Ø${row.diameter_cm} cm`;
  if (row.width_cm && row.height_cm) return `${row.width_cm} x ${row.height_cm} cm`;
  throw new Error(`Missing normalized dimensions for ${row.sku}`);
}

async function prepareOutput(directory) {
  await mkdir(directory, {recursive: true});
  const existing = await readdir(directory);
  const unexpected = existing.filter((name) => !OUTPUT_FILES.has(name));
  if (unexpected.length > 0) throw new Error(`Refusing output directory with unexpected files: ${unexpected.join(", ")}`);
}

function makeSources(sourceBuffers, liveSnapshotBuffer) {
  return [
    ["enki-espejos-catalog", "Catálogo oficial Enki Espejos", "manufacturer_catalog", "enki-source://enki/espejos/catalog/2026-05-31", "2026-05-31", sourceBuffers.catalog],
    ["enki-espejos-master", "Master técnico normalizado Enki Espejos", "normalized_master", "enki-source://enki/espejos/normalized/2026-05-31", "2026-05-31", sourceBuffers.master],
    ["enki-espejos-qa-issues", "Resultado de incidencias de extracción Enki Espejos", "qa_result", "enki-source://enki/espejos/qa/issues/2026-05-31", "2026-05-31", sourceBuffers.qaIssues],
    ["enki-espejos-qa-queue", "Cola de validación Enki Espejos", "qa_result", "enki-source://enki/espejos/qa/queue/2026-05-31", "2026-05-31", sourceBuffers.qaQueue],
    ["enki-espejos-decisions", "Decisiones operativas Enki Espejos", "manual_review", "enki-source://enki/espejos/decisions/2026-06-01", "2026-06-01", sourceBuffers.decisions],
    ["enki-espejos-parent-export", "Identidades padre del lote publicado", "publication_evidence", "enki-source://enki/espejos/woocommerce/parents/2026-06-01", "2026-06-01", sourceBuffers.parents],
    ["enki-espejos-variation-export", "Identidades de variación del lote publicado", "publication_evidence", "enki-source://enki/espejos/woocommerce/variations/2026-06-01", "2026-06-01", sourceBuffers.variations],
    ["enki-espejos-publication", "Registro de publicación Enki Espejos", "publication_evidence", "enki-source://enki/espejos/publication/2026-06-01", "2026-06-01", sourceBuffers.publication],
    ["enki-espejos-live-identity", "Verificación WooCommerce read-only de padres y variaciones", "live_identity_snapshot", "enki-source://enki/espejos/woocommerce/identity/2026-08-31", "2026-08-31", liveSnapshotBuffer],
  ].map(([sourceKey, title, kind, locator, snapshotDate, content]) => ({
    sourceKey,
    title,
    kind,
    locator,
    snapshotDate,
    sha256: sha256(content),
  }));
}

export async function generateEnkiMirrorsReview({sourceRoot, outputDirectory, version = "1.0.0"}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("version must be semver x.y.z");
  const sourceBuffers = {};
  for (const [key, relativePath] of Object.entries(SOURCE_FILES)) {
    sourceBuffers[key] = await readFile(join(sourceRoot, relativePath));
  }
  const liveSnapshotPath = join(PACKAGE_ROOT, "references/product-support/source-snapshots/enki/espejos/2026-08-31/woo-identity.json");
  const liveSnapshotBuffer = await readFile(liveSnapshotPath);
  const liveSnapshot = JSON.parse(liveSnapshotBuffer.toString("utf8"));
  assert(liveSnapshot.schema === "enki-woo-identity-snapshot/v1", "Unexpected Woo identity snapshot schema");
  assert(Array.isArray(liveSnapshot.products), "Woo identity snapshot products must be an array");

  const masterAll = parseCsv(sourceBuffers.master.toString("utf8"));
  const master = masterAll.filter((row) => row.upload_scope === "current_espejos");
  const qaIssues = parseCsv(sourceBuffers.qaIssues.toString("utf8"));
  const qaQueue = parseCsv(sourceBuffers.qaQueue.toString("utf8"));
  const parents = parseCsv(sourceBuffers.parents.toString("utf8"));
  const variations = parseCsv(sourceBuffers.variations.toString("utf8"));
  assert(master.length === 33, `Expected 33 current mirror references, got ${master.length}`);
  assert(new Set(master.map((row) => row.sku)).size === master.length, "Master contains duplicate references");
  assert(master.every((row) => row.extraction_status === "parsed_from_pdf" && !row.qa_flags), "Master contains unresolved extraction or QA rows");
  assert(qaIssues.length === 0, "PDF extraction issues must be empty before support-pack generation");
  assert(qaQueue.length === 0, "PDF validation queue must be empty before support-pack generation");
  assert(parents.length === 10, `Expected 10 parent rows, got ${parents.length}`);
  assert(variations.length === 33, `Expected 33 variation rows, got ${variations.length}`);

  const variationByRef = new Map(variations.map((row) => [row["meta:_enki_original_pdf_sku"], row]));
  const parentBySku = new Map(parents.map((row) => [row.SKU, row]));
  const liveByParent = new Map(liveSnapshot.products.map((row) => [row.parentSku, row]));
  const groups = Object.values(Object.groupBy(master, (row) => row.model));
  assert(groups.length === 10, `Expected 10 mirror models, got ${groups.length}`);

  const entities = [];
  const facts = [];
  const relations = [];
  const rules = [];
  const crosswalk = [];
  const chunks = [];

  function addFact(entityKey, factKey, value, unit, applicability, evidenceRef, sourcePage) {
    if (value === undefined || value === null || String(value).trim() === "") return;
    facts.push({
      entity_key: entityKey,
      fact_key: factKey,
      value: String(value).trim(),
      unit: unit || "",
      applicability,
      evidence_ref: evidenceRef,
      source_page: sourcePage || "",
      confidence: "1",
    });
  }

  for (const rows of groups) {
    const first = rows[0];
    const modelKey = slugify(first.model);
    const page = first.source_page;
    const catalogEvidence = `enki-espejos-catalog#page=${page}`;
    const variationRows = rows.map((row) => {
      const variation = variationByRef.get(row.sku);
      assert(variation, `Missing variation export mapping for ${row.sku}`);
      return {master: row, variation};
    });
    const parentSkus = new Set(variationRows.map(({variation}) => variation.Parent));
    assert(parentSkus.size === 1, `Model ${first.model} maps to multiple Woo parents`);
    const parentSku = [...parentSkus][0];
    assert(parentBySku.has(parentSku), `Missing parent export row ${parentSku}`);
    const live = liveByParent.get(parentSku);
    assert(live?.status === "publish" && live?.type === "variable", `Live parent ${parentSku} is not one published variable product`);
    const variationSkus = variationRows.map(({variation}) => variation.SKU);
    assert(sameValues(live.variationSkus, variationSkus), `Live Woo variations differ for ${parentSku}`);

    entities.push({
      entity_key: modelKey,
      entity_kind: "model",
      manufacturer_ref: first.model,
      name: `Espejo ${first.model}`,
      series: first.model,
      category: "espejos",
      summary: `${first.product_type} de forma ${first.shape}. La medida es el único eje de variación estructural aprobado para esta familia.`,
    });

    const modelFacts = [
      ["product_type", first.product_type, ""],
      ["shape", first.shape, ""],
      ["orientation", first.orientation, ""],
      ["crystal_thickness", first.crystal_thickness_mm, "mm"],
      ["installation", first.installation, ""],
      ["electrical_connection", first.electrical_connection, ""],
      ["lighting_type", first.lighting_type, ""],
      ["light_direction", first.light_direction, ""],
      ["touch_on_off", first.touch_on_off, ""],
      ["touch_antifog", first.touch_antivaho, ""],
      ["light_temperature", first.temp_light_k, "K"],
      ["magnification", first.magnification, ""],
      ["bluetooth", first.bluetooth, ""],
      ["wireless_charging", first.wireless_charging, ""],
      ["frame_material", first.frame_material, ""],
      ["back_frame_material", first.back_frame_material, ""],
      ["edge_or_frame", first.edge_or_frame, ""],
      ["finish", first.finish, ""],
      ["finish_code", first.finish_code, ""],
      ["anti_corrosion", first.anti_corrosion, ""],
      ["protective_film", first.protective_film, ""],
      ["ce_mark", first.ce_mark, ""],
      ["ip_rating", first.ip_rating, ""],
    ];
    for (const [factKey, value, unit] of modelFacts) addFact(modelKey, factKey, value, unit, "model", catalogEvidence, page);

    const labels = [];
    crosswalk.push({
      entity_key: modelKey,
      manufacturer_ref: first.model,
      woo_parent_sku: parentSku,
      woo_variation_sku: "",
      mapping_kind: "parent",
      evidence_ref: `enki-espejos-live-identity#parent=${parentSku}`,
      approved_by: "",
      approved_at: "",
    });

    for (const {master: row, variation} of variationRows) {
      const variantKey = `${modelKey}-${row.sku.toLocaleLowerCase("es")}`;
      const label = dimensionLabel(row);
      labels.push(label);
      entities.push({
        entity_key: variantKey,
        entity_kind: "variant",
        manufacturer_ref: row.sku,
        name: `Espejo ${row.model} ${label}`,
        series: row.model,
        category: "espejos",
        summary: `Variante técnica ${label}, vinculada a la referencia oficial ${row.sku}.`,
      });
      addFact(variantKey, "dimensions", label, "", "variant", catalogEvidence, page);
      addFact(variantKey, "width", row.width_cm, "cm", "variant", catalogEvidence, page);
      addFact(variantKey, "height", row.height_cm, "cm", "variant", catalogEvidence, page);
      addFact(variantKey, "diameter", row.diameter_cm, "cm", "variant", catalogEvidence, page);
      relations.push({
        from_entity_key: variantKey,
        relation_type: "variant_of",
        to_entity_key: modelKey,
        condition_json: "{}",
        evidence_ref: catalogEvidence,
        source_page: page,
      });
      crosswalk.push({
        entity_key: variantKey,
        manufacturer_ref: row.sku,
        woo_parent_sku: "",
        woo_variation_sku: variation.SKU,
        mapping_kind: "variation",
        evidence_ref: `enki-espejos-live-identity#variation=${variation.SKU}`,
        approved_by: "",
        approved_at: "",
      });
    }

    rules.push({
      entity_key: modelKey,
      rule_key: "measure",
      axis: "medida",
      representation: "variation",
      affects_sku: "true",
      affects_price: "true",
      affects_stock: "true",
      allowed_values_json: JSON.stringify(labels),
      condition_json: "{}",
      effect_json: JSON.stringify({requires_live_price: true, reference_strategy: "approved_crosswalk"}),
      evidence_ref: `enki-espejos-publication#parent=${parentSku}`,
      source_page: "",
    });

    chunks.push({
      chunk_key: `${modelKey}-technical-overview`,
      entity_key: modelKey,
      topic: "faq",
      content: first.description_from_pdf,
      evidence_ref: catalogEvidence,
      source_page: page,
    });
    const installationParts = [`Instalación: ${first.installation}.`];
    if (first.electrical_connection && first.electrical_connection !== "no") installationParts.push(`Conexión eléctrica: ${first.electrical_connection}.`);
    installationParts.push("Confirmar siempre en WooCommerce la variante actualmente vendible antes de recomendar una compra.");
    chunks.push({
      chunk_key: `${modelKey}-installation`,
      entity_key: modelKey,
      topic: "installation",
      content: installationParts.join(" "),
      evidence_ref: catalogEvidence,
      source_page: page,
    });
  }

  const data = {
    "technical_entities.csv": csv(HEADERS["technical_entities.csv"], entities),
    "technical_facts.csv": csv(HEADERS["technical_facts.csv"], facts),
    "technical_relations.csv": csv(HEADERS["technical_relations.csv"], relations),
    "configuration_rules.csv": csv(HEADERS["configuration_rules.csv"], rules),
    "sku_crosswalk.csv": csv(HEADERS["sku_crosswalk.csv"], crosswalk),
    "support_chunks.jsonl": `${chunks.map((chunk) => JSON.stringify(chunk)).join("\n")}\n`,
  };
  const sources = makeSources(sourceBuffers, liveSnapshotBuffer);
  const sourceRevision = sha256(`${sources.map((source) => `${source.sourceKey}\u0000${source.sha256}`).sort().join("\n")}\n`);
  const rowCounts = {
    "technical_entities.csv": entities.length,
    "technical_facts.csv": facts.length,
    "technical_relations.csv": relations.length,
    "configuration_rules.csv": rules.length,
    "sku_crosswalk.csv": crosswalk.length,
    "support_chunks.jsonl": chunks.length,
  };
  const manifest = {
    schema: "enki-product-support-pack/v1",
    packKey: "enki-espejos-support",
    version,
    brand: {slug: "enki", name: "Enki Hogar"},
    domain: {slug: "espejos", name: "Espejos"},
    snapshotDate: liveSnapshot.observedAt.slice(0, 10),
    approval: {state: "review_required", approvedBy: null, approvedAt: null},
    sourceRepository: {
      locator: "enki-source://enki-hogar/productos/enki-hogar/espejos",
      revisionKind: "source_snapshot_sha256",
      revision: sourceRevision,
    },
    files: Object.fromEntries(DATA_FILES.map((filename) => [filename, {sha256: sha256(data[filename]), rows: rowCounts[filename]}])),
    sources,
  };

  await prepareOutput(outputDirectory);
  for (const filename of DATA_FILES) await writeFile(join(outputDirectory, filename), data[filename], "utf8");
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    state: manifest.approval.state,
    pack_key: manifest.packKey,
    version,
    source_revision_kind: manifest.sourceRepository.revisionKind,
    source_revision: sourceRevision,
    counts: {
      models: groups.length,
      variants: master.length,
      ...rowCounts,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = resolve(required(process.env.ENKI_KNOWLEDGE_SOURCE, "ENKI_KNOWLEDGE_SOURCE"));
  const outputDirectory = resolve(required(options.output, "--output"));
  const result = await generateEnkiMirrorsReview({sourceRoot, outputDirectory, version: options.version || "1.0.0"});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`generate-enki-espejos: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
