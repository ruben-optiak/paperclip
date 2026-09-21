import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open, readdir, realpath} from "node:fs/promises";
import {extname, posix, resolve, sep} from "node:path";
import {assertContract, contractValidators} from "./contracts.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SENSITIVE = /(?:^|\/)(?:\.env(?:\.|$)|credentials?|secrets?|tokens?|auth[_-])/i;
const ALLOWED_CROP_TYPES = new Map([[".png", "image/png"], [".webp", "image/webp"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"]]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function array(value, label) {
  invariant(Array.isArray(value), `${label} must be an array`);
  return value;
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(extras.length === 0, `${label} has unexpected keys: ${extras.join(", ")}`);
}

function safeRelativePath(value, prefix, extensions) {
  invariant(typeof value === "string" && value === posix.normalize(value), `Invalid publication path: ${String(value)}`);
  invariant(!value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => !part || part === "." || part === ".."), `Unsafe publication path: ${value}`);
  invariant(value.startsWith(`${prefix}/`) && extensions.has(extname(value).toLowerCase()), `Publication path is outside ${prefix}: ${value}`);
  invariant(!SENSITIVE.test(value), `Sensitive-looking publication path is forbidden: ${value}`);
  return value;
}

function contained(root, relativePath) {
  const candidate = resolve(root, relativePath);
  invariant(candidate.startsWith(`${root}${sep}`), `Publication path escapes the mounted root: ${relativePath}`);
  return candidate;
}

async function readBytes(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    invariant((await handle.stat()).isFile(), `Publication entry is not a regular file: ${path}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readBytes(path)).digest("hex");
}

async function readJson(path, label) {
  let value;
  try { value = JSON.parse((await readBytes(path)).toString("utf8")); } catch { throw new Error(`${label} is not valid JSON`); }
  return object(value, label);
}

async function walk(root, relativeDir = "") {
  const found = [];
  const directory = relativeDir ? contained(root, relativeDir) : root;
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const path = contained(root, relativePath);
    const stats = await lstat(path);
    invariant(!stats.isSymbolicLink(), `Symlinks are forbidden in the publication: ${relativePath}`);
    if (stats.isDirectory()) found.push(...await walk(root, relativePath));
    else if (stats.isFile()) found.push(relativePath);
    else throw new Error(`Unsupported publication entry: ${relativePath}`);
  }
  return found;
}

function unique(items, key, label) {
  const values = new Set();
  for (const item of items) {
    invariant(typeof item[key] === "string" && item[key].length > 0, `${label} has an invalid ${key}`);
    invariant(!values.has(item[key]), `${label} has duplicate ${key}: ${item[key]}`);
    values.add(item[key]);
  }
}

function validateApproval(value, label) {
  object(value, label);
  exactKeys(value, ["state", "actorType", "actorRef", "decidedAt", "note"], label);
  invariant(value.state === "approved" && value.actorType === "board", `${label} must be approved by Board`);
  invariant(typeof value.actorRef === "string" && value.actorRef.length > 0, `${label} requires actorRef`);
  invariant(typeof value.decidedAt === "string" && Number.isFinite(Date.parse(value.decidedAt)), `${label} requires decidedAt`);
}

function validateManifest(manifest) {
  exactKeys(manifest, ["schema", "publicationKey", "version", "publishedAt", "timezone", "approval", "runs", "evidence", "authority"], "manifest");
  invariant(manifest.schema === "enki-catalog-evidence-publication/v1", "Unsupported publication schema");
  invariant(KEY.test(manifest.publicationKey || ""), "Invalid publicationKey");
  invariant(/^\d+\.\d+\.\d+$/.test(manifest.version || ""), "Invalid publication version");
  invariant(Number.isFinite(Date.parse(manifest.publishedAt)) && manifest.timezone === "Europe/Madrid", "Invalid publication timestamp or timezone");
  validateApproval(manifest.approval, "manifest.approval");
  const authority = object(manifest.authority, "manifest.authority");
  exactKeys(authority, ["approvedRunsOnly", "approvedFieldEvidenceOnly", "rawInputsIncluded", "externalWritesBlocked"], "manifest.authority");
  invariant(authority.approvedRunsOnly === true && authority.approvedFieldEvidenceOnly === true && authority.rawInputsIncluded === false && authority.externalWritesBlocked === true, "Publication authority must remain read-only and approved-only");
  return {runs: array(manifest.runs, "manifest.runs"), evidence: array(manifest.evidence, "manifest.evidence")};
}

export class CatalogueEvidencePublication {
  static async load(root, {maxCropBytes = 1_000_000} = {}) {
    const canonicalRoot = await realpath(root);
    invariant((await lstat(canonicalRoot)).isDirectory(), "CATALOGUE_EVIDENCE_ROOT must be a directory");
    const manifestPath = contained(canonicalRoot, "manifest.json");
    invariant(!(await lstat(manifestPath)).isSymbolicLink(), "manifest.json must not be a symlink");
    const manifest = await readJson(manifestPath, "manifest.json");
    const validators = await contractValidators();
    assertContract(validators.publication, manifest, "manifest.json");
    const {runs: runEntries, evidence: evidenceEntries} = validateManifest(manifest);
    unique(runEntries, "runKey", "manifest.runs");
    unique(runEntries, "path", "manifest.runs");
    unique(evidenceEntries, "evidenceKey", "manifest.evidence");
    unique(evidenceEntries, "path", "manifest.evidence");

    const declaredFiles = new Set(["manifest.json"]);
    const runs = new Map();
    for (const [index, entryValue] of runEntries.entries()) {
      const entry = object(entryValue, `manifest.runs[${index}]`);
      exactKeys(entry, ["runKey", "path", "sha256"], `manifest.runs[${index}]`);
      invariant(KEY.test(entry.runKey || "") && SHA256.test(entry.sha256 || ""), `Invalid run entry at ${index}`);
      safeRelativePath(entry.path, "runs", new Set([".json"]));
      declaredFiles.add(entry.path);
      const path = contained(canonicalRoot, entry.path);
      invariant(!(await lstat(path)).isSymbolicLink() && await sha256(path) === entry.sha256, `Run checksum mismatch: ${entry.runKey}`);
      const run = await readJson(path, `run ${entry.runKey}`);
      assertContract(validators.run, run, `run ${entry.runKey}`);
      invariant(run.schema === "enki-catalog-run/v1" && run.runKey === entry.runKey, `Run identity mismatch: ${entry.runKey}`);
      invariant(run.status === "local_export_ready", `Run is not approved-ready: ${entry.runKey}`);
      invariant(run.decision?.state === "approved_for_local_export" && run.decision?.actorType === "board" && run.decision?.isExternalMutationAuthority === false, `Run lacks exact Board approval: ${entry.runKey}`);
      invariant(run.execution?.externalWritesBlocked === true, `Run permits external writes: ${entry.runKey}`);
      runs.set(entry.runKey, run);
    }

    const evidence = new Map();
    for (const [index, entryValue] of evidenceEntries.entries()) {
      const entry = object(entryValue, `manifest.evidence[${index}]`);
      exactKeys(entry, ["evidenceKey", "runKey", "path", "sha256", "brand", "series", "sku", "manufacturerRef", "fieldGroup", "fieldName", "crop"], `manifest.evidence[${index}]`);
      invariant(KEY.test(entry.evidenceKey || "") && KEY.test(entry.runKey || "") && SHA256.test(entry.sha256 || ""), `Invalid evidence entry at ${index}`);
      invariant(runs.has(entry.runKey), `Evidence references an unpublished run: ${entry.evidenceKey}`);
      invariant(SLUG.test(entry.brand || "") && SLUG.test(entry.series || ""), `Evidence requires normalized brand and series: ${entry.evidenceKey}`);
      invariant(typeof entry.sku === "string" || entry.sku === null, `Evidence sku must be string or null: ${entry.evidenceKey}`);
      invariant(typeof entry.manufacturerRef === "string" || entry.manufacturerRef === null, `Evidence manufacturerRef must be string or null: ${entry.evidenceKey}`);
      invariant(typeof entry.fieldGroup === "string" && /^[a-z][a-z0-9_]*$/.test(entry.fieldName || ""), `Evidence field selector is invalid: ${entry.evidenceKey}`);
      safeRelativePath(entry.path, "evidence", new Set([".json"]));
      declaredFiles.add(entry.path);
      const path = contained(canonicalRoot, entry.path);
      invariant(!(await lstat(path)).isSymbolicLink() && await sha256(path) === entry.sha256, `Evidence checksum mismatch: ${entry.evidenceKey}`);
      const record = await readJson(path, `evidence ${entry.evidenceKey}`);
      assertContract(validators.evidence, record, `evidence ${entry.evidenceKey}`);
      invariant(record.schema === "enki-catalog-field-evidence/v1" && record.evidenceKey === entry.evidenceKey && record.runKey === entry.runKey, `Evidence identity mismatch: ${entry.evidenceKey}`);
      invariant(record.decision?.state === "approved" && record.decision?.actorType === "board" && record.decision?.isExternalMutationAuthority === false, `Evidence is not Board-approved: ${entry.evidenceKey}`);
      invariant(record.authority?.isObservation === true && record.authority?.isExternalMutationAuthority === false, `Evidence authority is unsafe: ${entry.evidenceKey}`);
      invariant(record.entity?.brandSlug === entry.brand && record.entity?.canonicalSku === entry.sku && record.entity?.manufacturerRef === entry.manufacturerRef, `Evidence entity selector drift: ${entry.evidenceKey}`);
      invariant(record.field?.group === entry.fieldGroup && record.field?.name === entry.fieldName, `Evidence field selector drift: ${entry.evidenceKey}`);

      let crop = null;
      if (entry.crop !== null) {
        crop = object(entry.crop, `manifest.evidence[${index}].crop`);
        exactKeys(crop, ["path", "sha256", "mimeType"], `manifest.evidence[${index}].crop`);
        safeRelativePath(crop.path, "crops", new Set(ALLOWED_CROP_TYPES.keys()));
        invariant(SHA256.test(crop.sha256 || "") && ALLOWED_CROP_TYPES.get(extname(crop.path).toLowerCase()) === crop.mimeType, `Invalid crop metadata: ${entry.evidenceKey}`);
        declaredFiles.add(crop.path);
        const cropPath = contained(canonicalRoot, crop.path);
        const stats = await lstat(cropPath);
        invariant(!stats.isSymbolicLink() && stats.size <= maxCropBytes && await sha256(cropPath) === crop.sha256, `Crop validation failed: ${entry.evidenceKey}`);
      }
      evidence.set(entry.evidenceKey, {entry: structuredClone(entry), record, crop});
    }

    const actualFiles = new Set(await walk(canonicalRoot));
    invariant(actualFiles.size === declaredFiles.size && [...actualFiles].every((path) => declaredFiles.has(path)), "Publication contains undeclared files or is missing declared files");
    return new CatalogueEvidencePublication(canonicalRoot, manifest, runs, evidence, maxCropBytes);
  }

  constructor(root, manifest, runs, evidence, maxCropBytes) {
    this.root = root;
    this.manifest = manifest;
    this.runs = runs;
    this.evidence = evidence;
    this.maxCropBytes = maxCropBytes;
  }

  listRuns({brand, limit}) {
    return [...this.runs.values()]
      .filter((run) => !brand || run.brand.slug === brand)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.runKey.localeCompare(right.runKey))
      .slice(0, limit)
      .map((run) => ({runKey: run.runKey, brand: run.brand, domain: run.domain, createdAt: run.createdAt, status: run.status, quality: run.quality, decision: run.decision}));
  }

  searchEvidence(input) {
    const matches = [...this.evidence.values()].filter(({entry}) =>
      (!input.brand || entry.brand === input.brand) &&
      (!input.series || entry.series === input.series) &&
      (!input.sku || entry.sku?.toLowerCase() === input.sku.toLowerCase()) &&
      (!input.manufacturer_ref || entry.manufacturerRef?.toLowerCase() === input.manufacturer_ref.toLowerCase()) &&
      (!input.field_group || entry.fieldGroup === input.field_group) &&
      (!input.field_name || entry.fieldName === input.field_name));
    return matches.sort((left, right) => left.entry.evidenceKey.localeCompare(right.entry.evidenceKey)).slice(0, input.limit).map(({entry, record, crop}) => ({
      evidenceKey: entry.evidenceKey,
      runKey: entry.runKey,
      selectors: {brand: entry.brand, series: entry.series, sku: entry.sku, manufacturerRef: entry.manufacturerRef, fieldGroup: entry.fieldGroup, fieldName: entry.fieldName},
      value: {normalized: record.field.normalizedValue, unit: record.field.unit, critical: record.field.critical},
      locationKind: record.location.kind,
      cropAvailable: crop !== null,
      approvedAt: record.decision.decidedAt,
    }));
  }

  getEvidence(evidenceKey) {
    const item = this.evidence.get(evidenceKey);
    if (!item) throw new Error(`Approved evidence not found: ${evidenceKey}`);
    return {
      evidenceKey,
      runKey: item.entry.runKey,
      selectors: {brand: item.entry.brand, series: item.entry.series, sku: item.entry.sku, manufacturerRef: item.entry.manufacturerRef},
      field: item.record.field,
      source: item.record.source,
      location: item.record.location,
      extraction: item.record.extraction,
      confidence: item.record.confidence,
      decision: item.record.decision,
      authority: item.record.authority,
      cropAvailable: item.crop !== null,
    };
  }

  async getCrop(evidenceKey) {
    const item = this.evidence.get(evidenceKey);
    if (!item) throw new Error(`Approved evidence not found: ${evidenceKey}`);
    if (!item.crop) throw new Error(`Approved crop not available: ${evidenceKey}; use the verified coordinates from catalogue_get_field_evidence`);
    const bytes = await readBytes(contained(this.root, item.crop.path));
    invariant(bytes.length <= this.maxCropBytes && createHash("sha256").update(bytes).digest("hex") === item.crop.sha256, `Crop changed after startup: ${evidenceKey}`);
    return {mimeType: item.crop.mimeType, data: bytes.toString("base64"), sha256: item.crop.sha256};
  }

  coverage() {
    const approved = [...this.evidence.values()];
    const brands = {};
    for (const {entry, crop} of approved) {
      const bucket = brands[entry.brand] ??= {runs: new Set(), series: new Set(), fields: new Set(), evidence: 0, crops: 0};
      bucket.runs.add(entry.runKey); bucket.series.add(entry.series); bucket.fields.add(`${entry.fieldGroup}.${entry.fieldName}`); bucket.evidence += 1; bucket.crops += crop ? 1 : 0;
    }
    return {
      publicationKey: this.manifest.publicationKey,
      publishedAt: this.manifest.publishedAt,
      approvedRuns: this.runs.size,
      approvedEvidence: this.evidence.size,
      brands: Object.fromEntries(Object.entries(brands).sort().map(([brand, value]) => [brand, {runs: value.runs.size, series: [...value.series].sort(), fields: [...value.fields].sort(), evidence: value.evidence, crops: value.crops}])),
      rawInputsAccessible: false,
    };
  }
}
