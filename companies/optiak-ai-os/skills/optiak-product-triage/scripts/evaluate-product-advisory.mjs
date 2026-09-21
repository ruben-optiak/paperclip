#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  skillDir,
  "references",
  "product-advisory-contract.json",
);

const evidenceScopes = new Set([
  "fixture_only",
  "versioned_internal",
  "connected_non_production",
  "historical_connected_non_production",
]);
const confidences = new Set(["low", "medium", "high"]);
const priorityPurposes = new Set(["priority_ranking", "roadmap_sequence", "strategy_recommendation"]);

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

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

export function loadProductAdvisoryContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

export function evaluateProductAdvisory(evidence, contract = loadProductAdvisoryContract()) {
  const value = requireObject(evidence, "evidence");
  if (value.schema !== "optiak-product-advisory-evidence/v1") {
    throw new Error("schema must be optiak-product-advisory-evidence/v1");
  }
  if (!evidenceScopes.has(value.evidenceScope)) {
    throw new Error(`unsupported evidenceScope ${value.evidenceScope}`);
  }
  requireString(value.reviewPurpose, "reviewPurpose");

  const strategy = requireObject(value.strategyContext, "strategyContext");
  requireString(strategy.status, "strategyContext.status");
  if (!Array.isArray(strategy.references)
    || strategy.references.some((reference) => typeof reference !== "string" || reference.length === 0)) {
    throw new Error("strategyContext.references must be an array of non-empty strings");
  }

  const sample = requireObject(value.sample, "sample");
  requireString(sample.selectionStrategy, "sample.selectionStrategy");
  if (typeof sample.usedUpdatedAtOnly !== "boolean" || typeof sample.globalPriorityClaim !== "boolean") {
    throw new Error("sample selection flags must be boolean");
  }
  requireNonNegativeInteger(sample.itemCount, "sample.itemCount");

  const provider = requireObject(value.provider, "provider");
  for (const field of ["calls", "listCalls", "detailCalls"]) {
    requireNonNegativeInteger(provider[field], `provider.${field}`);
  }

  if (!Array.isArray(value.recommendations)) throw new Error("recommendations must be an array");
  const structuralViolations = [];
  const strategyBlockers = [];
  const warnings = [];
  const recommendationIds = new Set();

  if (sample.itemCount > contract.selection.maximumItemsListed) {
    structuralViolations.push("sample_item_limit_exceeded");
  }
  if (provider.calls > contract.selection.maximumProviderCalls
    || provider.listCalls > 2
    || provider.detailCalls > contract.selection.maximumItemsReadInDetail) {
    structuralViolations.push("provider_call_budget_exceeded");
  }
  if (value.recommendations.length > contract.recommendations.maximum) {
    structuralViolations.push("recommendation_limit_exceeded");
  }
  if (value.externalWrites !== 0) structuralViolations.push("external_write_observed");

  const strategyAccepted = new Set(contract.authority.acceptedStrategyStates).has(strategy.status)
    && strategy.references.length > 0;
  if (priorityPurposes.has(value.reviewPurpose) && !strategyAccepted) {
    strategyBlockers.push("priority_review_requires_current_strategy_authority");
  }
  if (priorityPurposes.has(value.reviewPurpose) && sample.usedUpdatedAtOnly) {
    strategyBlockers.push("updated_at_only_cannot_support_priority_review");
  }
  if (sample.globalPriorityClaim) {
    strategyBlockers.push("bounded_sample_cannot_claim_global_priority");
  }

  for (const [index, recommendation] of value.recommendations.entries()) {
    requireObject(recommendation, `recommendations[${index}]`);
    for (const field of contract.recommendations.requiredFields) {
      if (field === "missingEvidence") {
        if (!Array.isArray(recommendation[field])) {
          throw new Error(`recommendations[${index}].missingEvidence must be an array`);
        }
      } else {
        requireString(recommendation[field], `recommendations[${index}].${field}`);
      }
    }
    if (recommendationIds.has(recommendation.sourceId)) {
      structuralViolations.push(`duplicate_recommendation:${recommendation.sourceId}`);
    }
    recommendationIds.add(recommendation.sourceId);
    if (recommendation.detailRead !== true) {
      structuralViolations.push(`detail_read_required:${recommendation.sourceId}`);
    }
    if (!confidences.has(recommendation.confidence)) {
      throw new Error(`unsupported confidence for ${recommendation.sourceId}`);
    }
    if (recommendation.acceptanceCriteriaStatus !== contract.recommendations.acceptanceCriteriaStatus) {
      structuralViolations.push(`acceptance_criteria_not_draft:${recommendation.sourceId}`);
    }
    if (recommendation.proposesPriorityChange === true
      && (!strategyAccepted || !strategy.references.includes(recommendation.strategyReference))) {
      strategyBlockers.push(`priority_change_without_strategy_reference:${recommendation.sourceId}`);
    }
  }

  const output = requireObject(value.output, "output");
  for (const field of ["wordCount", "executiveSummaryLines", "boardDecisionCount"]) {
    requireNonNegativeInteger(output[field], `output.${field}`);
  }
  if (!Array.isArray(output.sections)) throw new Error("output.sections must be an array");
  const sectionSet = new Set(output.sections);
  for (const section of contract.humanOutput.requiredSections) {
    if (!sectionSet.has(section)) structuralViolations.push(`missing_output_section:${section}`);
  }
  if (output.wordCount > contract.humanOutput.maximumWords) structuralViolations.push("human_output_word_limit_exceeded");
  if (output.executiveSummaryLines > contract.humanOutput.maximumExecutiveSummaryLines) {
    structuralViolations.push("executive_summary_line_limit_exceeded");
  }
  if (output.boardDecisionCount > contract.humanOutput.maximumBoardDecisions) {
    structuralViolations.push("board_decision_limit_exceeded");
  }
  if (output.machineEnvelopeSeparated !== true) {
    structuralViolations.push("machine_envelope_must_be_separate");
  }

  const usage = requireObject(value.usage, "usage");
  for (const field of ["uncachedInputTokens", "outputTokens", "durationSeconds"]) {
    requireNonNegativeInteger(usage[field], `usage.${field}`);
  }
  const efficiencyRegressions = [];
  for (const [field, limits] of Object.entries(contract.efficiency)) {
    if (typeof limits !== "object" || limits === null || !(field in usage)) continue;
    if (usage[field] > limits.reviewMaximum) efficiencyRegressions.push(`${field}_over_review_maximum`);
    else if (usage[field] > limits.targetMaximum) warnings.push(`${field}_over_target`);
  }

  let verdict = "ready_for_board_review";
  let nextAction = "Present the bounded recommendation to the Board without changing Linear or authorizing implementation.";
  if (strategyBlockers.length > 0) {
    verdict = "blocked_on_strategy";
    nextAction = "Recover an exact approved strategy reference or narrow the review to hygiene and evidence gaps.";
  } else if (structuralViolations.length > 0) {
    verdict = "changes_required";
    nextAction = "Correct evidence depth, output separation, bounds, or write violations before Board review.";
  } else if (efficiencyRegressions.length > 0) {
    verdict = "efficiency_regression";
    nextAction = "Reduce context, output and runtime before another connected run; do not expand the sample.";
  }

  return {
    verdict,
    evidenceScope: value.evidenceScope,
    reviewPurpose: value.reviewPurpose,
    strategyBlockers,
    structuralViolations,
    efficiencyRegressions,
    warnings,
    doesNotAuthorizeLinearWrites: true,
    doesNotAuthorizeImplementation: true,
    nextAction,
  };
}

async function runCli() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected product advisory evidence on stdin");
  console.log(JSON.stringify(evaluateProductAdvisory(JSON.parse(raw)), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
