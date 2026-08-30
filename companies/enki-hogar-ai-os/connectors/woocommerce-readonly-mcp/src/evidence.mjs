export const EVIDENCE_ENVELOPE_SCHEMA = "enki-evidence-envelope/v1";
export const ENKI_TIMEZONE = "Europe/Madrid";

const EVIDENCE_STATUSES = new Set(["ok", "partial", "unavailable"]);
const FRESHNESS_STATUSES = new Set(["live", "stale", "historical", "unavailable"]);

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function assertExactKeys(value, allowedKeys, label) {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported field(s): ${unexpected.join(", ")}`);
}

function assertIsoInstant(value, field) {
  if (typeof value !== "string" || !/T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 instant`);
  }
}

function assertLocalDate(value, field) {
  if (value === null) return;
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) {
    throw new Error(`${field} must be YYYY-MM-DD or null`);
  }
  const [, yearText, monthText, dayText] = match;
  const instant = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (instant.getUTCFullYear() !== Number(yearText) || instant.getUTCMonth() !== Number(monthText) - 1 || instant.getUTCDate() !== Number(dayText)) {
    throw new Error(`${field} must be a real calendar date`);
  }
}

export function assertEvidenceEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Evidence envelope must be an object");
  }
  assertExactKeys(envelope, ["schema", "data", "meta"], "Evidence envelope");
  if (envelope.schema !== EVIDENCE_ENVELOPE_SCHEMA) {
    throw new Error(`Evidence envelope schema must be ${EVIDENCE_ENVELOPE_SCHEMA}`);
  }
  const meta = envelope.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("Evidence envelope meta must be an object");
  }
  assertExactKeys(meta, ["source", "fetched_at", "period_start", "period_end", "timezone", "currency", "currencies", "freshness", "status", "partial", "warnings", "contracts"], "Evidence meta");
  if (typeof meta.source !== "string" || !meta.source.trim()) throw new Error("Evidence source is required");
  assertIsoInstant(meta.fetched_at, "meta.fetched_at");
  assertLocalDate(meta.period_start, "meta.period_start");
  assertLocalDate(meta.period_end, "meta.period_end");
  if ((meta.period_start === null) !== (meta.period_end === null)) throw new Error("Evidence period dates must both be set or both be null");
  if (meta.period_start !== null && meta.period_start > meta.period_end) throw new Error("Evidence period_start must not be after period_end");
  if (meta.timezone !== ENKI_TIMEZONE) throw new Error(`Evidence timezone must be ${ENKI_TIMEZONE}`);
  if (!EVIDENCE_STATUSES.has(meta.status)) throw new Error("Unsupported evidence status");
  if (!FRESHNESS_STATUSES.has(meta.freshness)) throw new Error("Unsupported evidence freshness");
  if (typeof meta.partial !== "boolean") throw new Error("Evidence partial must be boolean");
  if (meta.partial !== (meta.status !== "ok")) throw new Error("Evidence partial must agree with status");
  if (!Array.isArray(meta.warnings) || meta.warnings.some((warning) => typeof warning !== "string" || !warning.trim())) {
    throw new Error("Evidence warnings must be non-empty strings");
  }
  if (!Array.isArray(meta.contracts) || meta.contracts.some((contract) => typeof contract !== "string" || !contract.trim())) {
    throw new Error("Evidence contracts must be non-empty strings");
  }
  if (!Array.isArray(meta.currencies) || meta.currencies.some((currency) => !/^[A-Z]{3}$/.test(currency))) {
    throw new Error("Evidence currencies must be ISO-style three-letter codes");
  }
  if (new Set(meta.currencies).size !== meta.currencies.length || [...meta.currencies].sort().some((currency, index) => currency !== meta.currencies[index])) {
    throw new Error("Evidence currencies must be unique and sorted");
  }
  if (meta.currency !== null && !/^[A-Z]{3}$/.test(meta.currency)) {
    throw new Error("Evidence currency must be a three-letter code or null");
  }
  const expectedCurrency = meta.currencies.length === 1 ? meta.currencies[0] : null;
  if (meta.currency !== expectedCurrency) {
    throw new Error("Evidence currency must equal the sole entry in currencies");
  }
  if (meta.status === "unavailable" && envelope.data !== null) {
    throw new Error("Unavailable evidence must carry null data");
  }
  if (meta.status === "unavailable" && meta.freshness !== "unavailable") throw new Error("Unavailable evidence must have unavailable freshness");
  if (meta.status !== "unavailable" && meta.freshness === "unavailable") throw new Error("Only unavailable evidence may have unavailable freshness");
  if (meta.status !== "ok" && meta.warnings.length === 0) throw new Error("Partial or unavailable evidence must explain its limitation");
  if (!meta.contracts.includes(EVIDENCE_ENVELOPE_SCHEMA)) throw new Error("Evidence contracts must include the envelope schema");
  return envelope;
}

export function createEvidenceEnvelope({
  source,
  data,
  fetchedAt = new Date().toISOString(),
  periodStart = null,
  periodEnd = null,
  currencies = [],
  freshness = "live",
  status = "ok",
  partial = status !== "ok",
  warnings = [],
  contracts = [],
}) {
  const normalizedCurrencies = uniqueStrings(currencies.map((currency) => typeof currency === "string" ? currency.toUpperCase() : "")).sort();
  const envelope = {
    schema: EVIDENCE_ENVELOPE_SCHEMA,
    data: data ?? null,
    meta: {
      source,
      fetched_at: fetchedAt,
      period_start: periodStart,
      period_end: periodEnd,
      timezone: ENKI_TIMEZONE,
      currency: normalizedCurrencies.length === 1 ? normalizedCurrencies[0] : null,
      currencies: normalizedCurrencies,
      freshness,
      status,
      partial,
      warnings: uniqueStrings(warnings),
      contracts: uniqueStrings([EVIDENCE_ENVELOPE_SCHEMA, ...contracts]),
    },
  };
  return assertEvidenceEnvelope(envelope);
}
