import {lstat, readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {parseCsv} from "./csv.mjs";
import {
  assertDate,
  assertEntityKey,
  assertInstant,
  assertLogicalLocator,
  assertSafeText,
  assertSlug,
  assertTechnicalFactKey,
  evidenceSourceKey,
  parseBoolean,
  parseJson,
  sha256,
} from "./normalization.mjs";

export const SUPPORT_PACK_SCHEMA = "enki-product-support-pack/v1";
export const DATA_FILES = Object.freeze([
  "technical_entities.csv",
  "technical_facts.csv",
  "technical_relations.csv",
  "configuration_rules.csv",
  "sku_crosswalk.csv",
  "support_chunks.jsonl",
]);

const MAX_PACK_BYTES = 50 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const SOURCE_SNAPSHOT_REVISION = /^[0-9a-f]{64}$/;
const REVISION_KINDS = new Set(["git_commit", "source_snapshot_sha256"]);
const ENTITY_KINDS = new Set(["family", "model", "variant", "component", "accessory"]);
const RELATIONS = new Set(["variant_of", "compatible_with", "requires", "excludes", "component_of", "accessory_for"]);
const REPRESENTATIONS = new Set(["variation", "configurator_option", "component_product", "assisted_sale"]);
const MAPPING_KINDS = new Set(["exact", "approved_alias", "parent", "variation", "component"]);
const TOPICS = new Set(["installation", "maintenance", "warranty", "faq", "material", "compatibility", "configuration", "care", "inclusion", "exclusion"]);

const HEADERS = Object.freeze({
  "technical_entities.csv": ["entity_key", "entity_kind", "manufacturer_ref", "name", "series", "category", "summary"],
  "technical_facts.csv": ["entity_key", "fact_key", "value", "unit", "applicability", "evidence_ref", "source_page", "confidence"],
  "technical_relations.csv": ["from_entity_key", "relation_type", "to_entity_key", "condition_json", "evidence_ref", "source_page"],
  "configuration_rules.csv": ["entity_key", "rule_key", "axis", "representation", "affects_sku", "affects_price", "affects_stock", "allowed_values_json", "condition_json", "effect_json", "evidence_ref", "source_page"],
  "sku_crosswalk.csv": ["entity_key", "manufacturer_ref", "woo_parent_sku", "woo_variation_sku", "mapping_kind", "evidence_ref", "approved_by", "approved_at"],
});

function unique(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new Error(`${label} contains duplicate key: ${value}`);
    seen.add(value);
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function validHash(value, label) {
  if (!HASH.test(value || "")) throw new Error(`${label} must be a sha256`);
  return value;
}

function normalizeManifest(raw, {requireApproval = true} = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("manifest.json must contain an object");
  if (raw.schema !== SUPPORT_PACK_SCHEMA) throw new Error(`manifest schema must be ${SUPPORT_PACK_SCHEMA}`);
  const brandSlug = assertSlug(raw.brand?.slug, "manifest brand.slug");
  const domainSlug = assertSlug(raw.domain?.slug, "manifest domain.slug");
  const packKey = assertSlug(raw.packKey, "manifest packKey");
  if (packKey !== `${brandSlug}-${domainSlug}-support`) throw new Error("manifest packKey must be <brand>-<domain>-support");
  const version = String(raw.version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("manifest version must be semver x.y.z");
  const approvalState = String(raw.approval?.state || "").trim();
  if (requireApproval && approvalState !== "approved") throw new Error("support packs must be approved before import");
  if (!requireApproval && !new Set(["approved", "review_required"]).has(approvalState)) {
    throw new Error("support pack review state must be approved or review_required");
  }
  const revisionKind = String(raw.sourceRepository?.revisionKind || "git_commit").trim();
  if (!REVISION_KINDS.has(revisionKind)) throw new Error("manifest sourceRepository.revisionKind is invalid");
  const revision = String(raw.sourceRepository?.revision || "").trim().toLowerCase();
  if (revisionKind === "git_commit" && !GIT_REVISION.test(revision)) {
    throw new Error("manifest sourceRepository.revision must be a full immutable Git commit");
  }
  if (revisionKind === "source_snapshot_sha256" && !SOURCE_SNAPSHOT_REVISION.test(revision)) {
    throw new Error("manifest sourceRepository.revision must be a source snapshot sha256");
  }
  const sources = Array.isArray(raw.sources) ? raw.sources.map((source, index) => ({
    sourceKey: assertSlug(source?.sourceKey, `manifest sources[${index}].sourceKey`),
    title: assertSafeText(source?.title, `manifest sources[${index}].title`, {max: 300}),
    kind: assertEntityKey(source?.kind, `manifest sources[${index}].kind`),
    locator: assertLogicalLocator(source?.locator, `manifest sources[${index}].locator`),
    snapshotDate: assertDate(source?.snapshotDate, `manifest sources[${index}].snapshotDate`),
    sha256: validHash(source?.sha256, `manifest sources[${index}].sha256`),
  })) : [];
  if (sources.length === 0) throw new Error("manifest must declare at least one approved source");
  unique(sources, (source) => source.sourceKey, "manifest sources");
  return {
    schema: raw.schema,
    packKey,
    version,
    brand: {slug: brandSlug, name: assertSafeText(raw.brand?.name, "manifest brand.name", {max: 200})},
    domain: {slug: domainSlug, name: assertSafeText(raw.domain?.name, "manifest domain.name", {max: 200})},
    snapshotDate: assertDate(raw.snapshotDate, "manifest snapshotDate"),
    approval: {
      state: approvalState,
      approvedBy: approvalState === "approved" ? assertSlug(raw.approval?.approvedBy, "manifest approval.approvedBy") : null,
      approvedAt: approvalState === "approved" ? assertInstant(raw.approval?.approvedAt, "manifest approval.approvedAt") : null,
    },
    sourceRepository: {
      locator: assertLogicalLocator(raw.sourceRepository?.locator, "manifest sourceRepository.locator"),
      revisionKind,
      revision,
    },
    files: raw.files,
    sources,
  };
}

function normalizeEntities(rows) {
  const entities = rows.map((row, index) => {
    const entityKind = String(row.entity_kind || "").trim();
    if (!ENTITY_KINDS.has(entityKind)) throw new Error(`technical_entities.csv row ${index + 2} has invalid entity_kind`);
    return {
      entityKey: assertEntityKey(row.entity_key),
      entityKind,
      manufacturerRef: assertSafeText(row.manufacturer_ref, `technical_entities.csv row ${index + 2} manufacturer_ref`, {required: false, max: 160, commercialValues: false}) || null,
      name: assertSafeText(row.name, `technical_entities.csv row ${index + 2} name`, {max: 300}),
      series: assertSafeText(row.series, `technical_entities.csv row ${index + 2} series`, {required: false, max: 200}) || null,
      category: assertSafeText(row.category, `technical_entities.csv row ${index + 2} category`, {required: false, max: 200}) || null,
      summary: assertSafeText(row.summary, `technical_entities.csv row ${index + 2} summary`, {required: false, max: 3000}) || null,
    };
  });
  unique(entities, (entity) => entity.entityKey, "technical_entities.csv");
  return entities;
}

function confidence(value, label) {
  const number = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1`);
  return number;
}

function normalizeFacts(rows) {
  const facts = rows.map((row, index) => ({
    entityKey: assertEntityKey(row.entity_key),
    factKey: assertTechnicalFactKey(row.fact_key),
    value: assertSafeText(row.value, `technical_facts.csv row ${index + 2} value`, {max: 5000}),
    unit: assertSafeText(row.unit, `technical_facts.csv row ${index + 2} unit`, {required: false, max: 80}) || null,
    applicability: assertEntityKey(row.applicability, `technical_facts.csv row ${index + 2} applicability`),
    evidenceRef: assertSafeText(row.evidence_ref, `technical_facts.csv row ${index + 2} evidence_ref`, {max: 300, commercialValues: false}),
    sourcePage: assertSafeText(row.source_page, `technical_facts.csv row ${index + 2} source_page`, {required: false, max: 80, commercialValues: false}) || null,
    confidence: confidence(row.confidence, `technical_facts.csv row ${index + 2} confidence`),
  }));
  unique(facts, (fact) => `${fact.entityKey}:${fact.factKey}:${fact.value}:${fact.evidenceRef}`, "technical_facts.csv");
  return facts;
}

function normalizeRelations(rows) {
  const relations = rows.map((row, index) => {
    const relationType = String(row.relation_type || "").trim();
    if (!RELATIONS.has(relationType)) throw new Error(`technical_relations.csv row ${index + 2} has invalid relation_type`);
    return {
      fromEntityKey: assertEntityKey(row.from_entity_key, "from_entity_key"),
      relationType,
      toEntityKey: assertEntityKey(row.to_entity_key, "to_entity_key"),
      condition: parseJson(row.condition_json, `technical_relations.csv row ${index + 2} condition_json`),
      evidenceRef: assertSafeText(row.evidence_ref, `technical_relations.csv row ${index + 2} evidence_ref`, {max: 300, commercialValues: false}),
      sourcePage: assertSafeText(row.source_page, `technical_relations.csv row ${index + 2} source_page`, {required: false, max: 80, commercialValues: false}) || null,
    };
  });
  unique(relations, (relation) => `${relation.fromEntityKey}:${relation.relationType}:${relation.toEntityKey}:${relation.evidenceRef}`, "technical_relations.csv");
  return relations;
}

function normalizeRules(rows) {
  const rules = rows.map((row, index) => {
    const representation = String(row.representation || "").trim();
    if (!REPRESENTATIONS.has(representation)) throw new Error(`configuration_rules.csv row ${index + 2} has invalid representation`);
    const allowedValues = parseJson(row.allowed_values_json, `configuration_rules.csv row ${index + 2} allowed_values_json`, {kind: "array", allowEmpty: false});
    if (allowedValues.length === 0 || allowedValues.some((value) => typeof value !== "string" || !value.trim())) throw new Error(`configuration_rules.csv row ${index + 2} allowed_values_json must contain strings`);
    const affectsSku = parseBoolean(row.affects_sku, `configuration_rules.csv row ${index + 2} affects_sku`);
    const affectsPrice = parseBoolean(row.affects_price, `configuration_rules.csv row ${index + 2} affects_price`);
    const affectsStock = parseBoolean(row.affects_stock, `configuration_rules.csv row ${index + 2} affects_stock`);
    if (representation === "variation" && !affectsSku && !affectsPrice && !affectsStock) throw new Error(`configuration_rules.csv row ${index + 2} variation must affect SKU, price or stock`);
    return {
      entityKey: assertEntityKey(row.entity_key),
      ruleKey: assertEntityKey(row.rule_key, "rule_key"),
      axis: assertSafeText(row.axis, `configuration_rules.csv row ${index + 2} axis`, {max: 160}),
      representation,
      affectsSku,
      affectsPrice,
      affectsStock,
      allowedValues,
      condition: parseJson(row.condition_json, `configuration_rules.csv row ${index + 2} condition_json`),
      effect: parseJson(row.effect_json, `configuration_rules.csv row ${index + 2} effect_json`),
      evidenceRef: assertSafeText(row.evidence_ref, `configuration_rules.csv row ${index + 2} evidence_ref`, {max: 300, commercialValues: false}),
      sourcePage: assertSafeText(row.source_page, `configuration_rules.csv row ${index + 2} source_page`, {required: false, max: 80, commercialValues: false}) || null,
    };
  });
  unique(rules, (rule) => `${rule.entityKey}:${rule.ruleKey}`, "configuration_rules.csv");
  return rules;
}

function normalizeCrosswalk(rows, {requireApproval = true} = {}) {
  const mappings = rows.map((row, index) => {
    const mappingKind = String(row.mapping_kind || "").trim();
    if (!MAPPING_KINDS.has(mappingKind)) throw new Error(`sku_crosswalk.csv row ${index + 2} has invalid mapping_kind`);
    const parentSku = assertSafeText(row.woo_parent_sku, `sku_crosswalk.csv row ${index + 2} woo_parent_sku`, {required: false, max: 160, commercialValues: false}) || null;
    const variationSku = assertSafeText(row.woo_variation_sku, `sku_crosswalk.csv row ${index + 2} woo_variation_sku`, {required: false, max: 160, commercialValues: false}) || null;
    if (!parentSku && !variationSku) throw new Error(`sku_crosswalk.csv row ${index + 2} needs a Woo parent or variation SKU`);
    const approvedByRaw = String(row.approved_by || "").trim();
    const approvedAtRaw = String(row.approved_at || "").trim();
    if (requireApproval && (!approvedByRaw || !approvedAtRaw)) {
      throw new Error(`sku_crosswalk.csv row ${index + 2} requires explicit approval`);
    }
    if (!requireApproval && Boolean(approvedByRaw) !== Boolean(approvedAtRaw)) {
      throw new Error(`sku_crosswalk.csv row ${index + 2} must provide both approval fields or neither`);
    }
    return {
      entityKey: assertEntityKey(row.entity_key),
      manufacturerRef: assertSafeText(row.manufacturer_ref, `sku_crosswalk.csv row ${index + 2} manufacturer_ref`, {max: 160, commercialValues: false}),
      wooParentSku: parentSku,
      wooVariationSku: variationSku,
      mappingKind,
      evidenceRef: assertSafeText(row.evidence_ref, `sku_crosswalk.csv row ${index + 2} evidence_ref`, {max: 300, commercialValues: false}),
      approvedBy: approvedByRaw ? assertSlug(approvedByRaw, `sku_crosswalk.csv row ${index + 2} approved_by`) : null,
      approvedAt: approvedAtRaw ? assertInstant(approvedAtRaw, `sku_crosswalk.csv row ${index + 2} approved_at`) : null,
    };
  });
  unique(mappings, (mapping) => `${mapping.entityKey}:${mapping.wooParentSku || ""}:${mapping.wooVariationSku || ""}`, "sku_crosswalk.csv");
  const sellableSkus = new Set();
  for (const mapping of mappings) {
    for (const sku of [mapping.wooParentSku, mapping.wooVariationSku].filter(Boolean)) {
      const normalized = sku.toLocaleUpperCase("es");
      if (sellableSkus.has(normalized)) throw new Error(`sku_crosswalk.csv maps Woo SKU more than once: ${sku}`);
      sellableSkus.add(normalized);
    }
  }
  return mappings;
}

function normalizeChunks(text) {
  const chunks = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`support_chunks.jsonl line ${index + 1} is not valid JSON`); }
    const topic = String(row.topic || "").trim();
    if (!TOPICS.has(topic)) throw new Error(`support_chunks.jsonl line ${index + 1} has invalid topic`);
    return {
      chunkKey: assertEntityKey(row.chunk_key, `support_chunks.jsonl line ${index + 1} chunk_key`),
      entityKey: row.entity_key ? assertEntityKey(row.entity_key, `support_chunks.jsonl line ${index + 1} entity_key`) : null,
      topic,
      content: assertSafeText(row.content, `support_chunks.jsonl line ${index + 1} content`, {max: 20000}),
      evidenceRef: assertSafeText(row.evidence_ref, `support_chunks.jsonl line ${index + 1} evidence_ref`, {max: 300, commercialValues: false}),
      sourcePage: row.source_page ? assertSafeText(row.source_page, `support_chunks.jsonl line ${index + 1} source_page`, {max: 80, commercialValues: false}) : null,
    };
  });
  if (chunks.length === 0) throw new Error("support_chunks.jsonl must contain at least one chunk");
  unique(chunks, (chunk) => chunk.chunkKey, "support_chunks.jsonl");
  return chunks;
}

function validateReferences(pack) {
  const entities = new Set(pack.entities.map((entity) => entity.entityKey));
  const sources = new Set(pack.manifest.sources.map((source) => source.sourceKey));
  const requireEntity = (key, label) => { if (!entities.has(key)) throw new Error(`${label} references unknown entity ${key}`); };
  const requireEvidence = (ref, label) => {
    const key = evidenceSourceKey(ref);
    if (!sources.has(key)) throw new Error(`${label} references unknown source ${key}`);
  };
  for (const fact of pack.facts) { requireEntity(fact.entityKey, "technical_facts.csv"); requireEvidence(fact.evidenceRef, "technical_facts.csv"); }
  for (const relation of pack.relations) {
    requireEntity(relation.fromEntityKey, "technical_relations.csv");
    requireEntity(relation.toEntityKey, "technical_relations.csv");
    requireEvidence(relation.evidenceRef, "technical_relations.csv");
  }
  for (const rule of pack.rules) { requireEntity(rule.entityKey, "configuration_rules.csv"); requireEvidence(rule.evidenceRef, "configuration_rules.csv"); }
  for (const mapping of pack.crosswalk) { requireEntity(mapping.entityKey, "sku_crosswalk.csv"); requireEvidence(mapping.evidenceRef, "sku_crosswalk.csv"); }
  for (const chunk of pack.chunks) { if (chunk.entityKey) requireEntity(chunk.entityKey, "support_chunks.jsonl"); requireEvidence(chunk.evidenceRef, "support_chunks.jsonl"); }
}

export async function loadSupportPack(directory, {requireApproval = true} = {}) {
  const root = resolve(directory);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("Support pack path must be a real directory, not a symlink");
  const entries = await readdir(root);
  const permitted = new Set(["manifest.json", ...DATA_FILES]);
  const unexpected = entries.filter((entry) => !permitted.has(entry));
  if (unexpected.length > 0) throw new Error(`Support pack contains unexpected files: ${unexpected.join(", ")}`);
  const texts = {};
  let totalBytes = 0;
  for (const filename of ["manifest.json", ...DATA_FILES]) {
    const path = resolve(root, filename);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${filename} must be a regular file, not a symlink`);
    totalBytes += stats.size;
    if (totalBytes > MAX_PACK_BYTES) throw new Error("Support pack exceeds 50 MiB");
    texts[filename] = await readFile(path, "utf8");
  }
  let rawManifest;
  try { rawManifest = JSON.parse(texts["manifest.json"]); } catch { throw new Error("manifest.json is not valid JSON"); }
  const manifest = normalizeManifest(rawManifest, {requireApproval});
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("manifest files must be an object");
  const parsedCsv = {};
  for (const filename of Object.keys(HEADERS)) {
    try {
      parsedCsv[filename] = parseCsv(texts[filename], HEADERS[filename]);
    } catch (error) {
      throw new Error(`${filename} ${error.message}`);
    }
  }
  const chunks = normalizeChunks(texts["support_chunks.jsonl"]);
  const rowCounts = Object.fromEntries(DATA_FILES.map((filename) => [filename, filename.endsWith(".csv") ? parsedCsv[filename].length : chunks.length]));
  for (const filename of DATA_FILES) {
    const declaration = manifest.files[filename];
    if (!declaration || typeof declaration !== "object") throw new Error(`manifest files is missing ${filename}`);
    const actualHash = sha256(texts[filename]);
    if (declaration.sha256 !== actualHash) throw new Error(`${filename} sha256 does not match manifest`);
    if (nonNegativeInteger(declaration.rows, `manifest files.${filename}.rows`) !== rowCounts[filename]) throw new Error(`${filename} row count does not match manifest`);
  }
  if (Object.keys(manifest.files).sort().join(",") !== [...DATA_FILES].sort().join(",")) throw new Error("manifest files must declare exactly the six support-pack data files");
  const pack = {
    manifest,
    manifestSha256: sha256(texts["manifest.json"]),
    entities: normalizeEntities(parsedCsv["technical_entities.csv"]),
    facts: normalizeFacts(parsedCsv["technical_facts.csv"]),
    relations: normalizeRelations(parsedCsv["technical_relations.csv"]),
    rules: normalizeRules(parsedCsv["configuration_rules.csv"]),
    crosswalk: normalizeCrosswalk(parsedCsv["sku_crosswalk.csv"], {requireApproval}),
    chunks,
  };
  if (pack.entities.length === 0) throw new Error("technical_entities.csv must contain at least one technical entity");
  if (pack.crosswalk.length === 0) throw new Error("sku_crosswalk.csv must contain at least one approved identity mapping");
  validateReferences(pack);
  return pack;
}
