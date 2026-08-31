import {createHash} from "node:crypto";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTITY_KEY = /^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/;
const COMMERCIAL_KEY = /^(?:price|regular_price|sale_price|pvp|stock|stock_quantity|stock_status|availability|web_status|status_web|catalog_visibility|woocommerce_category|merchant_status|seo_status|current_category)$/i;
const CURRENCY_VALUE = /(?:\b(?:EUR|USD|GBP)\b|[$€£])\s*[-+]?\d|[-+]?\d[\d.,]*\s*(?:\b(?:EUR|USD|GBP)\b|[$€£])/i;
const COMMERCIAL_ASSIGNMENT = /\b(?:pvp|precio|price|regular_price|sale_price|stock|stock_quantity|availability)\s*[:=]\s*[-+]?\d/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CREDENTIAL = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,})\b/;
const CREDENTIAL_ASSIGNMENT = /\b(?:api[_ -]?key|access[_ -]?token|password|passwd|secret|consumer[_ -]?(?:key|secret)|client[_ -]?secret)\s*[:=]\s*\S+/i;

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSlug(value, label) {
  const cleaned = String(value || "").trim();
  if (!SLUG.test(cleaned) || cleaned.length > 120) throw new Error(`${label} must be a lowercase hyphenated slug`);
  return cleaned;
}

export function assertEntityKey(value, label = "entity_key") {
  const cleaned = String(value || "").trim();
  if (!ENTITY_KEY.test(cleaned) || cleaned.length > 160) throw new Error(`${label} has an invalid stable key`);
  return cleaned;
}

export function assertDate(value, label) {
  const cleaned = String(value || "").trim();
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const instant = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || Number.isNaN(instant.getTime())
    || instant.getUTCFullYear() !== Number(match[1])
    || instant.getUTCMonth() + 1 !== Number(match[2])
    || instant.getUTCDate() !== Number(match[3])) {
    throw new Error(`${label} must be a real date in YYYY-MM-DD format`);
  }
  return cleaned;
}

export function assertInstant(value, label) {
  const cleaned = String(value || "").trim();
  const parsed = Date.parse(cleaned);
  if (!cleaned || Number.isNaN(parsed) || !/[zZ]|[+-]\d\d:\d\d$/.test(cleaned)) throw new Error(`${label} must be an ISO-8601 instant with timezone`);
  return new Date(parsed).toISOString();
}

export function looksLikeMachinePath(value) {
  const text = String(value || "").trim();
  if (!text || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false;
  return /(?:^|[\s|;,])(?:~\/|\/(?:Users|home|private|var|tmp|opt|srv|mnt)\/|[A-Za-z]:\\)/.test(text);
}

export function assertSafeText(value, label, {required = true, max = 50000, commercialValues = true} = {}) {
  const cleaned = String(value ?? "").trim();
  if (required && !cleaned) throw new Error(`${label} is required`);
  if (cleaned.length > max) throw new Error(`${label} exceeds ${max} characters`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(cleaned)) throw new Error(`${label} contains control characters`);
  if (looksLikeMachinePath(cleaned)) throw new Error(`${label} contains a machine-specific path`);
  if (EMAIL.test(cleaned)) throw new Error(`${label} contains an email address; support packs must not contain PII`);
  if (CREDENTIAL.test(cleaned) || CREDENTIAL_ASSIGNMENT.test(cleaned) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(cleaned)) {
    throw new Error(`${label} contains credential-like material`);
  }
  if (commercialValues && (CURRENCY_VALUE.test(cleaned) || COMMERCIAL_ASSIGNMENT.test(cleaned))) {
    throw new Error(`${label} contains a live/commercial value; prices and stock never belong in support knowledge`);
  }
  return cleaned;
}

export function assertTechnicalFactKey(value) {
  const key = assertEntityKey(value, "fact_key");
  if (COMMERCIAL_KEY.test(key) || /(?:^|[._-])(?:price|pvp|stock|availability|merchant|seo|web-status)(?:$|[._-])/.test(key)) {
    throw new Error(`Forbidden commercial fact_key: ${key}`);
  }
  return key;
}

export function assertLogicalLocator(value, label = "locator") {
  const raw = String(value ?? "").trim();
  let preliminary;
  try { preliminary = new URL(raw); } catch { /* normalized error below */ }
  if (preliminary?.username || preliminary?.password) throw new Error(`${label} must not contain credentials`);
  let cleaned;
  try {
    cleaned = assertSafeText(value, label, {max: 1000, commercialValues: false});
  } catch (error) {
    throw new Error(`${label} must be a logical locator: ${error.message}`);
  }
  let parsed;
  try { parsed = preliminary || new URL(cleaned); } catch { throw new Error(`${label} must be an https:// or enki-source:// logical locator`); }
  if (!new Set(["https:", "enki-source:", "enki-repo:"]).has(parsed.protocol)) throw new Error(`${label} uses an unsupported locator scheme`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials`);
  for (const key of parsed.searchParams.keys()) {
    if (/(?:token|password|secret|consumer|api.?key|signature|credential)/i.test(key)) throw new Error(`${label} must not contain credentials`);
  }
  return cleaned;
}

export function parseBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${label} must be true or false`);
}

export function parseJson(value, label, {kind = "object", allowEmpty = true} = {}) {
  const source = String(value ?? "").trim();
  if (!source && allowEmpty) return kind === "array" ? [] : {};
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new Error(`${label} must contain valid JSON`); }
  if (kind === "array" && !Array.isArray(parsed)) throw new Error(`${label} must contain a JSON array`);
  if (kind === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) throw new Error(`${label} must contain a JSON object`);
  assertNoCommercialObject(parsed, label);
  return parsed;
}

function assertNoCommercialObject(value, label, path = "") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoCommercialObject(item, label, `${path}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const current = path ? `${path}.${key}` : key;
      if (COMMERCIAL_KEY.test(key) || (/price/i.test(key) && key !== "requires_live_price")) {
        throw new Error(`${label} contains forbidden commercial key ${current}`);
      }
      assertNoCommercialObject(item, label, current);
    }
    return;
  }
  if (typeof value === "string") assertSafeText(value, `${label}${path ? `.${path}` : ""}`, {required: false, max: 5000});
}

export function evidenceSourceKey(value) {
  const evidence = assertSafeText(value, "evidence_ref", {max: 300, commercialValues: false});
  return evidence.split("#", 1)[0];
}

export function entityRef({brandSlug, domainSlug, entityKey}) {
  return `${brandSlug}:${domainSlug}:${entityKey}`;
}

export function parseEntityRef(value) {
  const cleaned = String(value || "").trim();
  const parts = cleaned.split(":");
  if (parts.length !== 3) throw new Error("entity_ref must use brand:domain:entity-key");
  return {
    brandSlug: assertSlug(parts[0], "entity_ref brand"),
    domainSlug: assertSlug(parts[1], "entity_ref domain"),
    entityKey: assertEntityKey(parts[2], "entity_ref entity"),
  };
}
