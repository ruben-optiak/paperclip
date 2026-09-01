#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const policyPath = fileURLToPath(new URL("../references/editorial-learning-policy-v1.json", import.meta.url));
export const DEFAULT_POLICY = JSON.parse(readFileSync(policyPath, "utf8"));

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDateTime(value) {
  return typeof value === "string" && /T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function addCalendarDays(value, days) {
  const date = parseDate(value);
  if (!date) throw new Error(`Invalid calendar date: ${value}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function exactArtifact(ref, expectedDocumentKey) {
  return isNonEmpty(ref?.issueKey) && ref?.documentKey === expectedDocumentKey && isNonEmpty(ref?.revisionId);
}

function validRelativeTarget(target) {
  const path = target?.path;
  return isNonEmpty(target?.kind)
    && isNonEmpty(path)
    && !path.startsWith("/")
    && !/^[A-Za-z]:[\\/]/.test(path)
    && !path.split(/[\\/]/).includes("..");
}

function sameTarget(left, right) {
  return left?.kind === right?.kind && left?.path === right?.path;
}

function hasLikelyRawPii(value) {
  const text = JSON.stringify(value);
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /\b(?:\+?34[ .-]?)?(?:6|7)\d{2}[ .-]?\d{3}[ .-]?\d{3}\b/.test(text);
}

export function validateEditorialFeedback(document) {
  const errors = [];
  const add = (code, message) => errors.push({code, message});
  if (document?.schema !== "enki-editorial-feedback/v1") add("feedback.schema", "schema must be enki-editorial-feedback/v1");
  if (document?.timezone !== "Europe/Madrid") add("feedback.timezone", "timezone must be Europe/Madrid");
  if (!isDateTime(document?.generated_at)) add("feedback.generated_at", "generated_at requires an explicit timezone offset");
  if (!["operational", "sanitized_fixture"].includes(document?.provenance?.kind) || document?.provenance?.authority !== "recorded_observation_not_automatic_rule") add("feedback.provenance", "feedback is a recorded observation, never an automatic rule");
  if (!isNonEmpty(document?.revision?.revisionId) || !Number.isInteger(document?.revision?.revisionNumber)) add("feedback.revision", "feedback document requires an exact revision");
  const observations = Array.isArray(document?.observations) ? document.observations : [];
  if (observations.length === 0) add("feedback.empty", "at least one feedback observation is required");
  const keys = observations.map((item) => item?.feedbackKey);
  if (keys.some((key) => !isNonEmpty(key)) || new Set(keys).size !== keys.length) add("feedback.keys", "feedback keys must be unique non-empty strings");

  for (const item of observations) {
    const key = item?.feedbackKey ?? "<missing>";
    if (!isDateTime(item?.recordedAt)) add("feedback.recorded_at", `${key} requires recordedAt with timezone`);
    if (!isNonEmpty(item?.subject?.contentKey) || !exactArtifact(item?.subject?.artifact, item?.subject?.artifact?.documentKey)) add("feedback.subject_revision", `${key} must target issueKey + documentKey + revisionId + contentKey`);
    if (item?.subject?.stage === "published_content" && !item?.subject?.publication) add("feedback.publication_missing", `${key} published feedback requires a live publication reference`);
    if (item?.source?.actorType === "board" && (item.source.actorRef !== "board" || item.source.sourceKind !== "board_comment")) add("feedback.board_attribution", `${key} Board feedback must be attributed to board_comment`);
    if (item?.source?.actorType === "agent" && (!isNonEmpty(item.source.actorRef) || item.source.actorRef === "board" || item.source.sourceKind !== "agent_review")) add("feedback.agent_attribution", `${key} agent feedback requires an agent ref and agent_review source`);
    if (item?.source?.actorType === "audience_aggregate" && item.source.sourceKind !== "anonymized_support_pattern") add("feedback.audience_anonymization", `${key} audience feedback must be an anonymized aggregate`);
    if (!isNonEmpty(item?.source?.sourceRef)) add("feedback.source_ref", `${key} requires a durable source reference`);
    if (item?.piiStatus !== "none_or_anonymized") add("feedback.pii_status", `${key} must declare no raw PII`);
    if (item?.status === "superseded" && (!isNonEmpty(item?.supersedesFeedbackKey) || item.supersedesFeedbackKey === key)) add("feedback.supersedes", `${key} superseded feedback must point to another feedback key`);
    if (item?.status !== "superseded" && item?.supersedesFeedbackKey !== null) add("feedback.unexpected_supersedes", `${key} may supersede another observation only when status is superseded`);
  }
  if (hasLikelyRawPii(document)) add("feedback.raw_pii", "feedback contains a likely email address or Spanish mobile number");
  return {ok: errors.length === 0, errors};
}

function validateMetric(metric, checkpointKey, add) {
  const value = metric?.value;
  if (metric?.representation === "number" && typeof value !== "number") add("retrospective.metric_representation", `${checkpointKey} ${metric?.name} must use a numeric value`);
  if (metric?.representation === "decimal_string" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))) add("retrospective.metric_representation", `${checkpointKey} ${metric?.name} must use an exact decimal string`);
  if (metric?.representation === "null" && value !== null) add("retrospective.metric_representation", `${checkpointKey} ${metric?.name} null representation requires null value`);
  if (["unavailable", "insufficient_volume"].includes(metric?.quality) && value !== null) add("retrospective.metric_false_value", `${checkpointKey} ${metric?.name} cannot carry an authoritative value with ${metric.quality} quality`);
}

export function validatePublicationRetrospective(document, policy = DEFAULT_POLICY) {
  const errors = [];
  const add = (code, message) => errors.push({code, message});
  if (document?.schema !== "enki-publication-retrospective/v1") add("retrospective.schema", "schema must be enki-publication-retrospective/v1");
  if (document?.timezone !== "Europe/Madrid") add("retrospective.timezone", "timezone must be Europe/Madrid");
  if (!isDateTime(document?.generated_at)) add("retrospective.generated_at", "generated_at requires an explicit timezone offset");
  if (!["operational", "sanitized_fixture"].includes(document?.provenance?.kind) || document?.provenance?.authority !== "derived_analysis_not_live_source") add("retrospective.provenance", "retrospective must remain derived analysis");
  if (!isNonEmpty(document?.revision?.revisionId) || !Number.isInteger(document?.revision?.revisionNumber)) add("retrospective.revision", "retrospective requires an exact revision");
  if (!exactArtifact(document?.subject?.planningBrief, "editorial-brief") || !exactArtifact(document?.subject?.draft, "content-draft") || !exactArtifact(document?.subject?.review, "content-review")) add("retrospective.lineage", "planning brief, draft and review require exact artifact revisions");
  if (document?.hypothesis?.sourceBriefRevisionId !== document?.subject?.planningBrief?.revisionId) add("retrospective.hypothesis_revision", "hypothesis must come from the exact planning brief revision");
  if (document?.measurementPlan?.checkpointDays?.join(",") !== policy?.measurement?.checkpointDays?.join(",")) add("retrospective.checkpoint_plan", "measurement plan must preserve the policy checkpoint days");
  if (document?.gates?.externalWritesBlocked !== true || document?.gates?.automaticRulePromotionBlocked !== true || document?.gates?.boardDecisionRequired !== true || document?.gates?.rawPiiBlocked !== true) add("retrospective.gates", "retrospective must block writes, raw PII and automatic rule promotion");

  const publication = document?.subject?.publication;
  const checkpoints = Array.isArray(document?.checkpoints) ? document.checkpoints : [];
  const expectedCheckpoints = policy?.measurement?.checkpointDays?.map((days) => ({key: `${days}d`, days})) ?? [];
  if (checkpoints.length !== expectedCheckpoints.length) add("retrospective.checkpoint_count", "retrospective requires exactly 7d, 28d and 90d checkpoints");

  if (!publication) {
    if (document?.lifecycle !== "initialized") add("retrospective.unpublished_lifecycle", "without a live publication the retrospective must remain initialized");
    for (const checkpoint of checkpoints) {
      if (checkpoint?.status !== "pending" || checkpoint?.eligibleOn !== null || checkpoint?.evaluatedAt !== null) add("retrospective.unpublished_checkpoint", "an unpublished item cannot start checkpoint clocks");
    }
  } else {
    if (!isDateTime(publication.publishedAt) || !parseDate(publication.publishedLocalDate) || !isDateTime(publication.liveVerifiedAt)) add("retrospective.publication_time", "publication requires live provider time, local date and verification time");
    if (isDateTime(publication.publishedAt) && publication.publishedAt.slice(0, 10) !== publication.publishedLocalDate) add("retrospective.publication_local_date", "publishedLocalDate must match the provider timestamp date");
    if (!isDateTime(document?.hypothesis?.frozenAt) || Date.parse(document.hypothesis.frozenAt) > Date.parse(publication.publishedAt)) add("retrospective.hypothesis_after_publish", "hypothesis must be frozen before live publication");
    if (!isDateTime(document?.measurementPlan?.frozenAt) || Date.parse(document.measurementPlan.frozenAt) > Date.parse(publication.publishedAt)) add("retrospective.plan_after_publish", "measurement plan must be frozen before live publication");
  }

  for (let index = 0; index < expectedCheckpoints.length; index += 1) {
    const expected = expectedCheckpoints[index];
    const checkpoint = checkpoints[index] ?? {};
    if (checkpoint.key !== expected.key || checkpoint.daysAfterPublication !== expected.days) add("retrospective.checkpoint_identity", `checkpoint ${index + 1} must be ${expected.key}`);
    if (publication && parseDate(publication.publishedLocalDate)) {
      const eligibleOn = addCalendarDays(publication.publishedLocalDate, expected.days);
      if (checkpoint.eligibleOn !== eligibleOn) add("retrospective.eligible_date", `${expected.key} must be eligible on ${eligibleOn}`);
      if (isDateTime(checkpoint.evaluatedAt) && checkpoint.evaluatedAt.slice(0, 10) < eligibleOn) add("retrospective.early_evaluation", `${expected.key} cannot be evaluated before ${eligibleOn}`);
    }
    if (checkpoint.status === "pending") {
      if (checkpoint.evaluatedAt !== null || checkpoint.minimumVolumeMet !== null || (checkpoint.sources?.length ?? 0) !== 0 || (checkpoint.metrics?.length ?? 0) !== 0 || checkpoint.conclusion !== "pending") add("retrospective.pending_has_results", `${expected.key} pending checkpoint cannot contain evaluated results`);
    } else {
      if (!isDateTime(checkpoint.evaluatedAt)) add("retrospective.evaluated_at", `${expected.key} evaluated checkpoint requires evaluatedAt`);
      if (checkpoint.status === "complete" && checkpoint.minimumVolumeMet !== true) add("retrospective.complete_without_volume", `${expected.key} complete checkpoint requires minimum volume`);
      if (checkpoint.status === "insufficient_volume" && (checkpoint.minimumVolumeMet !== false || checkpoint.conclusion !== "inconclusive")) add("retrospective.insufficient_volume", `${expected.key} insufficient volume must remain inconclusive`);
      if (["partial", "unavailable"].includes(checkpoint.status) && checkpoint.conclusion === "supports") add("retrospective.partial_support", `${expected.key} partial or unavailable evidence cannot support the hypothesis`);
    }
    for (const metric of checkpoint.metrics ?? []) validateMetric(metric, expected.key, add);
  }

  const checkpointByKey = new Map(checkpoints.map((checkpoint) => [checkpoint?.key, checkpoint]));
  if (["supported", "not_supported"].includes(document?.outcome?.status)) {
    const checkpoint28 = checkpointByKey.get("28d");
    if (checkpoint28?.status !== "complete") add("retrospective.final_outcome_too_early", "supported/not_supported outcome requires a complete 28d checkpoint");
  }

  const feedbackKeys = (document?.feedbackRefs ?? []).map((ref) => `${ref.issueKey}|${ref.documentKey}|${ref.revisionId}|${ref.feedbackKey}`);
  if (new Set(feedbackKeys).size !== feedbackKeys.length || (document?.feedbackRefs ?? []).some((ref) => !exactArtifact(ref, "editorial-feedback") || !isNonEmpty(ref.feedbackKey))) add("retrospective.feedback_ref", "feedback refs must be unique exact editorial-feedback revisions and keys");

  const candidates = Array.isArray(document?.learningCandidates) ? document.learningCandidates : [];
  const candidateMap = new Map();
  for (const candidate of candidates) {
    if (!isNonEmpty(candidate?.learningKey) || candidateMap.has(candidate.learningKey)) add("learning.candidate_key", "learning candidate keys must be unique non-empty strings");
    candidateMap.set(candidate?.learningKey, candidate);
    if (!validRelativeTarget(candidate?.proposedTarget)) add("learning.target_path", `${candidate?.learningKey} target must be a portable package-relative path`);
  }

  const decisionKeys = new Set();
  for (const decision of document?.promotionDecisions ?? []) {
    const candidate = candidateMap.get(decision?.learningKey);
    if (!candidate) add("learning.decision_without_candidate", `${decision?.learningKey} has no learning candidate`);
    if (decisionKeys.has(decision?.learningKey)) add("learning.duplicate_decision", `${decision?.learningKey} has multiple promotion decisions`);
    decisionKeys.add(decision?.learningKey);
    if (!validRelativeTarget(decision?.target) || (candidate && !sameTarget(decision.target, candidate.proposedTarget))) add("learning.decision_target", `${decision?.learningKey} decision must use the exact portable proposed target`);
    if (["accepted", "implemented", "rejected", "superseded"].includes(decision?.status) && (decision.decidedBy !== policy?.promotion?.decisionOwner || !isDateTime(decision.decidedAt))) add("learning.board_decision", `${decision?.learningKey} final promotion decision belongs to Board`);
    if (["accepted", "implemented"].includes(decision?.status) && (decision.requiredTests?.length ?? 0) === 0) add("learning.tests_required", `${decision?.learningKey} accepted promotion requires a regression test`);
    if (decision?.status === "implemented" && !isNonEmpty(decision?.implementationRef)) add("learning.implementation_ref", `${decision?.learningKey} implemented promotion requires a versioned implementation reference`);
    if (candidate?.status === "promoted" && decision?.status !== "implemented") add("learning.premature_promotion", `${decision?.learningKey} cannot be promoted before implementation`);

    if (["accepted", "implemented"].includes(decision?.status) && candidate) {
      if (candidate.basis === "repeated_observation" && new Set(candidate.independentContentKeys ?? []).size < policy.promotion.bases.repeated_observation.minimumIndependentContentItems) add("learning.repetition_insufficient", `${candidate.learningKey} needs independent repetition`);
      if (candidate.basis === "severe_risk" && !["high", "critical"].includes(candidate.riskSeverity)) add("learning.risk_not_severe", `${candidate.learningKey} single-observation exception requires high or critical risk`);
      if (candidate.basis === "demonstrated_improvement") {
        const checkpoint28 = checkpointByKey.get("28d");
        if (!isNonEmpty(candidate.comparatorRef) || !(candidate.checkpointKeys ?? []).includes("28d") || checkpoint28?.status !== "complete" || checkpoint28?.conclusion !== "supports") add("learning.improvement_not_demonstrated", `${candidate.learningKey} requires comparator and complete supporting 28d evidence`);
      }
    }
  }

  if (hasLikelyRawPii(document)) add("retrospective.raw_pii", "retrospective contains a likely email address or Spanish mobile number");
  return {ok: errors.length === 0, errors};
}

export function validateEditorialLearning(document, policy = DEFAULT_POLICY) {
  if (document?.schema === "enki-editorial-feedback/v1") return validateEditorialFeedback(document);
  if (document?.schema === "enki-publication-retrospective/v1") return validatePublicationRetrospective(document, policy);
  return {ok: false, errors: [{code: "learning.unknown_schema", message: "unsupported editorial learning schema"}]};
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write("Usage: node scripts/validate_editorial_learning.mjs <feedback-or-retrospective.json>\n");
    process.exitCode = 2;
    return;
  }
  try {
    const document = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const result = validateEditorialLearning(document);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Cannot validate editorial learning document: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
