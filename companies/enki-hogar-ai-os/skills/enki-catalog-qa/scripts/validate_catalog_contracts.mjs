#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";

const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|auth_[^/]*\.json$|google-ads\.ya?ml$|application[_-]default[_-]credentials\.json$|credentials?(?:[./_-]|$)|secrets?(?:[./_-]|$)|tokens?(?:[./_-]|$))/i;
const PATH_KEYS = new Set(["path", "dataset", "documentPath", "pageImagePath", "filePath"]);

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function portablePath(value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.includes("\\")) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== ".." && /^[A-Za-z0-9._-]+$/.test(part)) && !SENSITIVE_PATH.test(value);
}

function walkPaths(value, path, add) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkPaths(entry, `${path}/${index}`, add));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}/${key}`;
    if (PATH_KEYS.has(key) && !portablePath(entry)) add("unsafe_path", entryPath, "Path must be portable, relative, non-sensitive and free of dot segments.");
    walkPaths(entry, entryPath, add);
  }
}

function indexUnique(items, key, path, add) {
  const indexed = new Map();
  for (const [position, item] of (items || []).entries()) {
    const value = item?.[key];
    if (indexed.has(value)) add("duplicate_key", `${path}/${position}/${key}`, `Duplicate ${key}: ${String(value)}`);
    else indexed.set(value, item);
  }
  return indexed;
}

function compareSource(runSource, evidenceSource) {
  return ["sourceKey", "kind", "authority", "snapshotAt", "coverage", "freshness", "path", "sha256"].every((field) => runSource?.[field] === evidenceSource?.[field]);
}

function confidenceIsCoherent(confidence) {
  if (!confidence || typeof confidence.score !== "number") return false;
  if (confidence.score >= 0.8) return confidence.level === "high";
  if (confidence.score >= 0.5) return confidence.level === "medium";
  return confidence.level === "low";
}

function valuesMatchState(state, referencedEvidence) {
  if (state.present === false) return state.rawValue === null && state.normalizedValue === null;
  return referencedEvidence.some((evidence) => sameValue(evidence.field?.rawValue, state.rawValue) && sameValue(evidence.field?.normalizedValue, state.normalizedValue));
}

function expectedSummary(changes) {
  const byDecision = {
    proposed: "proposed",
    needs_review: "needsReview",
    approved_for_local_export: "approvedForLocalExport",
    rejected: "rejected",
    blocked_source_conflict: "blockedSourceConflict",
    superseded: "superseded",
  };
  const summary = {
    total: changes.length,
    proposed: 0,
    needsReview: 0,
    approvedForLocalExport: 0,
    rejected: 0,
    blockedSourceConflict: 0,
    superseded: 0,
    eligibleForLocalExport: 0,
    criticalBlocked: 0,
  };
  for (const change of changes) {
    const counter = byDecision[change.decision?.state];
    if (counter) summary[counter] += 1;
    if (change.exportEligibility?.eligible === true) summary.eligibleForLocalExport += 1;
    if (change.risk?.criticalField === true && change.exportEligibility?.eligible !== true) summary.criticalBlocked += 1;
  }
  return summary;
}

export function validateCatalogBundle({run, evidence = [], changeSet}) {
  const errors = [];
  const add = (code, path, message) => errors.push({code, path, message});

  for (const [name, document] of [["run", run], ["changeSet", changeSet], ...evidence.map((item, index) => [`evidence/${index}`, item])]) {
    if (!document || typeof document !== "object" || Array.isArray(document)) add("invalid_document", `/${name}`, "Expected a JSON object.");
    else walkPaths(document, `/${name}`, add);
  }
  if (!run || !changeSet) return {valid: false, errors};

  const sources = indexUnique(run.sources, "sourceKey", "/run/sources", add);
  const artifacts = indexUnique(run.artifacts, "artifactKey", "/run/artifacts", add);
  const rulesets = indexUnique(run.rulesets, "rulesetKey", "/run/rulesets", add);
  const evidenceByKey = indexUnique(evidence, "evidenceKey", "/evidence", add);
  const changesByKey = indexUnique(changeSet.changes, "changeKey", "/changeSet/changes", add);

  for (const [index, source] of (run.sources || []).entries()) {
    if (Date.parse(source.snapshotAt) > Date.parse(run.createdAt)) add("source_time_after_run", `/run/sources/${index}/snapshotAt`, "A source snapshot cannot be newer than the run manifest.");
  }

  for (const [stageName, stage] of Object.entries(run.stages || {})) {
    for (const [index, artifactKey] of (stage.artifactKeys || []).entries()) {
      if (!artifacts.has(artifactKey)) add("unknown_artifact", `/run/stages/${stageName}/artifactKeys/${index}`, `Unknown artifact: ${artifactKey}`);
    }
    if (stage.status === "complete" && !stage.completedAt) add("stage_time_missing", `/run/stages/${stageName}/completedAt`, "A complete stage needs a completion timestamp.");
  }

  const wooSource = sources.get(changeSet.scope?.wooSnapshotSourceKey);
  if (!wooSource || wooSource.kind !== "woo_export_csv" || wooSource.role !== "commercial_snapshot" || wooSource.authority !== "current_commercial_snapshot" || wooSource.coverage !== "complete" || wooSource.freshness !== "current_for_run") {
    add("invalid_woo_snapshot", "/changeSet/scope/wooSnapshotSourceKey", "Scope must reference the fresh complete WooCommerce commercial snapshot declared by the run.");
  }
  if (changeSet.runKey !== run.runKey) add("run_mismatch", "/changeSet/runKey", "Change set and runKey differ.");
  if (changeSet.brand?.slug !== run.brand?.slug) add("brand_mismatch", "/changeSet/brand/slug", "Change set brand differs from run brand.");
  if (changeSet.provenance !== run.provenance?.kind) add("provenance_mismatch", "/changeSet/provenance", "Change set provenance differs from run provenance.");

  for (const [index, item] of evidence.entries()) {
    const base = `/evidence/${index}`;
    if (item.runKey !== run.runKey) add("run_mismatch", `${base}/runKey`, "Evidence and runKey differ.");
    if (item.provenance !== run.provenance?.kind) add("provenance_mismatch", `${base}/provenance`, "Evidence provenance differs from run provenance.");
    if (item.entity?.brandSlug !== run.brand?.slug) add("brand_mismatch", `${base}/entity/brandSlug`, "Evidence brand differs from run brand.");
    if (!confidenceIsCoherent(item.confidence)) add("confidence_mismatch", `${base}/confidence`, "Confidence level must be low below 0.5, medium from 0.5, and high from 0.8.");

    const runSource = sources.get(item.source?.sourceKey);
    if (!runSource || !compareSource(runSource, item.source)) add("source_mismatch", `${base}/source`, "Evidence source must exactly match a source in the run manifest.");

    const expectedSourceKinds = {
      pdf_region: new Set(["official_pdf", "manufacturer_file"]),
      pdf_page: new Set(["official_pdf", "manufacturer_file"]),
      csv_cell: new Set(["woo_export_csv", "manual_rules_csv", "normalized_csv", "comparison_csv", "review_csv"]),
      web_resource: new Set(["manufacturer_web"]),
      review_record: new Set(["review_csv", "comparison_csv"]),
    };
    if (!expectedSourceKinds[item.location?.kind]?.has(item.source?.kind)) {
      add("source_location_kind_mismatch", `${base}/location/kind`, "Evidence location type is incompatible with its source kind.");
    }

    if (item.location?.kind === "pdf_region") {
      if (item.location.documentPath !== item.source?.path || item.location.documentSha256 !== item.source?.sha256) {
        add("location_source_mismatch", `${base}/location`, "PDF location must identify the evidence source document and checksum.");
      }
      for (const [boxIndex, box] of (item.location.boxes || []).entries()) {
        if (!(box.x0 < box.x1 && box.y0 < box.y1 && box.x1 <= item.location.pageWidth && box.y1 <= item.location.pageHeight)) {
          add("invalid_box", `${base}/location/boxes/${boxIndex}`, "PDF box must have positive area and stay inside the declared page.");
        }
      }
      if (!(item.location.boxes || []).some((box) => box.role === "value")) add("missing_value_box", `${base}/location/boxes`, "PDF region evidence requires at least one value box.");
      if (typeof item.field?.rawValue === "string" && !(item.location.boxes || []).some((box) => box.role === "value" && box.text.includes(item.field.rawValue))) {
        add("evidence_text_mismatch", `${base}/field/rawValue`, "The preserved raw PDF value must appear in a value box.");
      }
    } else if (item.location?.kind === "pdf_page") {
      if (item.location.documentPath !== item.source?.path || item.location.documentSha256 !== item.source?.sha256) {
        add("location_source_mismatch", `${base}/location`, "PDF page location must identify the evidence source document and checksum.");
      }
      if (item.field?.critical === true && item.decision?.state === "approved") {
        add("critical_page_only_approval", `${base}/decision/state`, "Critical PDF evidence cannot be approved when legacy migration preserved only a page and no geometry.");
      }
    } else if (item.location?.kind === "csv_cell") {
      if (item.location.filePath !== item.source?.path || item.location.fileSha256 !== item.source?.sha256) {
        add("location_source_mismatch", `${base}/location`, "CSV cell must identify the evidence source file and checksum.");
      }
    } else if (item.location?.kind === "review_record") {
      if (item.location.filePath !== item.source?.path || item.location.fileSha256 !== item.source?.sha256) {
        add("location_source_mismatch", `${base}/location`, "Review row must identify the evidence source file and checksum.");
      }
    } else if (item.location?.kind === "web_resource" && item.location.contentSha256 !== item.source?.sha256) {
      add("location_source_mismatch", `${base}/location/contentSha256`, "Web evidence content checksum must match its immutable source snapshot.");
    }

    const currentCommercialTruth = item.source?.kind === "woo_export_csv" && item.source?.authority === "current_commercial_snapshot";
    if (item.authority?.isCurrentCommercialTruth !== currentCommercialTruth) {
      add("commercial_authority_mismatch", `${base}/authority/isCurrentCommercialTruth`, "Only evidence from the declared WooCommerce snapshot can be current commercial truth.");
    }
    for (const [derivedIndex, evidenceKey] of (item.lineage?.derivedFromEvidenceKeys || []).entries()) {
      if (!evidenceByKey.has(evidenceKey)) add("unknown_evidence", `${base}/lineage/derivedFromEvidenceKeys/${derivedIndex}`, `Unknown evidence: ${evidenceKey}`);
      if (evidenceKey === item.evidenceKey) add("lineage_cycle", `${base}/lineage/derivedFromEvidenceKeys/${derivedIndex}`, "Evidence cannot derive from itself.");
    }
    if (item.extraction?.ruleKey) {
      const ruleset = rulesets.get(item.extraction.ruleKey);
      if (!ruleset) add("unknown_ruleset", `${base}/extraction/ruleKey`, `Unknown ruleset: ${item.extraction.ruleKey}`);
      else if (item.extraction.ruleVersion !== ruleset.version) add("ruleset_version_mismatch", `${base}/extraction/ruleVersion`, "Evidence must cite the exact ruleset version from the run.");
    }
  }

  const declaredLineageEvidence = new Set(changeSet.lineage?.sourceEvidenceKeys || []);
  const actuallyReferencedEvidence = new Set();
  for (const [lineageIndex, evidenceKey] of (changeSet.lineage?.sourceEvidenceKeys || []).entries()) {
    if (!evidenceByKey.has(evidenceKey)) add("unknown_evidence", `/changeSet/lineage/sourceEvidenceKeys/${lineageIndex}`, `Unknown evidence: ${evidenceKey}`);
  }

  for (const [index, change] of (changeSet.changes || []).entries()) {
    const base = `/changeSet/changes/${index}`;
    if (!confidenceIsCoherent(change.confidence)) add("confidence_mismatch", `${base}/confidence`, "Confidence level must be low below 0.5, medium from 0.5, and high from 0.8.");
    if (!(changeSet.scope?.entityKinds || []).includes(change.target?.entityKind)) add("outside_scope", `${base}/target/entityKind`, "Entity kind is outside change-set scope.");
    if (!(changeSet.scope?.fieldGroups || []).includes(change.target?.fieldGroup)) add("outside_scope", `${base}/target/fieldGroup`, "Field group is outside change-set scope.");
    if ((changeSet.scope?.excludeEntityKeys || []).includes(change.target?.entityKey)) add("outside_scope", `${base}/target/entityKey`, "Entity is explicitly excluded from scope.");
    if ((changeSet.scope?.includeEntityKeys || []).length > 0 && !(changeSet.scope.includeEntityKeys || []).includes(change.target?.entityKey)) add("outside_scope", `${base}/target/entityKey`, "Entity is absent from the explicit include scope.");

    for (const side of ["current", "candidate"]) {
      const state = change[side] || {};
      const referenced = [];
      for (const [evidenceIndex, evidenceKey] of (state.evidenceKeys || []).entries()) {
        const item = evidenceByKey.get(evidenceKey);
        if (!item) add("unknown_evidence", `${base}/${side}/evidenceKeys/${evidenceIndex}`, `Unknown evidence: ${evidenceKey}`);
        else {
          referenced.push(item);
          actuallyReferencedEvidence.add(evidenceKey);
          if (!declaredLineageEvidence.has(evidenceKey)) add("lineage_omission", `${base}/${side}/evidenceKeys/${evidenceIndex}`, "Change evidence must appear in change-set lineage.");
          if (item.entity?.entityKey !== change.target?.entityKey || item.entity?.kind !== change.target?.entityKind || item.field?.group !== change.target?.fieldGroup || item.field?.name !== change.target?.fieldName) {
            add("target_evidence_mismatch", `${base}/${side}/evidenceKeys/${evidenceIndex}`, "Evidence entity and field must exactly match the change target.");
          }
        }
      }
      if (!valuesMatchState(state, referenced)) add("state_value_mismatch", `${base}/${side}`, "State raw and normalized values must be preserved by at least one referenced evidence record.");
      if (state.present === true && referenced.length === 0) add("missing_evidence", `${base}/${side}/evidenceKeys`, "A present state requires evidence.");
      if (state.present === false && (state.evidenceKeys || []).length > 0) add("unexpected_evidence", `${base}/${side}/evidenceKeys`, "An absent state must use null values and no evidence keys.");
    }

    const currentEvidence = (change.current?.evidenceKeys || []).map((key) => evidenceByKey.get(key)).filter(Boolean);
    const wooCurrentEvidence = currentEvidence.filter((item) => item.source?.sourceKey === changeSet.scope?.wooSnapshotSourceKey && item.authority?.isCurrentCommercialTruth === true);
    if (change.current?.present === true && (wooCurrentEvidence.length === 0 || !valuesMatchState(change.current, wooCurrentEvidence))) {
      add("current_not_woo_snapshot", `${base}/current/evidenceKeys`, "Current commercial state must be evidenced by the exact complete WooCommerce snapshot in scope.");
    }
    const column = change.target?.wooColumn;
    if (column) {
      const positionalMatch = wooCurrentEvidence.some((item) => item.location?.kind === "csv_cell" && ["columnIndex", "columnIndexBase", "originalHeader", "deduplicatedHeader"].every((field) => item.location[field] === column[field]));
      if (!positionalMatch) add("woo_column_mismatch", `${base}/target/wooColumn`, "Target Woo column must exactly match the positional current-state evidence.");
    }
    const candidateEvidence = (change.candidate?.evidenceKeys || []).map((key) => evidenceByKey.get(key)).filter(Boolean);
    if (change.candidate?.present === true && candidateEvidence.length > 0 && candidateEvidence.every((item) => item.source?.sourceKey === changeSet.scope?.wooSnapshotSourceKey)) {
      add("candidate_not_independent", `${base}/candidate/evidenceKeys`, "A candidate must have evidence independent from the current WooCommerce snapshot.");
    }

    if (change.comparison?.status === "match" && !sameValue(change.current?.normalizedValue, change.candidate?.normalizedValue)) {
      add("comparison_value_mismatch", `${base}/comparison/status`, "Comparison status match requires equal normalized values.");
    }
    if (change.comparison?.status === "mismatch" && sameValue(change.current?.normalizedValue, change.candidate?.normalizedValue)) {
      add("comparison_value_mismatch", `${base}/comparison/status`, "Comparison status mismatch requires different normalized values.");
    }
    const operationStates = {
      create_entity: [false, true],
      set_field: [true, true],
      clear_field: [true, false],
      retire_entity_candidate: [true, false],
      no_change: [true, true],
    };
    const expectedPresence = operationStates[change.operation];
    if (expectedPresence && (change.current?.present !== expectedPresence[0] || change.candidate?.present !== expectedPresence[1])) {
      add("operation_state_mismatch", `${base}/operation`, "Operation is inconsistent with current/candidate presence.");
    }
    if (change.operation === "no_change" && (change.comparison?.status !== "match" || !sameValue(change.current?.normalizedValue, change.candidate?.normalizedValue))) {
      add("operation_state_mismatch", `${base}/operation`, "no_change requires an exact normalized match.");
    }

    const approved = change.decision?.state === "approved_for_local_export";
    if (change.exportEligibility?.eligible === true && (!approved || (change.exportEligibility.blockers || []).length > 0)) {
      add("invalid_export_eligibility", `${base}/exportEligibility`, "Only a Board-approved, unblocked change may enter a local export draft.");
    }
    if (approved && change.exportEligibility?.eligible !== true) add("invalid_export_eligibility", `${base}/exportEligibility`, "An approved local-export change must be explicitly eligible.");
    if (approved) {
      for (const [candidateIndex, evidenceKey] of (change.candidate?.evidenceKeys || []).entries()) {
        if (evidenceByKey.get(evidenceKey)?.decision?.state !== "approved") add("unapproved_candidate_evidence", `${base}/candidate/evidenceKeys/${candidateIndex}`, "An approved local change requires every candidate evidence record to be Board-approved.");
      }
    }
    if (change.decision?.state === "blocked_source_conflict" && change.comparison?.status !== "source_conflict") {
      add("source_conflict_mismatch", `${base}/comparison/status`, "A blocked source conflict requires comparison status source_conflict.");
    }
  }

  for (const evidenceKey of declaredLineageEvidence) {
    if (!actuallyReferencedEvidence.has(evidenceKey)) add("lineage_surplus", "/changeSet/lineage/sourceEvidenceKeys", `Lineage declares unused evidence: ${evidenceKey}`);
  }

  const calculated = expectedSummary(changeSet.changes || []);
  for (const [field, value] of Object.entries(calculated)) {
    if (changeSet.summary?.[field] !== value) add("summary_mismatch", `/changeSet/summary/${field}`, `Expected ${value}, received ${String(changeSet.summary?.[field])}.`);
  }

  if (changeSet.decision?.state === "approved_for_local_export" && calculated.eligibleForLocalExport !== calculated.total) {
    add("change_set_decision_mismatch", "/changeSet/decision/state", "Full approval requires every change to be eligible for the local export draft.");
  }
  if (changeSet.decision?.state === "partially_approved_for_local_export" && !(calculated.eligibleForLocalExport > 0 && calculated.eligibleForLocalExport < calculated.total)) {
    add("change_set_decision_mismatch", "/changeSet/decision/state", "Partial approval requires some, but not all, changes to be eligible.");
  }
  if (run.decision?.state === "approved_for_local_export" && (changeSet.decision?.state !== "approved_for_local_export" || run.status !== "local_export_ready")) {
    add("run_decision_mismatch", "/run/decision/state", "A run approval requires its exact change set to be fully approved and status local_export_ready.");
  }
  if (changeSet.decision?.state === "approved_for_local_export" && run.decision?.state !== "approved_for_local_export") {
    add("run_decision_mismatch", "/changeSet/decision/state", "A fully approved change set requires a matching approved run revision.");
  }
  if (run.status === "local_export_ready" && (run.decision?.state !== "approved_for_local_export" || changeSet.decision?.state !== "approved_for_local_export")) {
    add("run_decision_mismatch", "/run/status", "local_export_ready requires matching full local-export approvals.");
  }

  const uniqueEntities = new Set(evidence.map((item) => item.entity?.entityKey));
  const expectedQuality = {
    entitiesObserved: uniqueEntities.size,
    fieldsObserved: evidence.length,
    fieldsCompared: (changeSet.changes || []).length,
    criticalFieldsBlocked: calculated.criticalBlocked,
  };
  for (const [field, value] of Object.entries(expectedQuality)) {
    if (run.quality?.[field] !== value) add("quality_mismatch", `/run/quality/${field}`, `Expected ${value}, received ${String(run.quality?.[field])}.`);
  }
  for (const [artifactIndex, artifact] of (run.artifacts || []).entries()) {
    if (artifact.kind === "field_evidence" && artifact.rows !== evidence.length) add("artifact_count_mismatch", `/run/artifacts/${artifactIndex}/rows`, "Field-evidence artifact row count must match supplied evidence records.");
    if (artifact.kind === "change_set" && artifact.rows !== (changeSet.changes || []).length) add("artifact_count_mismatch", `/run/artifacts/${artifactIndex}/rows`, "Change-set artifact row count must match supplied changes.");
  }

  return {valid: errors.length === 0, errors};
}

function parseArgs(argv) {
  const result = {evidence: []};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--run", "--evidence", "--change-set"].includes(flag)) throw new Error(`Unknown or incomplete argument: ${flag}`);
    if (flag === "--evidence") result.evidence.push(value);
    else if (flag === "--run") result.run = value;
    else result.changeSet = value;
    index += 1;
  }
  if (!result.run || !result.changeSet || result.evidence.length === 0) throw new Error("Usage: validate_catalog_contracts.mjs --run RUN.json --evidence EVIDENCE.json [--evidence ...] --change-set CHANGE_SET.json");
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = validateCatalogBundle({
      run: readJson(args.run),
      evidence: args.evidence.map(readJson),
      changeSet: readJson(args.changeSet),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
