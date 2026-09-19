#!/usr/bin/env node

import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const topLevelKeys = new Set(["schema", "paperclip", "report", "object", "operations", "evidence"]);
const issueDispositions = new Set(["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"]);
const reportPurposes = new Set(["object_review", "prerequisite_diagnosis", "recovery_coordination"]);
const reportStates = new Set(["final", "interim", "superseded"]);
const readinessValues = new Set(["not_assessed", "ready", "not_ready", "ready_with_board_accepted_risk"]);
const evidenceScopes = new Set(["missing", "fixture_only", "connected_non_production", "production"]);
const prerequisiteStates = new Set(["missing", "partial", "available"]);

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requireEnum(value, allowed, field) {
  requireString(value, field);
  if (!allowed.has(value)) throw new Error(`${field} has unsupported value ${value}`);
  return value;
}

function requireOnlyKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${field} has unsupported fields: ${unknown.join(", ")}`);
}

export function validateResultEnvelope(value) {
  const envelope = requireObject(value, "envelope");
  const unknownKeys = Object.keys(envelope).filter((key) => !topLevelKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`ambiguous or unsupported top-level result fields: ${unknownKeys.join(", ")}`);
  }
  if (envelope.schema !== "optiak-result-envelope/v1") throw new Error("schema must be optiak-result-envelope/v1");

  const paperclip = requireObject(envelope.paperclip, "paperclip");
  requireOnlyKeys(paperclip, new Set(["issueDisposition"]), "paperclip");
  requireEnum(paperclip.issueDisposition, issueDispositions, "paperclip.issueDisposition");

  const report = requireObject(envelope.report, "report");
  requireOnlyKeys(report, new Set(["runRef", "reportRef", "purpose", "state", "canonical", "supersededBy"]), "report");
  requireString(report.runRef, "report.runRef");
  requireString(report.reportRef, "report.reportRef");
  requireEnum(report.purpose, reportPurposes, "report.purpose");
  requireEnum(report.state, reportStates, "report.state");
  if (typeof report.canonical !== "boolean") throw new Error("report.canonical must be boolean");
  if (report.supersededBy !== null) requireString(report.supersededBy, "report.supersededBy");

  const object = requireObject(envelope.object, "object");
  requireOnlyKeys(object, new Set(["type", "revision", "reviewKind", "verdictVocabulary", "verdict"]), "object");
  for (const field of ["type", "revision", "reviewKind", "verdictVocabulary", "verdict"]) {
    requireString(object[field], `object.${field}`);
  }

  const operations = requireObject(envelope.operations, "operations");
  requireOnlyKeys(operations, new Set(["readiness"]), "operations");
  requireEnum(operations.readiness, readinessValues, "operations.readiness");

  const evidence = requireObject(envelope.evidence, "evidence");
  requireOnlyKeys(evidence, new Set(["scope", "prerequisiteState"]), "evidence");
  requireEnum(evidence.scope, evidenceScopes, "evidence.scope");
  requireEnum(evidence.prerequisiteState, prerequisiteStates, "evidence.prerequisiteState");

  if (report.canonical) {
    if (report.purpose !== "object_review" || report.state !== "final" || report.supersededBy !== null) {
      throw new Error("a canonical report must be a final object_review with no supersededBy reference");
    }
    if (evidence.prerequisiteState !== "available") {
      throw new Error("a canonical report requires available evidence prerequisites");
    }
  }
  if (report.state === "superseded" && (report.canonical || report.supersededBy === null)) {
    throw new Error("a superseded report must be non-canonical and reference supersededBy");
  }

  return envelope;
}

export function validateResultEnvelopes(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("result set must be a non-empty array");
  const envelopes = values.map(validateResultEnvelope);
  const reportRefs = new Set();
  const envelopeByReportRef = new Map();
  const canonicalRuns = new Set();
  const canonicalTargets = new Set();

  for (const envelope of envelopes) {
    const {report, object} = envelope;
    if (reportRefs.has(report.reportRef)) throw new Error(`duplicate reportRef ${report.reportRef}`);
    reportRefs.add(report.reportRef);
    envelopeByReportRef.set(report.reportRef, envelope);
    if (!report.canonical) continue;

    if (canonicalRuns.has(report.runRef)) throw new Error(`more than one canonical report for run ${report.runRef}`);
    canonicalRuns.add(report.runRef);
    const targetKey = `${object.type}\u0000${object.revision}\u0000${object.reviewKind}`;
    if (canonicalTargets.has(targetKey)) throw new Error("more than one canonical report for the same object revision and review kind");
    canonicalTargets.add(targetKey);
  }

  for (const envelope of envelopes) {
    if (envelope.report.state !== "superseded") continue;
    const replacement = envelopeByReportRef.get(envelope.report.supersededBy);
    if (!replacement) throw new Error(`supersededBy target not found: ${envelope.report.supersededBy}`);
    if (!replacement.report.canonical) throw new Error("supersededBy must reference a canonical report");
    const sourceKey = `${envelope.object.type}\u0000${envelope.object.revision}\u0000${envelope.object.reviewKind}`;
    const replacementKey = `${replacement.object.type}\u0000${replacement.object.revision}\u0000${replacement.object.reviewKind}`;
    if (sourceKey !== replacementKey) {
      throw new Error("supersededBy must reference the same object revision and review kind");
    }
  }

  return envelopes;
}

export async function runCli() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected a result envelope or set on stdin");
  const parsed = JSON.parse(raw);
  const values = Array.isArray(parsed) ? parsed : parsed?.results ?? [parsed];
  const valid = validateResultEnvelopes(values);
  const canonical = valid.filter((entry) => entry.report.canonical).length;
  console.log(`Valid result envelope set: ${valid.length} reports, ${canonical} canonical.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
