import {vectorLiteral} from "./embeddings.mjs";
import {entityRef, evidenceSourceKey, parseEntityRef} from "./normalization.mjs";

function mergeRanked(lexical, semantic, limit) {
  const merged = new Map();
  const add = (rows, source) => rows.forEach((row, index) => {
    const current = merged.get(row.id) || {...row, rank_score: 0, matched_by: []};
    current.rank_score += 1 / (60 + index + 1);
    if (!current.matched_by.includes(source)) current.matched_by.push(source);
    merged.set(row.id, current);
  });
  add(lexical, "lexical");
  add(semantic, "semantic");
  return [...merged.values()].sort((left, right) => right.rank_score - left.rank_score).slice(0, limit);
}

function withoutInternalIds(rows) {
  return rows.map(({id: _id, entity_id: _entityId, ...row}) => row);
}

function refFromRow(row) {
  return entityRef({brandSlug: row.brand, domainSlug: row.domain, entityKey: row.entity_key});
}

function publicEntity(row) {
  const {id: _id, pack_id: _packId, entity_key: _entityKey, ...rest} = row;
  return {...rest, entity_ref: refFromRow(row)};
}

export class ProductSupportRepository {
  constructor(sql, {embeddingClient = null} = {}) {
    this.sql = sql;
    this.embeddingClient = embeddingClient;
  }

  async health() {
    const [row] = await this.sql`
      SELECT
        current_setting('default_transaction_read_only') AS default_read_only,
        COALESCE((SELECT max(version) FROM support_schema_migrations), 0)::int AS schema_version
    `;
    if (row.default_read_only !== "on") throw new Error("Product Support MCP database role is not read-only");
    return {schema_version: row.schema_version};
  }

  async resolveProduct({woo_sku = null, manufacturer_ref = null, query = null, brand = null, domain = null, limit = 10}) {
    const rows = await this.sql.unsafe(`
      SELECT DISTINCT ON (p.brand_slug, p.domain_slug, e.entity_key, COALESCE(x.woo_variation_sku, ''), COALESCE(x.woo_parent_sku, ''))
        e.id, e.entity_key, e.entity_kind, e.manufacturer_ref, e.name, e.series, e.category,
        p.pack_key, p.version AS pack_version, p.brand_slug AS brand, p.domain_slug AS domain,
        p.snapshot_date::text, p.source_revision_kind, p.source_revision,
        x.woo_parent_sku, x.woo_variation_sku, x.mapping_kind, x.evidence_ref,
        s.source_key, s.title AS source_title, s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date
      FROM support_entities e
      JOIN support_packs p ON p.id = e.pack_id AND p.status = 'active'
      LEFT JOIN support_sku_crosswalks x ON x.entity_id = e.id AND x.pack_id = p.id
      LEFT JOIN support_sources s ON s.id = x.source_id
      WHERE ($1::text IS NULL OR upper(x.woo_parent_sku) = upper($1) OR upper(x.woo_variation_sku) = upper($1))
        AND ($2::text IS NULL OR upper(e.manufacturer_ref) = upper($2) OR upper(x.manufacturer_ref) = upper($2))
        AND ($3::text IS NULL OR e.name ILIKE '%' || $3 || '%' OR COALESCE(e.manufacturer_ref, '') ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR p.brand_slug = $4)
        AND ($5::text IS NULL OR p.domain_slug = $5)
        AND (($1::text IS NULL) OR x.id IS NOT NULL)
      ORDER BY p.brand_slug, p.domain_slug, e.entity_key, COALESCE(x.woo_variation_sku, ''), COALESCE(x.woo_parent_sku, ''),
        CASE WHEN upper(x.woo_variation_sku) = upper($1) OR upper(x.woo_parent_sku) = upper($1) OR upper(e.manufacturer_ref) = upper($2) THEN 0 ELSE 1 END,
        similarity(e.name, COALESCE($3, '')) DESC
      LIMIT $6
    `, [woo_sku, manufacturer_ref, query, brand, domain, limit]);
    return {
      matches: rows.map(publicEntity),
      resolution: woo_sku ? "woo_sku_crosswalk" : manufacturer_ref ? "manufacturer_reference" : "technical_name_search",
      caveats: [
        "The crosswalk maps identities only; current WooCommerce price, stock, publication state and options are intentionally absent.",
        "A text match is a candidate, not proof. Use an exact crosswalk or escalate ambiguous results.",
      ],
    };
  }

