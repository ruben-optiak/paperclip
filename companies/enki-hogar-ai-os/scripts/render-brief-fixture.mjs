#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {assertEvidenceEnvelope, createEvidenceEnvelope, ENKI_TIMEZONE} from "../connectors/woocommerce-readonly-mcp/src/evidence.mjs";

function instant(value, field) {
  if (typeof value !== "string" || !/T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 instant`);
  }
  return new Date(value);
}

function stringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

function freshnessPolicy(input, source) {
  const value = input.source_policies?.[source]?.max_age_hours;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`source_policies.${source}.max_age_hours must be a positive number`);
  }
  return value;
}

function normalizeEvidence(sourceEnvelope, asOf, input) {
  const source = assertEvidenceEnvelope(sourceEnvelope);
  const maxAgeHours = freshnessPolicy(input, source.meta.source);
  if (source.meta.status === "unavailable") return structuredClone(source);

  const ageHours = (asOf.getTime() - instant(source.meta.fetched_at, `${source.meta.source}.meta.fetched_at`).getTime()) / 3_600_000;
  const normalized = structuredClone(source);
  if (ageHours < 0) {
    normalized.meta.status = "partial";
    normalized.meta.partial = true;
    normalized.meta.warnings = [...new Set([...normalized.meta.warnings, "Source timestamp is later than brief as_of; verify clock synchronization"])];
  } else if (ageHours > maxAgeHours) {
    normalized.meta.freshness = "stale";
    normalized.meta.status = "partial";
    normalized.meta.partial = true;
    normalized.meta.warnings = [...new Set([...normalized.meta.warnings, `Evidence exceeds the ${maxAgeHours}-hour freshness policy and is historical only`])];
  }
  return assertEvidenceEnvelope(normalized);
}

export function buildBrief(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Brief input must be an object");
  if (input.timezone !== ENKI_TIMEZONE) throw new Error(`Brief timezone must be ${ENKI_TIMEZONE}`);
  const asOf = instant(input.as_of, "as_of");
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new Error("Brief evidence must be a non-empty array");

  const sources = input.evidence.map((source) => normalizeEvidence(source, asOf, input));
  const sourceNames = sources.map((source) => source.meta.source);
  if (new Set(sourceNames).size !== sourceNames.length) throw new Error("Brief evidence sources must be unique");
  const alerts = sources.flatMap((source) => {
    if (source.meta.status === "ok" && source.meta.freshness === "live") return [];
    return [`${source.meta.source}: ${source.meta.status}/${source.meta.freshness}`];
  });
  const currencies = [...new Set(sources.flatMap((source) => source.meta.currencies))].sort();
  const periods = sources.filter((source) => source.meta.period_start !== null);
  const periodStart = periods.length > 0 ? periods.map((source) => source.meta.period_start).sort()[0] : null;
  const periodEnd = periods.length > 0 ? periods.map((source) => source.meta.period_end).sort().at(-1) : null;

  return createEvidenceEnvelope({
    source: "enki.daily-brief",
    fetchedAt: asOf.toISOString(),
    periodStart,
    periodEnd,
    currencies,
    status: alerts.length > 0 ? "partial" : "ok",
    partial: alerts.length > 0,
    warnings: alerts,
    contracts: ["enki-metrics/v1#daily-brief"],
    data: {
      as_of: input.as_of,
      sources,
      alerts,
      decisions_pending: stringList(input.decisions_pending, "decisions_pending"),
      proposals: stringList(input.proposals, "proposals"),
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  console.log(JSON.stringify(buildBrief(JSON.parse(readFileSync(process.argv[2], "utf8"))), null, 2));
}
