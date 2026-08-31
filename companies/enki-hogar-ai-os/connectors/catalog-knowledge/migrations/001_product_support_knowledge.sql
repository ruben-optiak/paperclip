CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS support_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_packs (
  id uuid PRIMARY KEY,
  pack_key text NOT NULL,
  version text NOT NULL,
  brand_slug text NOT NULL,
  brand_name text NOT NULL,
  domain_slug text NOT NULL,
  domain_name text NOT NULL,
  snapshot_date date NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  source_repository text NOT NULL,
  source_revision_kind text NOT NULL CHECK (source_revision_kind IN ('git_commit', 'source_snapshot_sha256')),
  source_revision text NOT NULL,
  CHECK (
    (source_revision_kind = 'git_commit' AND source_revision ~ '^[0-9a-f]{40}$') OR
    (source_revision_kind = 'source_snapshot_sha256' AND source_revision ~ '^[0-9a-f]{64}$')
  ),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS support_packs_one_active_domain_idx
  ON support_packs (brand_slug, domain_slug) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS support_packs_lookup_idx
  ON support_packs (brand_slug, domain_slug, status, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS support_sources (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  title text NOT NULL,
  source_kind text NOT NULL,
  locator text NOT NULL,
  snapshot_date date NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, source_key)
);

CREATE TABLE IF NOT EXISTS support_entities (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  entity_key text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('family', 'model', 'variant', 'component', 'accessory')),
  manufacturer_ref text,
  name text NOT NULL,
  series text,
  category text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, entity_key)
);

CREATE TABLE IF NOT EXISTS support_facts (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES support_entities(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES support_sources(id) ON DELETE RESTRICT,
  fact_key text NOT NULL,
  value_text text NOT NULL,
  unit text,
  applicability text NOT NULL,
  evidence_ref text NOT NULL,
  source_page text,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_relations (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  from_entity_id uuid NOT NULL REFERENCES support_entities(id) ON DELETE CASCADE,
  to_entity_id uuid NOT NULL REFERENCES support_entities(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES support_sources(id) ON DELETE RESTRICT,
  relation_type text NOT NULL CHECK (relation_type IN ('variant_of', 'compatible_with', 'requires', 'excludes', 'component_of', 'accessory_for')),
  condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ref text NOT NULL,
  source_page text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_configuration_rules (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES support_entities(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES support_sources(id) ON DELETE RESTRICT,
  rule_key text NOT NULL,
  axis text NOT NULL,
  representation text NOT NULL CHECK (representation IN ('variation', 'configurator_option', 'component_product', 'assisted_sale')),
  affects_sku boolean NOT NULL,
  affects_price boolean NOT NULL,
  affects_stock boolean NOT NULL,
  allowed_values jsonb NOT NULL,
  condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  effect_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ref text NOT NULL,
  source_page text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, entity_id, rule_key)
);

CREATE TABLE IF NOT EXISTS support_sku_crosswalks (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES support_entities(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES support_sources(id) ON DELETE RESTRICT,
  manufacturer_ref text NOT NULL,
  woo_parent_sku text,
  woo_variation_sku text,
  mapping_kind text NOT NULL CHECK (mapping_kind IN ('exact', 'approved_alias', 'parent', 'variation', 'component')),
  evidence_ref text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (woo_parent_sku IS NOT NULL OR woo_variation_sku IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS support_chunks (
  id uuid PRIMARY KEY,
  pack_id uuid NOT NULL REFERENCES support_packs(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES support_entities(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES support_sources(id) ON DELETE RESTRICT,
  chunk_key text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('installation', 'maintenance', 'warranty', 'faq', 'material', 'compatibility', 'configuration', 'care', 'inclusion', 'exclusion')),
  content text NOT NULL,
  evidence_ref text NOT NULL,
  source_page text,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding vector,
  embedding_model text,
  embedding_dimensions integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, chunk_key)
);

CREATE TABLE IF NOT EXISTS support_admin_operation_previews (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation = 'purge_superseded_pack'),
  pack_id uuid NOT NULL,
  impact jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_admin_audit (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  pack_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS support_sources_pack_idx ON support_sources (pack_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS support_entities_lookup_idx ON support_entities (pack_id, entity_key, entity_kind);
CREATE INDEX IF NOT EXISTS support_entities_name_trgm_idx ON support_entities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS support_entities_manufacturer_ref_idx ON support_entities (manufacturer_ref) WHERE manufacturer_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_entities_category_idx ON support_entities (pack_id, category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_facts_entity_idx ON support_facts (entity_id, fact_key);
CREATE INDEX IF NOT EXISTS support_facts_evidence_idx ON support_facts (pack_id, evidence_ref);
CREATE INDEX IF NOT EXISTS support_relations_from_idx ON support_relations (from_entity_id, relation_type, to_entity_id);
CREATE INDEX IF NOT EXISTS support_relations_to_idx ON support_relations (to_entity_id, relation_type, from_entity_id);
CREATE INDEX IF NOT EXISTS support_rules_entity_idx ON support_configuration_rules (entity_id, axis, representation);
CREATE INDEX IF NOT EXISTS support_rules_evidence_idx ON support_configuration_rules (pack_id, evidence_ref);
CREATE INDEX IF NOT EXISTS support_crosswalk_parent_sku_idx ON support_sku_crosswalks (upper(woo_parent_sku)) WHERE woo_parent_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_crosswalk_variation_sku_idx ON support_sku_crosswalks (upper(woo_variation_sku)) WHERE woo_variation_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_crosswalk_manufacturer_ref_idx ON support_sku_crosswalks (upper(manufacturer_ref));
CREATE INDEX IF NOT EXISTS support_chunks_search_idx ON support_chunks USING gin (search_vector);
CREATE INDEX IF NOT EXISTS support_chunks_content_trgm_idx ON support_chunks USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS support_chunks_embedding_model_idx ON support_chunks (embedding_model, embedding_dimensions) WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_chunks_evidence_idx ON support_chunks (pack_id, evidence_ref);
CREATE INDEX IF NOT EXISTS support_previews_expiry_idx ON support_admin_operation_previews (expires_at) WHERE consumed_at IS NULL;
