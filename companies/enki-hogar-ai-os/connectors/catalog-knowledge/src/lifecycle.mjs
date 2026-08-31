import {createHash, randomBytes, randomUUID} from "node:crypto";
import {assertSafeText, assertSlug} from "./normalization.mjs";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function equalImpact(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function resolvePack(sql, {packKey, version}, {lock = false} = {}) {
  const key = assertSlug(packKey, "pack key");
  const release = String(version || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(release)) throw new Error("version must be semver x.y.z");
  const suffix = lock ? " FOR UPDATE" : "";
  const rows = await sql.unsafe(`
    SELECT id, pack_key, version, brand_slug, domain_slug, status, snapshot_date::text
    FROM support_packs
    WHERE pack_key = $1 AND version = $2${suffix}
  `, [key, release]);
  if (!rows[0]) throw new Error("support pack not found");
  return rows[0];
}

async function scalar(sql, query, parameters) {
  const [row] = await sql.unsafe(query, parameters);
  return Number(row?.count || 0);
}

export async function impactForPack(sql, packId) {
  return {
    pack_rows: 1,
    sources: await scalar(sql, "SELECT count(*) FROM support_sources WHERE pack_id = $1", [packId]),
    entities: await scalar(sql, "SELECT count(*) FROM support_entities WHERE pack_id = $1", [packId]),
    facts: await scalar(sql, "SELECT count(*) FROM support_facts WHERE pack_id = $1", [packId]),
    relations: await scalar(sql, "SELECT count(*) FROM support_relations WHERE pack_id = $1", [packId]),
    configuration_rules: await scalar(sql, "SELECT count(*) FROM support_configuration_rules WHERE pack_id = $1", [packId]),
    sku_crosswalks: await scalar(sql, "SELECT count(*) FROM support_sku_crosswalks WHERE pack_id = $1", [packId]),
    support_chunks: await scalar(sql, "SELECT count(*) FROM support_chunks WHERE pack_id = $1", [packId]),
  };
}

async function audit(sql, actor, action, packId, details = {}) {
  await sql`
    INSERT INTO support_admin_audit (id, actor, action, pack_id, details)
    VALUES (${randomUUID()}, ${actor}, ${action}, ${packId}, ${JSON.stringify(details)}::jsonb)
  `;
}

export async function listPacks(sql, {brand = null, domain = null} = {}) {
  return sql.unsafe(`
    SELECT pack_key, version, brand_slug AS brand, domain_slug AS domain,
      snapshot_date::text, source_revision_kind, source_revision, manifest_sha256, status,
      superseded_at::text, created_at::text
    FROM support_packs
    WHERE ($1::text IS NULL OR brand_slug = $1)
      AND ($2::text IS NULL OR domain_slug = $2)
    ORDER BY brand_slug, domain_slug, created_at DESC
  `, [brand ? assertSlug(brand, "brand") : null, domain ? assertSlug(domain, "domain") : null]);
}

export async function createPurgePreview(sql, selector, actor = "local-operator", {ttlMinutes = 15} = {}) {
  const operator = assertSafeText(actor, "actor", {max: 120, commercialValues: false});
  return sql.begin(async (tx) => {
    const pack = await resolvePack(tx, selector, {lock: true});
    if (pack.status !== "superseded") throw new Error("Only a superseded support pack can be purged");
    const impact = await impactForPack(tx, pack.id);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await tx`
      INSERT INTO support_admin_operation_previews (token_hash, operation, pack_id, impact, expires_at)
      VALUES (${hashToken(token)}, 'purge_superseded_pack', ${pack.id}, ${JSON.stringify(impact)}::jsonb, ${expiresAt})
    `;
    await audit(tx, operator, "support_pack_purge_preview", pack.id, {packKey: pack.pack_key, version: pack.version, impact, expiresAt: expiresAt.toISOString()});
    return {
      pack_key: pack.pack_key,
      version: pack.version,
      status: pack.status,
      impact,
      expires_at: expiresAt.toISOString(),
      confirmation_token: token,
    };
  });
}

export async function applyPurge(sql, token, actor = "local-operator") {
  if (!token || token.length < 32) throw new Error("A valid confirmation token is required");
  const operator = assertSafeText(actor, "actor", {max: 120, commercialValues: false});
  return sql.begin(async (tx) => {
    const [preview] = await tx`
      SELECT token_hash, pack_id, impact, expires_at, consumed_at
      FROM support_admin_operation_previews
      WHERE token_hash = ${hashToken(token)}
      FOR UPDATE
    `;
    if (!preview || preview.consumed_at) throw new Error("Confirmation token is invalid or already consumed");
    if (new Date(preview.expires_at).getTime() <= Date.now()) throw new Error("Confirmation token has expired; create a new preview");
    const [pack] = await tx`SELECT id, pack_key, version, status FROM support_packs WHERE id = ${preview.pack_id} FOR UPDATE`;
    if (!pack) throw new Error("Support pack no longer exists");
    if (pack.status !== "superseded") throw new Error("Support pack is no longer superseded; create a new preview");
    const currentImpact = await impactForPack(tx, pack.id);
    const recordedImpact = typeof preview.impact === "string" ? JSON.parse(preview.impact) : preview.impact;
    if (!equalImpact(currentImpact, recordedImpact)) throw new Error("Purge impact changed after preview; create a new preview");
    await tx`DELETE FROM support_packs WHERE id = ${pack.id}`;
    await tx`UPDATE support_admin_operation_previews SET consumed_at = now() WHERE token_hash = ${preview.token_hash}`;
    await audit(tx, operator, "support_pack_purged", pack.id, {packKey: pack.pack_key, version: pack.version, impact: currentImpact});
    return {pack_key: pack.pack_key, version: pack.version, purged: true, impact: currentImpact};
  });
}
