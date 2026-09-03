#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  packageDir,
  "skills",
  "optiak-incident-triage",
  "references",
  "postmortem-contract.json",
);
const severities = new Set(["SEV0", "SEV1", "SEV2", "SEV3"]);
const scopes = new Set(["fixture_only", "versioned_internal", "connected_live"]);

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function evidenceMissing(value) {
  return !Array.isArray(value) || value.length === 0
    || value.some((item) => typeof item !== "string" || item.length === 0);
}

function findProhibitedField(value, prohibited, prefix = "evidence") {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (prohibited.has(key)) return path;
    const found = findProhibitedField(nested, prohibited, path);
    if (found) return found;
  }
  return null;
}

export function loadPostmortemContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

export function evaluatePostmortem(evidence, contract = loadPostmortemContract()) {
  const value = requireObject(evidence, "evidence");
  if (value.schema !== "optiak-postmortem-evidence/v1") {
    throw new Error("schema must be optiak-postmortem-evidence/v1");
  }
  if (!scopes.has(value.evidenceScope)) {
    throw new Error(`unsupported evidenceScope ${value.evidenceScope}`);
  }
  const prohibited = new Set(contract.blamelessPolicy?.prohibitedFields ?? []);
  const prohibitedPath = findProhibitedField(value, prohibited);
  if (prohibitedPath) throw new Error(`prohibited blame field ${prohibitedPath}`);

  const incident = requireObject(value.incident, "incident");
  requireString(incident.reference, "incident.reference");
  requireString(incident.environment, "incident.environment");
  if (!severities.has(incident.severity)) throw new Error(`unsupported severity ${incident.severity}`);
  if (typeof incident.material !== "boolean") throw new Error("incident.material must be boolean");

  const alwaysRequired = new Set(contract.requirementPolicy?.alwaysRequiredSeverities ?? []);
  const required = alwaysRequired.has(incident.severity) || incident.material;
  if (!required) {
    return {
      verdict: "not_required",
      incidentReference: incident.reference,
      evidenceScope: value.evidenceScope,
      blockedFields: [],
      changeReasons: [],
      doesNotAuthorizeExecution: true,
      nextAction: "Retain the incident record; a human may still request a postmortem.",
    };
  }

  const blockedFields = [];
  const changeReasons = [];
  const impact = requireObject(value.impact, "impact");
  requireString(impact.summary, "impact.summary");
  if (evidenceMissing(impact.evidenceRefs)) blockedFields.push("impact.evidenceRefs");

  if (!Array.isArray(value.timeline) || value.timeline.length === 0) {
    blockedFields.push("timeline");
  } else {
    value.timeline.forEach((entry, index) => {
      requireObject(entry, `timeline[${index}]`);
      requireString(entry.at, `timeline[${index}].at`);
      if (Number.isNaN(Date.parse(entry.at))) throw new Error(`invalid timeline timestamp at ${index}`);
      requireString(entry.event, `timeline[${index}].event`);
      if (evidenceMissing(entry.evidenceRefs)) blockedFields.push(`timeline[${index}].evidenceRefs`);
    });
  }

  const detection = requireObject(value.detection, "detection");
  requireString(detection.source, "detection.source");
  requireString(detection.detectedAt, "detection.detectedAt");
  if (Number.isNaN(Date.parse(detection.detectedAt))) throw new Error("invalid detection.detectedAt");
  if (evidenceMissing(detection.evidenceRefs)) blockedFields.push("detection.evidenceRefs");

  const rootCause = requireObject(value.rootCause, "rootCause");
  if (!new Set(["verified", "hypothesis", "unknown"]).has(rootCause.status)) {
    throw new Error(`unsupported rootCause.status ${rootCause.status}`);
  }
  requireString(rootCause.statement, "rootCause.statement");
  if (rootCause.status === "verified"
    && (rootCause.evidenceRefs?.length ?? 0)
      < contract.evidencePolicy.verifiedRootCauseMinimumIndependentRefs) {
    changeReasons.push("verified_root_cause_lacks_independent_evidence");
  }

  if (!Array.isArray(value.contributingConditions) || value.contributingConditions.length === 0) {
    changeReasons.push("contributing_conditions_missing");
  } else {
    value.contributingConditions.forEach((condition, index) => {
      requireObject(condition, `contributingConditions[${index}]`);
      requireString(condition.category, `contributingConditions[${index}].category`);
      requireString(condition.description, `contributingConditions[${index}].description`);
      if (evidenceMissing(condition.evidenceRefs)) {
        changeReasons.push(`contributing_condition_${index}_lacks_evidence`);
      }
    });
  }

  const response = requireObject(value.response, "response");
  if (!Array.isArray(response.worked) || !Array.isArray(response.didNotWork)
    || evidenceMissing(response.decisionRefs)) {
    changeReasons.push("response_learning_or_decision_refs_incomplete");
  }

  const allowedActionTypes = new Set(contract.correctiveActionPolicy?.types ?? []);
  const allowedActionStatuses = new Set(contract.correctiveActionPolicy?.allowedStatuses ?? []);
  const actionTypes = new Set();
  if (!Array.isArray(value.correctiveActions) || value.correctiveActions.length === 0) {
    changeReasons.push("corrective_actions_missing");
  } else {
    value.correctiveActions.forEach((action, index) => {
      requireObject(action, `correctiveActions[${index}]`);
      requireString(action.id, `correctiveActions[${index}].id`);
      if (!allowedActionTypes.has(action.type)) throw new Error(`unsupported action type ${action.type}`);
      actionTypes.add(action.type);
      if (!allowedActionStatuses.has(action.status)) throw new Error(`unsupported action status ${action.status}`);
      if (!action.owner || action.owner === "unassigned") changeReasons.push(`${action.id}_owner_missing`);
      if (!action.dueAt || Number.isNaN(Date.parse(`${action.dueAt}T00:00:00Z`))) {
        changeReasons.push(`${action.id}_due_date_missing_or_invalid`);
      }
      const verification = action.verification;
      if (!verification?.method || !verification?.successSignal) {
        changeReasons.push(`${action.id}_verification_incomplete`);
      }
      if (action.status !== "proposed" && !action.humanDecisionRef) {
        changeReasons.push(`${action.id}_human_decision_ref_missing`);
      }
    });
  }
  if (actionTypes.size < contract.correctiveActionPolicy.minimumDistinctTypesForMaterialIncident) {
    changeReasons.push("corrective_action_type_coverage_insufficient");
  }
  if (["unknown", "hypothesis"].includes(rootCause.status)
    && !(value.correctiveActions ?? []).some((action) => action.type === "detect")) {
    changeReasons.push("unverified_root_cause_requires_detection_or_investigation_action");
  }

  if (!Array.isArray(value.learning) || value.learning.length === 0) {
    changeReasons.push("learning_missing");
  }
  const recurrenceRisk = requireObject(value.recurrenceRisk, "recurrenceRisk");
  if (!new Set(["unknown", "low", "medium", "high"]).has(recurrenceRisk.level)) {
    throw new Error(`unsupported recurrenceRisk.level ${recurrenceRisk.level}`);
  }
  requireString(recurrenceRisk.rationale, "recurrenceRisk.rationale");

  const review = requireObject(value.review, "review");
  for (const field of ["incidentOwner", "facilitator", "independentReviewer"]) {
    requireString(review[field], `review.${field}`);
  }
  if (review.independentReviewer === review.incidentOwner) {
    changeReasons.push("independent_reviewer_must_differ_from_incident_owner");
  }

  let verdict = "ready_for_human_review";
  let nextAction = "Human reviewers decide risk acceptance and corrective-action disposition.";
  if (blockedFields.length > 0) {
    verdict = "blocked_on_evidence";
    nextAction = "Recover the missing impact, timeline, or detection evidence without inventing certainty.";
  } else if (changeReasons.length > 0) {
    verdict = "changes_required";
    nextAction = "Resolve structural, ownership, verification, or certainty gaps before human review.";
  }

  return {
    verdict,
    incidentReference: incident.reference,
    evidenceScope: value.evidenceScope,
    rootCauseStatus: rootCause.status,
    blockedFields,
    changeReasons,
    doesNotAuthorizeExecution: true,
    nextAction,
  };
}

async function runCli() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected postmortem evidence on stdin");
  console.log(JSON.stringify(evaluatePostmortem(JSON.parse(raw)), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