  async activeEntity(reference) {
    const parsed = parseEntityRef(reference);
    const rows = await this.sql.unsafe(`
      SELECT e.id, e.pack_id, e.entity_key, e.entity_kind, e.manufacturer_ref, e.name, e.series, e.category, e.summary,
        p.pack_key, p.version AS pack_version, p.brand_slug AS brand, p.domain_slug AS domain,
        p.snapshot_date::text, p.approved_at::text, p.source_revision_kind, p.source_revision
      FROM support_entities e
      JOIN support_packs p ON p.id = e.pack_id AND p.status = 'active'
      WHERE p.brand_slug = $1 AND p.domain_slug = $2 AND e.entity_key = $3
      LIMIT 1
    `, [parsed.brandSlug, parsed.domainSlug, parsed.entityKey]);
    return rows[0] || null;
  }

  async getTechnicalProfile({entity_ref}) {
    const entity = await this.activeEntity(entity_ref);
    if (!entity) return null;
    const [facts, mappings] = await Promise.all([
      this.sql.unsafe(`
        SELECT f.fact_key, f.value_text AS value, f.unit, f.applicability, f.confidence::float8,
          f.evidence_ref, f.source_page, s.source_key, s.title AS source_title,
          s.source_kind, s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date
        FROM support_facts f
        JOIN support_sources s ON s.id = f.source_id
        WHERE f.entity_id = $1
        ORDER BY f.fact_key, f.evidence_ref
      `, [entity.id]),
      this.sql.unsafe(`
        SELECT x.manufacturer_ref, x.woo_parent_sku, x.woo_variation_sku, x.mapping_kind,
          x.evidence_ref, x.approved_at::text, s.source_key, s.snapshot_date::text AS source_snapshot_date
        FROM support_sku_crosswalks x
        JOIN support_sources s ON s.id = x.source_id
        WHERE x.entity_id = $1
        ORDER BY x.mapping_kind, x.woo_parent_sku, x.woo_variation_sku
      `, [entity.id]),
    ]);
    return {
      entity: publicEntity(entity),
      facts,
      identity_crosswalk: mappings,
      authority: {
        technical: "active-approved-support-pack",
        commercial: "WooCommerce live",
        commercial_fields_included: false,
      },
      caveats: ["Use WooCommerce live for current price, stock, publication state, categories and selectable options."],
    };
  }

  async checkCompatibility({left_entity_ref, right_entity_ref}) {
    const [left, right] = await Promise.all([this.activeEntity(left_entity_ref), this.activeEntity(right_entity_ref)]);
    if (!left || !right) return {status: "unknown", reason: "entity_not_covered", relations: []};
    const rows = await this.sql.unsafe(`
      SELECT r.relation_type, r.condition_json AS condition, r.evidence_ref, r.source_page,
        source_entity.entity_key AS from_entity_key, target_entity.entity_key AS to_entity_key,
        s.source_key, s.title AS source_title, s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date,
        p.brand_slug AS brand, p.domain_slug AS domain
      FROM support_relations r
      JOIN support_entities source_entity ON source_entity.id = r.from_entity_id
      JOIN support_entities target_entity ON target_entity.id = r.to_entity_id
      JOIN support_sources s ON s.id = r.source_id
      JOIN support_packs p ON p.id = r.pack_id AND p.status = 'active'
      WHERE (r.from_entity_id = $1 AND r.to_entity_id = $2)
         OR (r.from_entity_id = $2 AND r.to_entity_id = $1)
      ORDER BY CASE r.relation_type WHEN 'excludes' THEN 0 WHEN 'compatible_with' THEN 1 WHEN 'requires' THEN 2 ELSE 3 END
    `, [left.id, right.id]);
    let status = "unknown";
    let reason = "no_explicit_structured_relation";
    if (rows.some((row) => row.relation_type === "excludes")) { status = "incompatible"; reason = "explicit_exclusion"; }
    else if (rows.some((row) => row.relation_type === "compatible_with")) { status = "compatible"; reason = "explicit_compatibility"; }
    else if (rows.some((row) => row.relation_type === "requires")) { status = "compatible_with_requirements"; reason = "explicit_requirement"; }
    return {
      status,
      reason,
      left: publicEntity(left),
      right: publicEntity(right),
      relations: rows,
      caveats: ["Semantic support text is never used to infer compatibility. Unknown means no approved structured rule was found."],
    };
  }

