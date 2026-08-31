# Product-support knowledge operations

This service is a **rebuildable support projection**, not a replica of the ecommerce catalogue. Its directory keeps the historical name `connectors/catalog-knowledge` for upgrade compatibility; the runtime service, database, variables and contracts use `product-support`.

## Three separate data paths

| Need | Authority | Persistence here |
| --- | --- | --- |
| Current sellable products, parent/variations, URL, status, price and stock | live WooCommerce | none |
| Bulk catalogue QA and import proposals | fresh complete Woo export + official brand sources, processed in `enki-hogar` | work artifacts only |
| Stable technical facts, explicit compatibility, configuration semantics and support answers | active approved support pack | rebuildable PostgreSQL projection |

Never use `knowledge_coverage` as Woo catalogue coverage. Never import a raw Woo export or a full normalized master into this database.

## Prepare and start

Generate three independent secrets outside Git:

- `SUPPORT_DB_ADMIN_PASSWORD`: PostgreSQL and the migration/admin process only.
- `SUPPORT_DB_READER_PASSWORD`: PostgreSQL, migration and the MCP reader.
- `SUPPORT_MCP_TOKEN`: Paperclip connection and MCP only.

For an existing private Compose environment, initialize only missing values atomically without printing them:

```sh
node companies/enki-hogar-ai-os/scripts/init-local-support-secrets.mjs \
  --env-file /path/to/untracked-enki.env
```

The helper rejects symlinks, duplicate keys, empty values and placeholders, preserves existing credentials, and forces file mode `600`.

Start with the standard two Compose files. The service is `enki-product-support-knowledge`, the database is `enki-product-support-db`, and its named volume is `enki-product-support-db-data`. Verify the data-free endpoint:

```sh
curl -fsS http://127.0.0.1:8030/health
```

Create `Enki Product Support Knowledge Read Only` in Paperclip at `http://enki-product-support-knowledge:8030/mcp`. Configure API-key authentication in header `Authorization`, prefix `Bearer `, bound to `SUPPORT_MCP_TOKEN`. Keep agents paused until the observed catalogue is exactly the eight `knowledge_*` tools in `policies/desired-state.yaml`.

## Build an approved support pack

Extraction and commercial catalogue QA continue in the Enki operating repository using:

`fuentes → normalizado → comparativa → QA → aprobación → export`

A support pack is a separate curated output grouped by one `brand + domain`. It contains exactly:

- `manifest.json`
- `technical_entities.csv`
- `technical_facts.csv`
- `technical_relations.csv`
- `configuration_rules.csv`
- `sku_crosswalk.csv`
- `support_chunks.jsonl`

The manifest follows `references/contracts/product-support-pack-v1.schema.json`, pins either an immutable source Git commit or a deterministic SHA-256 source-snapshot revision, hashes every file, declares logical evidence locators and records human approval. Never invent a Git commit for an unversioned source workspace. The importer rejects unexpected files, symlinks, absolute machine paths, PII, credentials, commercial fact keys and price/stock values.

Use these modelling rules:

- Enki example: manufacturer reference `050101` may crosswalk to variation SKU `ENKI-ESP-050101`; measure can be a variation axis while finish remains informational.
- Mundilite example: finish/color may be a real variation axis; installation instructions remain support text.
- Chicandbath example: each axis declares `variation`, `configurator_option`, `component_product` or `assisted_sale`. Do not generate a Cartesian product unless every combination is an approved sellable variation.
- Compatibility must be an explicit structured relation. Semantic text may explain it, never establish it.

## Validate and import

Review validation does not need a database and deliberately accepts `review_required` candidates that cannot be imported:

```sh
docker compose --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  run --rm -T --volume /absolute/path/to/support-pack:/import:ro \
  enki-product-support-migrate \
  node src/admin.mjs review-pack --dir /import
```

After a human has reviewed the exact candidate, finalize its manifest and crosswalk approvals. Normal validation must then pass:

```sh
docker compose --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  run --rm -T --volume /absolute/path/to/support-pack:/import:ro \
  enki-product-support-migrate \
  node src/admin.mjs validate-pack --dir /import
```

After reviewing the summary and backup evidence, import atomically:

```sh
docker compose --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  run --rm -T --volume /absolute/path/to/support-pack:/import:ro \
  enki-product-support-migrate \
  node src/admin.mjs import-pack --dir /import --actor local-operator
```

One pack is active per `brand + domain`. A new version is inserted and activated in one transaction; the previous version becomes `superseded`. Reusing an existing `packKey + version` with different content is rejected. List state with:

```sh
docker compose --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  run --rm -T enki-product-support-migrate \
  node src/admin.mjs pack-list --brand enki --domain espejos
```

Smoke-test product resolution, technical profile, explicit compatibility, allowed options, evidence and coverage. Separately query Woo with `woo_get_product_structure` to prove that live commercial values never came from the support database.

## Lifecycle and deletion

There is no product, series or row-level archive/delete. Correct technical knowledge by importing a new complete approved pack. This preserves provenance and prevents partially deleting relationships.

Physical purge is exceptional and only accepts an exact **superseded** `packKey + version`. Back up the database outside Git first, then create an impact preview:

```sh
docker compose --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  exec -T enki-product-support-db \
  pg_dump -U postgres -d enki_support_knowledge -Fc \
  > /path/outside/repository/enki-support-before-purge.dump

docker compose --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  run --rm -T enki-product-support-migrate \
  node src/admin.mjs purge-preview \
  --pack-key enki-espejos-support --version 1.0.0 --actor local-operator
```

The token expires after 15 minutes, is hashed at rest and is single-use. Read it silently and pass it through stdin:

```sh
read -r -s ENKI_SUPPORT_PURGE_TOKEN
printf '\n'
printf '%s' "$ENKI_SUPPORT_PURGE_TOKEN" | docker compose \
  --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  run --rm -T enki-product-support-migrate \
  node src/admin.mjs purge-apply --token-stdin --actor local-operator
unset ENKI_SUPPORT_PURGE_TOKEN
```

Apply fails if the pack stopped being superseded or the impact changed after preview. Purging this projection never removes official sources or Woo products.

## Optional semantic retrieval

Leave `SUPPORT_EMBEDDING_BASE_URL`, `SUPPORT_EMBEDDING_API_KEY` and `SUPPORT_EMBEDDING_MODEL` empty for lexical retrieval. If all three are configured, an operator may run `reindex-embeddings`; provider failure degrades visibly to lexical search. Never index customer cases, orders, messages, PII, credentials or commercial exports.

Do not run `docker compose down -v` or prune the named volume as routine maintenance. The projection is rebuildable, but deletion still requires backup evidence and a controlled rebuild.
