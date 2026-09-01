#!/usr/bin/env node
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname, isAbsolute, resolve, sep} from "node:path";
import {pathToFileURL} from "node:url";

const ABSOLUTE_PATH = /(?:^|[\s('"`=:])(?:\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Za-z]:\\)/;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const CREDENTIAL = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk-(?:proj-|ant-)?|ghp_|github_pat_|AIza|ya29\.)[A-Za-z0-9_-]{16,}|\bEA[A-Za-z0-9]{40,}\b|\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b)/;
const SENSITIVE_FILE = /(?:^|\/)(?:\.env(?:\.|$)|auth_[^/]*\.json$|google-ads\.ya?ml$|application[_-]default[_-]credentials\.json$|credentials?(?:[./_-]|$)|secrets?(?:[./_-]|$)|tokens?(?:[./_-]|$))/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function centerX(element) {
  return (element.box.x0 + element.box.x1) / 2;
}

function centerY(element) {
  return (element.box.y0 + element.box.y1) / 2;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function countEntries(entries, path, add) {
  const counts = new Map();
  for (const [index, entry] of (entries || []).entries()) {
    if (counts.has(entry.key)) add("duplicate_count_key", `${path}/${index}/key`, `Duplicate count key: ${entry.key}`);
    counts.set(entry.key, entry.count);
  }
  return counts;
}

function sortedEntries(counts) {
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function compareCounts(actual, expectedEntries, code, path, add) {
  const expected = countEntries(expectedEntries, path, add);
  if (JSON.stringify(sortedEntries(actual)) !== JSON.stringify(sortedEntries(expected))) {
    add(code, path, `Expected ${JSON.stringify(Object.fromEntries(sortedEntries(expected)))}, received ${JSON.stringify(Object.fromEntries(sortedEntries(actual)))}.`);
  }
}

function inspectUnsafe(value, path, add) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectUnsafe(item, `${path}/${index}`, add));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) inspectUnsafe(item, `${path}/${key}`, add);
    return;
  }
  if (typeof value !== "string") return;
  for (const [kind, pattern] of [
    ["absolute_path", ABSOLUTE_PATH],
    ["email_pii", EMAIL],
    ["database_uuid", UUID],
    ["credential_material", CREDENTIAL],
    ["sensitive_filename", SENSITIVE_FILE],
  ]) {
    if (pattern.test(value)) add("unsafe_content", path, `Sanitized fixture contains forbidden ${kind}.`);
  }
}

function portableRelative(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\")) return false;
  return path.split("/").every((part) => part && part !== "." && part !== ".." && /^[A-Za-z0-9._-]+$/.test(part)) && !SENSITIVE_FILE.test(path);
}

function resolveWithin(root, relativePath) {
  if (!portableRelative(relativePath)) return null;
  const absolute = resolve(root, relativePath);
  return absolute.startsWith(`${resolve(root)}${sep}`) ? absolute : null;
}

function groupRows(elements, tolerance) {
  const rows = [];
  for (const element of [...elements].sort((left, right) => centerY(left) - centerY(right) || centerX(left) - centerX(right))) {
    const row = rows.find((candidate) => Math.abs(candidate.center - centerY(element)) <= tolerance);
    if (row) {
      row.elements.push(element);
      row.center = row.elements.reduce((sum, item) => sum + centerY(item), 0) / row.elements.length;
    } else {
      rows.push({center: centerY(element), elements: [element]});
    }
  }
  return rows;
}

function rowPairs(fixture, subjects, values, add) {
  const {rowTolerance, rightSideTolerance, evidenceHeaderElementKey} = fixture.pairing;
  const subjectRows = groupRows(subjects, rowTolerance);
  const valueRows = groupRows(values, rowTolerance);
  const pairs = [];

  for (const subjectRow of subjectRows) {
    const valueRow = valueRows
      .map((row) => ({row, delta: Math.abs(row.center - subjectRow.center)}))
      .filter(({delta}) => delta <= rowTolerance)
      .sort((left, right) => left.delta - right.delta)[0]?.row;
    if (!valueRow) {
      for (const subject of subjectRow.elements) add("pairing_missing", `/elements/${subject.elementKey}`, "No price row is close enough to this subject row.");
      continue;
    }

    const rowSubjects = [...subjectRow.elements].sort((left, right) => centerX(left) - centerX(right));
    const rowValues = [...valueRow.elements].sort((left, right) => centerX(left) - centerX(right));
    const oneToOne = rowValues.length >= rowSubjects.length;
    let available = [...rowValues];
    for (const subject of rowSubjects) {
      const candidates = (oneToOne ? available : rowValues).filter((value) => value.box.x0 + rightSideTolerance >= subject.box.x0);
      const selected = candidates[0];
      if (!selected) {
        add("pairing_missing", `/elements/${subject.elementKey}`, "No right-side price is available for this subject.");
        continue;
      }
      if (oneToOne) available = available.filter((value) => value.elementKey !== selected.elementKey);
      pairs.push({
        pairKey: `${subject.elementKey}:${selected.elementKey}`,
        subjectElementKey: subject.elementKey,
        valueElementKey: selected.elementKey,
        headerElementKey: evidenceHeaderElementKey,
        qaState: subject.entity?.qaState,
      });
    }
  }
  return pairs;
}

function matrixPairs(fixture, subjects, values, headers, add) {
  const {rowTolerance, columnTolerance, rightSideTolerance} = fixture.pairing;
  const pairs = [];
  for (const value of [...values].sort((left, right) => centerY(left) - centerY(right) || centerX(left) - centerX(right))) {
    const subject = subjects
      .map((candidate) => ({candidate, rowDelta: Math.abs(centerY(candidate) - centerY(value)), leftDelta: value.box.x0 - candidate.box.x1}))
      .filter(({rowDelta, leftDelta}) => rowDelta <= rowTolerance && leftDelta >= -rightSideTolerance)
      .sort((left, right) => left.rowDelta - right.rowDelta || left.leftDelta - right.leftDelta)[0]?.candidate;
    const header = headers
      .map((candidate) => ({candidate, columnDelta: Math.abs(centerX(candidate) - centerX(value)), verticalDelta: value.box.y0 - candidate.box.y1}))
      .filter(({columnDelta, verticalDelta}) => columnDelta <= columnTolerance && verticalDelta >= -rowTolerance)
      .sort((left, right) => left.columnDelta - right.columnDelta || left.verticalDelta - right.verticalDelta)[0]?.candidate;
    if (!subject || !header?.headerKey) {
      add("pairing_missing", `/elements/${value.elementKey}`, "Matrix price lacks a unique left-side subject or an upper header.");
      continue;
    }
    pairs.push({
      pairKey: `${subject.elementKey}:${header.headerKey}`,
      subjectElementKey: subject.elementKey,
      valueElementKey: value.elementKey,
      headerElementKey: header.elementKey,
      qaState: subject.entity?.qaState,
    });
  }
  return pairs;
}

function confidenceLevel(score) {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function decisionState(qaState) {
  if (qaState === "auto_clear") return "observed";
  if (qaState === "blocked") return "blocked_source_conflict";
  return "needs_review";
}

function evidenceForPair(fixture, pair, elementsByKey) {
  const subject = elementsByKey.get(pair.subjectElementKey);
  const value = elementsByKey.get(pair.valueElementKey);
  const header = pair.headerElementKey ? elementsByKey.get(pair.headerElementKey) : null;
  const matrixSuffix = header?.headerKey ? `:${header.headerKey}` : "";
  const entity = subject.entity;
  const boxes = [
    {role: "reference", text: subject.text, ...subject.box},
    {role: "value", text: value.text, ...value.box},
  ];
  if (header) boxes.push({role: "header", text: header.text, ...header.box});
  return {
    schema: "enki-catalog-field-evidence/v1",
    evidenceKey: `${fixture.fixtureKey}:${pair.pairKey}:field`,
    runKey: `${fixture.fixtureKey}:run`,
    revision: {revisionId: `${fixture.fixtureKey}:${pair.pairKey}:r1`, revisionNumber: 1, supersedesRevisionId: null},
    observedAt: "2026-09-01T12:00:00+02:00",
    timezone: "Europe/Madrid",
    provenance: "sanitized_fixture",
    entity: {
      entityKey: `${entity.entityKey}${matrixSuffix}`,
      kind: entity.kind,
      manufacturerRef: entity.manufacturerRef,
      canonicalSku: entity.canonicalSku,
      brandSlug: fixture.brand.slug,
      wooIdentity: {productId: null, variationId: null, sku: null, parentSku: null, ean: null, slug: null},
    },
    field: {
      group: fixture.pairing.outputField.group,
      name: fixture.pairing.outputField.name,
      critical: fixture.pairing.outputField.critical,
      rawValue: value.rawValue,
      normalizedValue: value.normalizedValue,
      unit: fixture.pairing.outputField.unit,
      transformations: [{name: "sanitized_fixture_normalization", version: "1.0.0", note: "Invented fixture value normalized deterministically for regression only."}],
    },
    source: {
      sourceKey: fixture.source.sourceKey,
      kind: "official_pdf",
      authority: "official_technical",
      snapshotAt: fixture.source.snapshotAt,
      coverage: "partial",
      freshness: "historical",
      path: fixture.source.documentPath,
      sha256: fixture.source.documentSha256,
    },
    location: {
      kind: "pdf_region",
      documentPath: fixture.source.documentPath,
      documentSha256: fixture.source.documentSha256,
      page: fixture.source.page,
      pageImagePath: fixture.source.pageImagePath,
      pageImageSha256: fixture.source.pageImageSha256,
      coordinateSpace: fixture.source.coordinateSpace,
      pageWidth: fixture.source.pageWidth,
      pageHeight: fixture.source.pageHeight,
      boxes,
    },
    extraction: {method: "geometry", component: "enki-catalog-regression", componentVersion: "1.0.0", ruleKey: null, ruleVersion: null},
    confidence: {score: entity.confidenceScore, level: confidenceLevel(entity.confidenceScore), reasons: entity.confidenceReasons},
    decision: {state: decisionState(entity.qaState), actorType: "none", actorRef: null, decidedAt: null, note: "Regression status is not a Board approval.", isExternalMutationAuthority: false},
    lineage: {derivedFromEvidenceKeys: [], supersedesEvidenceKey: null, legacyRows: []},
    authority: {isObservation: true, isCurrentCommercialTruth: false, isExternalMutationAuthority: false},
  };
}

export function evaluateCatalogRegressionFixture(fixture) {
  const errors = [];
  const add = (code, path, message) => errors.push({code, path, message});
  inspectUnsafe(fixture, "", add);

  const elementsByKey = new Map();
  for (const [index, element] of (fixture.elements || []).entries()) {
    if (elementsByKey.has(element.elementKey)) add("duplicate_element", `/elements/${index}/elementKey`, `Duplicate element: ${element.elementKey}`);
    elementsByKey.set(element.elementKey, element);
    const box = element.box || {};
    if (!(box.x0 < box.x1 && box.y0 < box.y1 && box.x1 <= fixture.source?.pageWidth && box.y1 <= fixture.source?.pageHeight)) {
      add("invalid_geometry", `/elements/${index}/box`, "Element box must have positive area and remain inside the page.");
    }
  }

  const subjects = (fixture.elements || []).filter((element) => element.kind === fixture.pairing?.subjectKind);
  const values = (fixture.elements || []).filter((element) => element.kind === fixture.pairing?.valueKind);
  const headers = fixture.pairing?.headerKind ? (fixture.elements || []).filter((element) => element.kind === fixture.pairing.headerKind) : [];
  for (const subject of subjects) if (!subject.entity) add("missing_entity", `/elements/${subject.elementKey}/entity`, "Pairing subjects require a typed entity.");
  for (const value of values) if (value.rawValue === null || value.normalizedValue === null) add("missing_value", `/elements/${value.elementKey}`, "Pairing values require raw and normalized values.");
  if (fixture.pairing?.evidenceHeaderElementKey && !elementsByKey.has(fixture.pairing.evidenceHeaderElementKey)) add("missing_header", "/pairing/evidenceHeaderElementKey", "Evidence header element does not exist.");

  let pairs = [];
  if (fixture.pairing?.strategy === "row_left_to_right") pairs = rowPairs(fixture, subjects, values, add);
  else if (fixture.pairing?.strategy === "matrix_by_headers") pairs = matrixPairs(fixture, subjects, values, headers, add);
  else add("unknown_pairing_strategy", "/pairing/strategy", "Unsupported pairing strategy.");

  const normalizedPairs = [...pairs].sort((left, right) => left.pairKey.localeCompare(right.pairKey));
  const expectedPairs = [...(fixture.expected?.pairs || [])].sort((left, right) => left.pairKey.localeCompare(right.pairKey));
  if (JSON.stringify(normalizedPairs) !== JSON.stringify(expectedPairs)) add("pairing_mismatch", "/expected/pairs", `Expected ${JSON.stringify(expectedPairs)}, received ${JSON.stringify(normalizedPairs)}.`);

  compareCounts(countBy(fixture.elements || [], (element) => element.kind), fixture.expected?.elementCounts, "element_count_mismatch", "/expected/elementCounts", add);
  compareCounts(countBy((fixture.elements || []).filter((element) => element.entity), (element) => element.entity.kind), fixture.expected?.declaredEntityKindCounts, "declared_entity_kind_count_mismatch", "/expected/declaredEntityKindCounts", add);

  const evidence = pairs
    .filter((pair) => elementsByKey.get(pair.subjectElementKey)?.entity && elementsByKey.get(pair.valueElementKey))
    .map((pair) => evidenceForPair(fixture, pair, elementsByKey));
  if (evidence.length !== fixture.expected?.evidenceCount) add("evidence_count_mismatch", "/expected/evidenceCount", `Expected ${fixture.expected?.evidenceCount}, received ${evidence.length}.`);
  compareCounts(countBy(evidence, (item) => item.entity.kind), fixture.expected?.evidenceEntityKindCounts, "evidence_entity_kind_count_mismatch", "/expected/evidenceEntityKindCounts", add);
  compareCounts(countBy(pairs, (pair) => pair.qaState), fixture.expected?.qaStateCounts, "qa_state_count_mismatch", "/expected/qaStateCounts", add);

  return {
    valid: errors.length === 0,
    errors,
    fixtureKey: fixture.fixtureKey,
    brandSlug: fixture.brand?.slug,
    features: fixture.features || [],
    pairs,
    evidence,
  };
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function deduplicateHeaders(headers) {
  const counts = new Map();
  return headers.map((header) => {
    const count = (counts.get(header) || 0) + 1;
    counts.set(header, count);
    return count === 1 ? header : `${header}__${count}`;
  });
}

export function validateWooHeaderFixture(text, expected) {
  const errors = [];
  const add = (code, path, message) => errors.push({code, path, message});
  inspectUnsafe(text, "/woo", add);
  const rows = parseCsvRows(text);
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter((row) => row.some((value) => value !== ""));
  const deduplicated = deduplicateHeaders(headers);
  if (JSON.stringify(headers) !== JSON.stringify(expected.originalHeaders)) add("woo_header_mismatch", "/woo/originalHeaders", "Original Woo headers changed or were reordered.");
  if (JSON.stringify(deduplicated) !== JSON.stringify(expected.deduplicatedHeaders)) add("woo_deduplicated_header_mismatch", "/woo/deduplicatedHeaders", "Duplicate Woo headers were not renamed deterministically by position.");
  if (dataRows.length !== expected.rowCount) add("woo_row_count_mismatch", "/woo/rowCount", `Expected ${expected.rowCount}, received ${dataRows.length}.`);
  for (const [index, row] of dataRows.entries()) if (row.length !== headers.length) add("woo_column_count_mismatch", `/woo/rows/${index}`, "Woo fixture row width differs from its positional header width.");
  return {valid: errors.length === 0, errors, headers, deduplicatedHeaders: deduplicated, rows: dataRows};
}

export function validateCatalogRegressionSuite({manifestPath, manifestOverride = null}) {
  const errors = [];
  const add = (code, path, message) => errors.push({code, path, message});
  const manifestDir = dirname(resolve(manifestPath));
  let manifest = manifestOverride;
  if (!manifest) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      return {valid: false, errors: [{code: "manifest_read_failed", path: "/", message: error instanceof Error ? error.message : String(error)}], summary: null, fixtures: [], evidence: []};
    }
  }
  inspectUnsafe(manifest, "/manifest", add);

  const fixtureKeys = new Set();
  const fixturePaths = new Set();
  const fixtureResults = [];
  const brands = new Set();
  const features = new Set();
  const evidence = [];
  for (const [index, entry] of (manifest.fixtures || []).entries()) {
    if (fixtureKeys.has(entry.fixtureKey)) add("duplicate_fixture", `/manifest/fixtures/${index}/fixtureKey`, `Duplicate fixture key: ${entry.fixtureKey}`);
    fixtureKeys.add(entry.fixtureKey);
    if (fixturePaths.has(entry.path)) add("duplicate_fixture_path", `/manifest/fixtures/${index}/path`, `Duplicate fixture path: ${entry.path}`);
    fixturePaths.add(entry.path);
    const path = resolveWithin(manifestDir, entry.path);
    if (!path) {
      add("unsafe_fixture_path", `/manifest/fixtures/${index}/path`, "Fixture path must remain below the manifest directory.");
      continue;
    }
    let raw;
    let fixture;
    try {
      raw = readFileSync(path);
      fixture = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      add("fixture_read_failed", `/manifest/fixtures/${index}`, error instanceof Error ? error.message : String(error));
      continue;
    }
    if (sha256(raw) !== entry.sha256) add("fixture_hash_mismatch", `/manifest/fixtures/${index}/sha256`, `Fixture hash drift: ${entry.path}`);
    if (fixture.fixtureKey !== entry.fixtureKey) add("fixture_key_mismatch", `/manifest/fixtures/${index}/fixtureKey`, "Manifest and fixture keys differ.");
    if (fixture.brand?.slug !== entry.brandSlug) add("fixture_brand_mismatch", `/manifest/fixtures/${index}/brandSlug`, "Manifest and fixture brands differ.");
    const result = evaluateCatalogRegressionFixture(fixture);
    fixtureResults.push(result);
    for (const error of result.errors) add(error.code, `/fixtures/${entry.fixtureKey}${error.path}`, error.message);
    brands.add(result.brandSlug);
    for (const feature of result.features) features.add(feature);
    evidence.push(...result.evidence);
  }

  for (const brand of manifest.requiredBrands || []) if (!brands.has(brand)) add("brand_coverage_missing", "/manifest/requiredBrands", `Missing regression brand: ${brand}`);
  for (const feature of manifest.requiredFeatures || []) if (!features.has(feature)) add("feature_coverage_missing", "/manifest/requiredFeatures", `Missing regression feature: ${feature}`);

  let woo = {valid: false, errors: [], headers: [], deduplicatedHeaders: [], rows: []};
  const wooPath = resolveWithin(manifestDir, manifest.wooHeaderFixture?.path);
  if (!wooPath) add("unsafe_fixture_path", "/manifest/wooHeaderFixture/path", "Woo fixture path must remain below the manifest directory.");
  else {
    try {
      const raw = readFileSync(wooPath);
      if (sha256(raw) !== manifest.wooHeaderFixture.sha256) add("fixture_hash_mismatch", "/manifest/wooHeaderFixture/sha256", "Woo header fixture hash drift.");
      woo = validateWooHeaderFixture(raw.toString("utf8"), manifest.wooHeaderFixture);
      for (const error of woo.errors) add(error.code, error.path, error.message);
    } catch (error) {
      add("fixture_read_failed", "/manifest/wooHeaderFixture", error instanceof Error ? error.message : String(error));
    }
  }

  const summary = {
    suiteVersion: manifest.version,
    fixtures: fixtureResults.length,
    brands: [...brands].filter(Boolean).sort(),
    features: [...features].sort(),
    pairs: fixtureResults.reduce((sum, result) => sum + result.pairs.length, 0),
    evidenceRecords: evidence.length,
    wooRows: woo.rows.length,
    duplicateWooHeaders: woo.headers.length - new Set(woo.headers).size,
  };
  return {valid: errors.length === 0, errors, summary, fixtures: fixtureResults, evidence, woo};
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--manifest") result.manifestPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!result.manifestPath) throw new Error("Usage: validate_catalog_regression.mjs --manifest MANIFEST.json");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = validateCatalogRegressionSuite({manifestPath: args.manifestPath});
    process.stdout.write(`${JSON.stringify({valid: result.valid, errors: result.errors, summary: result.summary}, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