  async listAllowedOptions({entity_ref, axis = null}) {
    const entity = await this.activeEntity(entity_ref);
    if (!entity) return null;
    const rules = await this.sql.unsafe(`
      SELECT r.rule_key, r.axis, r.representation, r.affects_sku, r.affects_price, r.affects_stock,
        r.allowed_values, r.condition_json AS condition, r.effect_json AS effect,
        r.evidence_ref, r.source_page, s.source_key, s.title AS source_title,
        s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date
      FROM support_configuration_rules r
      JOIN support_sources s ON s.id = r.source_id
      WHERE r.entity_id = $1 AND ($2::text IS NULL OR lower(r.axis) = lower($2))
      ORDER BY r.axis, r.rule_key
    `, [entity.id, axis]);
    return {
      entity: publicEntity(entity),
      rules,
      caveats: ["affects_price marks a live-price dependency; this service never stores or calculates the current amount."],
    };
  }

  async getConfigurationModel({entity_ref}) {
    const entity = await this.activeEntity(entity_ref);
    if (!entity) return null;
    const [rulesResult, relations] = await Promise.all([
      this.listAllowedOptions({entity_ref, axis: null}),
      this.sql.unsafe(`
        SELECT r.relation_type, r.condition_json AS condition, r.evidence_ref, r.source_page,
          source_entity.entity_key AS from_entity_key, target_entity.entity_key AS to_entity_key,
          p.brand_slug AS brand, p.domain_slug AS domain,
          s.source_key, s.snapshot_date::text AS source_snapshot_date
        FROM support_relations r
        JOIN support_entities source_entity ON source_entity.id = r.from_entity_id
        JOIN support_entities target_entity ON target_entity.id = r.to_entity_id
        JOIN support_sources s ON s.id = r.source_id
        JOIN support_packs p ON p.id = r.pack_id AND p.status = 'active'
        WHERE r.from_entity_id = $1 OR r.to_entity_id = $1
        ORDER BY r.relation_type, source_entity.entity_key, target_entity.entity_key
      `, [entity.id]),
    ]);
    return {
      entity: publicEntity(entity),
      rules: rulesResult.rules,
      relations,
      model_contract: {
        identities: ["manufacturer_technical_entity", "woocommerce_sellable_sku", "configuration_or_component_selection"],
        representations: ["variation", "configurator_option", "component_product", "assisted_sale"],
        cartesian_expansion: "forbidden_unless_each_axis_is_an_approved_sellable_variation",
      },
    };
  }

