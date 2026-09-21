#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(skillDir, "references", "engineering-engagement-contract.json");

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value;
}

function strings(value, field, {nonEmpty = false} = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  if (nonEmpty && value.length === 0) throw new Error(`${field} must not be empty`);
  return value;
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

export function loadEngineeringEngagementContract() {
  return JSON.parse(readFileSync(contractPath, "utf8"));
}

export function evaluateEngineeringEngagement(evidence, contract = loadEngineeringEngagementContract()) {
  const value = object(evidence, "evidence");
  if (value.schema !== "optiak-engineering-engagement-evidence/v1") {
    throw new Error("schema must be optiak-engineering-engagement-evidence/v1");
  }
  const request = contract.requestClasses[value.requestClass];
  if (!request) throw new Error(`unsupported requestClass ${value.requestClass}`);
  const lead = text(value.lead, "lead");
  const question = text(value.question, "question");
  const evidenceRefs = strings(value.evidenceRefs ?? [], "evidenceRefs", {nonEmpty: true});
  const excludedWork = strings(value.excludedWork ?? [], "excludedWork", {nonEmpty: true});
  const outputs = strings(value.outputs ?? [], "outputs");
  if (!Array.isArray(value.consultations)) throw new Error("consultations must be an array");
  const consultations = value.consultations.map((candidate, index) => {
    const consultation = object(candidate, `consultations[${index}]`);
    return {
      agent: text(consultation.agent, `consultations[${index}].agent`),
      question: text(consultation.question, `consultations[${index}].question`),
      expectedDelta: text(consultation.expectedDelta, `consultations[${index}].expectedDelta`),
    };
  });
  const consulted = consultations.map((item) => item.agent);
  const violations = [];

  if (lead !== request.lead) violations.push("wrong_lead");
  if (consulted.includes(lead)) violations.push("lead_must_not_be_consulted");
  if (new Set(consulted).size !== consulted.length) violations.push("duplicate_consulted_agent");
  if (consulted.length > contract.globalRules.maximumConsultedAgents) violations.push("consulted_agent_limit_exceeded");
  for (const agent of consulted) {
    if (!request.optionalConsulted.includes(agent)) violations.push(`unnecessary_consulted_agent:${agent}`);
  }
  const consultationQuestions = consultations.map((item) => item.question.toLowerCase());
  const consultationDeltas = consultations.map((item) => item.expectedDelta.toLowerCase());
  if (consultationQuestions.some((item) => item === question.toLowerCase())) violations.push("consultation_must_answer_distinct_question");
  if (new Set(consultationQuestions).size !== consultationQuestions.length) violations.push("duplicate_consultation_question");
  if (new Set(consultationDeltas).size !== consultationDeltas.length) violations.push("duplicate_consultation_delta");
  if (outputs.length !== 1 || outputs[0] !== request.canonicalOutput) violations.push("single_canonical_output_required");
  if (new Set(evidenceRefs).size !== evidenceRefs.length) violations.push("duplicate_evidence_reference");
  if (new Set(excludedWork).size !== excludedWork.length) violations.push("duplicate_exclusion");
  if (value.blanketFanout !== false) violations.push("blanket_fanout_forbidden");
  if (value.parallelFullReports !== 0) violations.push("parallel_full_reports_forbidden");
  if (value.repeatedAcceptedEvidence !== false) violations.push("accepted_evidence_must_be_reused");
  if (value.contributorMode !== "delta_only") violations.push("contributors_must_return_delta_only");
  if (value.externalWrites !== 0) violations.push("external_writes_forbidden");

  return {
    schema: "optiak-engineering-engagement-result/v1",
    verdict: violations.length === 0 ? "routing_ready" : "routing_changes_required",
    requestClass: value.requestClass,
    expectedLead: request.lead,
    canonicalOutput: request.canonicalOutput,
    nextGate: request.nextGate,
    consultedAgents: consulted,
    violations: [...new Set(violations)],
    doesNotAuthorizeImplementation: true,
    doesNotAuthorizeRelease: true
  };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error("expected engagement evidence on stdin");
  const result = evaluateEngineeringEngagement(JSON.parse(raw));
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict !== "routing_ready") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
