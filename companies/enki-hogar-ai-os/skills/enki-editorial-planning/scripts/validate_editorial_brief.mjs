#!/usr/bin/env node

import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const SCORE_FIELDS = ["demand", "businessFit", "differentiation", "evidenceQuality", "executionReadiness"];
export const STAGES = ["research", "shortlist", "candidate_validation", "board_decision", "draft", "review", "publish"];

function rounded(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function scoreCandidate(candidate, weights) {
  return rounded(SCORE_FIELDS.reduce((total, field) => total + Number(candidate?.scores?.[field]) * Number(weights?.[field]), 0));
}

function candidateIdentityLine(candidate) {
  return `${candidate?.candidateKey ?? ""}|${candidate?.surfaceType ?? ""}|${candidate?.canonicalUrl ?? ""}`;
}

export function candidateFingerprint(candidates) {
  const canonical = [...(candidates ?? [])].map(candidateIdentityLine).sort().join("\n");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateEditorialBrief(brief) {
  const errors = [];
  const add = (code, message) => errors.push({code, message});
  const stageIndex = STAGES.indexOf(brief?.stage);

  if (brief?.schema !== "enki-editorial-brief/v2") add("brief.schema", "schema must be enki-editorial-brief/v2");
  if (brief?.timezone !== "Europe/Madrid") add("brief.timezone", "timezone must be Europe/Madrid");
  if (!["operational", "sanitized_fixture"].includes(brief?.provenance?.kind) || brief?.provenance?.authority !== "derived_evidence_not_live_source") add("brief.provenance", "provenance must distinguish operational work from a sanitized fixture and remain derived evidence");
  if (stageIndex < 0) add("brief.stage", `stage must be one of ${STAGES.join(", ")}`);
  if (!brief?.revision?.revisionId || !Number.isInteger(brief?.revision?.revisionNumber)) add("brief.revision", "revisionId and integer revisionNumber are required");
  if (brief?.gates?.externalWritesBlocked !== true || brief?.gates?.planningOnly !== true) add("gates.external_writes", "planning must keep external writes blocked");

  const shortlist = brief?.shortlist ?? {};
  const candidates = Array.isArray(shortlist.candidates) ? shortlist.candidates : [];
  const weights = shortlist.scoringModel?.weights ?? {};
  const weightTotal = rounded(SCORE_FIELDS.reduce((total, field) => total + Number(weights[field] ?? 0), 0));
  if (weightTotal !== 1) add("score.weights_total", `score weights must total 1, got ${weightTotal}`);

  if (stageIndex >= STAGES.indexOf("shortlist") && candidates.length === 0) add("shortlist.empty", "shortlist stage requires at least one candidate");
  const keys = candidates.map((candidate) => candidate?.candidateKey);
  if (new Set(keys).size !== keys.length || keys.some((key) => typeof key !== "string" || key.length === 0)) add("shortlist.candidate_keys", "candidate keys must be unique non-empty strings");

  const computedScores = {};
  for (const candidate of candidates) {
    const key = candidate?.candidateKey ?? "<missing>";
    const scoresValid = SCORE_FIELDS.every((field) => Number.isFinite(candidate?.scores?.[field]) && candidate.scores[field] >= 0 && candidate.scores[field] <= 5);
    if (!scoresValid) {
      add("score.dimension_invalid", `${key} score dimensions must be numbers from 0 to 5`);
    } else {
      const computed = scoreCandidate(candidate, weights);
      computedScores[key] = computed;
      if (candidate?.scores?.total !== computed) add("score.total_mismatch", `${key} declares ${candidate?.scores?.total}; computed total is ${computed}`);
    }

    const identity = candidate?.identity ?? {};
    if (["category", "brand_landing", "article"].includes(candidate?.surfaceType) && (identity.wooProductId !== null || identity.sku !== null)) {
      add("identity.editorial_surface_has_woo_identity", `${key} is ${candidate.surfaceType}; it cannot carry wooProductId or sku`);
    }
    if (candidate?.surfaceType === "product" && identity.wordpressPostId !== null) {
      add("identity.product_has_wordpress_identity", `${key} is a product; it cannot carry wordpressPostId`);
    }
    if (candidate?.surfaceType === "product" && identity.wooProductId === null && identity.sku === null) {
      add("identity.product_missing_woo_identity", `${key} product requires wooProductId or sku`);
    }
  }

  const computedFingerprint = candidateFingerprint(candidates);
  if (stageIndex >= STAGES.indexOf("shortlist") && shortlist.candidateFingerprint !== computedFingerprint) {
    add("shortlist.fingerprint_mismatch", `declared fingerprint does not match ${computedFingerprint}`);
  }

  const validation = brief?.candidateValidation;
  if (stageIndex >= STAGES.indexOf("candidate_validation")) {
    if (!validation) {
      add("candidate_validation.missing", "candidate validation is required at this stage");
    } else {
      if (validation.sourceBriefRevisionId !== shortlist.revisionId) add("candidate_validation.source_revision_mismatch", "candidate validation must target the shortlist revision");
      if (validation.sourceCandidateFingerprint !== shortlist.candidateFingerprint) add("candidate_validation.source_fingerprint_mismatch", "candidate validation must target the shortlist fingerprint");
      if (!validation.validationRevisionId || !Number.isInteger(validation.validationRevisionNumber)) add("candidate_validation.revision_missing", "candidate validation requires its own revision ID and number");
      if ((validation.additions?.length ?? 0) !== 0 || (validation.omissions?.length ?? 0) !== 0) add("candidate_validation.candidate_drift", "candidate validation cannot add or omit candidates");
      const expected = candidates.map(candidateIdentityLine).sort();
      const actual = (validation.validatedCandidates ?? []).map(candidateIdentityLine).sort();
      if (!sameMembers(expected, actual)) add("candidate_validation.candidate_set_mismatch", "candidate validation must contain the exact candidate keys, surface types and canonical URLs");
    }
  }

  const decision = brief?.boardDecision;
  if (stageIndex >= STAGES.indexOf("board_decision")) {
    if (!decision) {
      add("board_decision.missing", "Board decision is required at this stage");
    } else {
      if (decision.sourceBriefRevisionId !== shortlist.revisionId) add("board_decision.source_revision_mismatch", "Board decision must target the validated shortlist revision");
      if (decision.sourceCandidateFingerprint !== shortlist.candidateFingerprint) add("board_decision.source_fingerprint_mismatch", "Board decision must target the validated candidate fingerprint");
      if (!decision.sourceValidationRevisionId) add("board_decision.validation_revision_missing", "Board decision requires an exact Ecommerce validation revision");
      if (decision.sourceValidationRevisionId !== validation?.validationRevisionId) add("board_decision.validation_revision_mismatch", "Board decision must target the exact Ecommerce validation revision");
      if (decision.status !== "pending" && decision.decidedBy !== "board") add("board_decision.not_human", "only Board can record a final editorial decision");
      const unknownSelections = (decision.selectedCandidateKeys ?? []).filter((key) => !keys.includes(key));
      if (unknownSelections.length > 0) add("board_decision.unknown_candidate", `unknown selected candidates: ${unknownSelections.join(", ")}`);
      if (["accepted", "accepted_with_conditions"].includes(decision.status) && (decision.selectedCandidateKeys?.length ?? 0) === 0) add("board_decision.selection_required", "an accepted decision requires at least one selected candidate");
      if (decision.status === "rejected" && decision.authorizedNextStage === "draft") add("board_decision.rejected_draft", "a rejected decision cannot authorize draft");
    }
  }

  const update = brief?.postDecisionUpdate;
  if (decision && decision.status !== "pending") {
    if (!update) {
      add("post_decision.missing", "a final Board decision requires a newer editorial-brief revision");
    } else {
      if (update.previousBriefRevisionId !== decision.sourceBriefRevisionId || update.previousBriefRevisionId !== shortlist.revisionId) add("post_decision.previous_revision_mismatch", "post-decision update must supersede the decided shortlist revision");
      if (update.currentBriefRevisionId === update.previousBriefRevisionId || update.currentRevisionNumber <= shortlist.revisionNumber) add("post_decision.revision_not_newer", "post-decision brief revision must be strictly newer than the decided shortlist");
      if (brief?.revision?.revisionId !== update.currentBriefRevisionId || brief?.revision?.revisionNumber !== update.currentRevisionNumber || brief?.revision?.supersedesRevisionId !== update.previousBriefRevisionId) add("post_decision.root_revision_mismatch", "root revision must describe the post-decision update");
      if (update.appliedDecisionStatus !== decision.status) add("post_decision.status_mismatch", "post-decision update must apply the exact Board status");
      if (!(update.changedSections ?? []).includes("boardDecision") || !(update.changedSections ?? []).includes("nextAction")) add("post_decision.sections_missing", "changedSections must include boardDecision and nextAction");
      if (brief?.gates?.allowedNextStage !== decision.authorizedNextStage) add("post_decision.next_stage_mismatch", "allowedNextStage must match the Board-authorized next stage");
    }
  }

  if (stageIndex >= STAGES.indexOf("draft") && !["accepted", "accepted_with_conditions"].includes(decision?.status)) add("draft.no_accepted_decision", "draft requires an accepted Board decision");
  if (stageIndex >= STAGES.indexOf("draft") && decision?.authorizedNextStage !== "draft") add("draft.not_authorized", "draft requires Board to authorize draft explicitly");

  return {ok: errors.length === 0, errors, computedScores, candidateFingerprint: computedFingerprint};
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write("Usage: node scripts/validate_editorial_brief.mjs <brief.json>\n");
    process.exitCode = 2;
    return;
  }
  let brief;
  try {
    brief = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  } catch (error) {
    process.stderr.write(`Cannot read editorial brief: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const result = validateEditorialBrief(brief);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