  async searchSupport({query, brand = null, domain = null, topic = null, entity_ref = null, limit = 8}) {
    const parsed = entity_ref ? parseEntityRef(entity_ref) : null;
    const parameters = [query, brand, domain, topic, parsed?.brandSlug || null, parsed?.domainSlug || null, parsed?.entityKey || null, limit * 3];
    const lexical = await this.sql.unsafe(`
      SELECT k.id, k.chunk_key, k.topic, k.content, k.evidence_ref, k.source_page,
        p.pack_key, p.version AS pack_version, p.brand_slug AS brand, p.domain_slug AS domain,
        p.snapshot_date::text, p.source_revision_kind, p.source_revision, e.entity_key, e.name AS entity_name,
        s.source_key, s.title AS source_title, s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date,
        (ts_rank_cd(k.search_vector, websearch_to_tsquery('simple', $1)) + similarity(k.content, $1))::float8 AS lexical_score
      FROM support_chunks k
      JOIN support_packs p ON p.id = k.pack_id AND p.status = 'active'
      JOIN support_sources s ON s.id = k.source_id
      LEFT JOIN support_entities e ON e.id = k.entity_id
      WHERE (k.search_vector @@ websearch_to_tsquery('simple', $1) OR similarity(k.content, $1) > 0.08)
        AND ($2::text IS NULL OR p.brand_slug = $2)
        AND ($3::text IS NULL OR p.domain_slug = $3)
        AND ($4::text IS NULL OR k.topic = $4)
        AND ($5::text IS NULL OR (p.brand_slug = $5 AND p.domain_slug = $6 AND e.entity_key = $7))
      ORDER BY lexical_score DESC, p.snapshot_date DESC
      LIMIT $8
    `, parameters);
    const format = (rows) => withoutInternalIds(rows).map((row) => ({...row, entity_ref: row.entity_key ? `${row.brand}:${row.domain}:${row.entity_key}` : null}));
    if (!this.embeddingClient) {
      return {retrieval_mode: "lexical", warnings: ["Semantic retrieval is not configured"], results: format(lexical.slice(0, limit)), compatibility_authority: false};
    }
    try {
      const [queryVector] = await this.embeddingClient.embed([query]);
      const semantic = await this.sql.unsafe(`
        SELECT k.id, k.chunk_key, k.topic, k.content, k.evidence_ref, k.source_page,
          p.pack_key, p.version AS pack_version, p.brand_slug AS brand, p.domain_slug AS domain,
          p.snapshot_date::text, p.source_revision_kind, p.source_revision, e.entity_key, e.name AS entity_name,
          s.source_key, s.title AS source_title, s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date,
          (k.embedding <=> $1::vector)::float8 AS semantic_distance
        FROM support_chunks k
        JOIN support_packs p ON p.id = k.pack_id AND p.status = 'active'
        JOIN support_sources s ON s.id = k.source_id
        LEFT JOIN support_entities e ON e.id = k.entity_id
        WHERE k.embedding IS NOT NULL AND k.embedding_model = $2 AND k.embedding_dimensions = $3
          AND ($4::text IS NULL OR p.brand_slug = $4)
          AND ($5::text IS NULL OR p.domain_slug = $5)
          AND ($6::text IS NULL OR k.topic = $6)
          AND ($7::text IS NULL OR (p.brand_slug = $7 AND p.domain_slug = $8 AND e.entity_key = $9))
        ORDER BY k.embedding <=> $1::vector
        LIMIT $10
      `, [vectorLiteral(queryVector), this.embeddingClient.model, queryVector.length, brand, domain, topic, parsed?.brandSlug || null, parsed?.domainSlug || null, parsed?.entityKey || null, limit * 3]);
      return {retrieval_mode: "hybrid", warnings: [], results: format(mergeRanked(lexical, semantic, limit)), compatibility_authority: false};
    } catch (error) {
      return {
        retrieval_mode: "lexical_fallback",
        warnings: [`Semantic retrieval unavailable: ${error instanceof Error ? error.message : "unknown error"}`],
        results: format(lexical.slice(0, limit)),
        compatibility_authority: false,
      };
    }
  }

  async getEvidence({evidence_ref, brand = null, domain = null}) {
    const base = [evidence_ref, brand, domain];
    const sourceKey = evidenceSourceKey(evidence_ref);
    const [sources, facts, relations, rules, chunks] = await Promise.all([
      this.sql.unsafe(`
        SELECT DISTINCT p.pack_key, p.version AS pack_version, p.brand_slug AS brand, p.domain_slug AS domain,
          p.snapshot_date::text, p.source_revision_kind, p.source_revision, s.source_key, s.title AS source_title,
          s.source_kind, s.locator AS source_uri, s.snapshot_date::text AS source_snapshot_date, s.source_sha256
        FROM support_sources s
        JOIN support_packs p ON p.id = s.pack_id AND p.status = 'active'
        WHERE s.source_key = $1 AND ($2::text IS NULL OR p.brand_slug = $2) AND ($3::text IS NULL OR p.domain_slug = $3)
      `, [sourceKey, brand, domain]),
      this.sql.unsafe(`
        SELECT e.entity_key, f.fact_key, f.value_text AS value, f.unit, f.applicability, f.confidence::float8, f.source_page
        FROM support_facts f JOIN support_entities e ON e.id = f.entity_id JOIN support_packs p ON p.id = f.pack_id AND p.status = 'active'
        WHERE f.evidence_ref = $1 AND ($2::text IS NULL OR p.brand_slug = $2) AND ($3::text IS NULL OR p.domain_slug = $3)
      `, base),
      this.sql.unsafe(`
        SELECT source_entity.entity_key AS from_entity_key, r.relation_type, target_entity.entity_key AS to_entity_key, r.condition_json AS condition, r.source_page
        FROM support_relations r JOIN support_entities source_entity ON source_entity.id = r.from_entity_id
        JOIN support_entities target_entity ON target_entity.id = r.to_entity_id JOIN support_packs p ON p.id = r.pack_id AND p.status = 'active'
        WHERE r.evidence_ref = $1 AND ($2::text IS NULL OR p.brand_slug = $2) AND ($3::text IS NULL OR p.domain_slug = $3)
      `, base),
      this.sql.unsafe(`
        SELECT e.entity_key, r.rule_key, r.axis, r.representation, r.affects_sku, r.affects_price, r.affects_stock,
          r.allowed_values, r.condition_json AS condition, r.effect_json AS effect, r.source_page
        FROM support_configuration_rules r JOIN support_entities e ON e.id = r.entity_id JOIN support_packs p ON p.id = r.pack_id AND p.status = 'active'
        WHERE r.evidence_ref = $1 AND ($2::text IS NULL OR p.brand_slug = $2) AND ($3::text IS NULL OR p.domain_slug = $3)
      `, base),
      this.sql.unsafe(`
        SELECT k.chunk_key, k.topic, k.content, e.entity_key, k.source_page
        FROM support_chunks k LEFT JOIN support_entities e ON e.id = k.entity_id JOIN support_packs p ON p.id = k.pack_id AND p.status = 'active'
        WHERE k.evidence_ref = $1 AND ($2::text IS NULL OR p.brand_slug = $2) AND ($3::text IS NULL OR p.domain_slug = $3)
      `, base),
    ]);
    return {evidence_ref, sources, facts, relations, configuration_rules: rules, support_chunks: chunks};
  }

  async coverage() {
    const [overall, scopes, categories] = await Promise.all([
      this.sql`
        WITH active_packs AS (
          SELECT id, brand_slug, domain_slug, snapshot_date
          FROM support_packs
          WHERE status = 'active'
        )
        SELECT
          count(*)::int AS active_packs,
          count(DISTINCT brand_slug)::int AS brands,
          count(DISTINCT domain_slug)::int AS domains,
          (SELECT count(*)::int FROM support_entities e JOIN active_packs p ON p.id = e.pack_id) AS technical_entities,
          (SELECT count(*)::int FROM support_facts f JOIN active_packs p ON p.id = f.pack_id) AS technical_facts,
          (SELECT count(*)::int FROM support_relations r JOIN active_packs p ON p.id = r.pack_id) AS structured_relations,
          (SELECT count(*)::int FROM support_configuration_rules r JOIN active_packs p ON p.id = r.pack_id) AS configuration_rules,
          (SELECT count(*)::int FROM support_sku_crosswalks x JOIN active_packs p ON p.id = x.pack_id) AS sku_crosswalks,
          (SELECT count(*)::int FROM support_chunks k JOIN active_packs p ON p.id = k.pack_id) AS support_chunks,
          min(snapshot_date)::text AS oldest_snapshot_date,
          max(snapshot_date)::text AS latest_snapshot_date
        FROM active_packs
      `,
      this.sql`
        SELECT p.brand_slug AS brand, p.brand_name, p.domain_slug AS domain, p.domain_name,
          p.pack_key, p.version AS pack_version, p.snapshot_date::text, p.source_revision_kind, p.source_revision,
          (SELECT count(*)::int FROM support_entities e WHERE e.pack_id = p.id) AS technical_entities,
          (SELECT count(*)::int FROM support_facts f WHERE f.pack_id = p.id) AS technical_facts,
          (SELECT count(*)::int FROM support_configuration_rules r WHERE r.pack_id = p.id) AS configuration_rules,
          (SELECT count(*)::int FROM support_sku_crosswalks x WHERE x.pack_id = p.id) AS sku_crosswalks,
          (SELECT count(*)::int FROM support_chunks k WHERE k.pack_id = p.id) AS support_chunks
        FROM support_packs p
        WHERE p.status = 'active'
        ORDER BY p.brand_name, p.domain_name
      `,
      this.sql`
        SELECT p.brand_slug AS brand, p.domain_slug AS domain, e.category,
          count(DISTINCT e.id)::int AS technical_entities,
          max(p.snapshot_date)::text AS latest_snapshot_date
        FROM support_packs p
        JOIN support_entities e ON e.pack_id = p.id
        WHERE p.status = 'active' AND e.category IS NOT NULL
        GROUP BY p.brand_slug, p.domain_slug, e.category
        ORDER BY p.brand_slug, p.domain_slug, e.category
      `,
    ]);
    return {
      overall: overall[0],
      by_brand_domain: scopes,
      by_technical_category: categories,
      commercial_fields_persisted: false,
      lifecycle: "rebuildable projection; one active approved pack per brand/domain",
    };
  }
}
