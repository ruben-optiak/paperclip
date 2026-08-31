# Enki product-support knowledge MCP

This legacy directory name now contains a deliberately small, rebuildable PostgreSQL/pgvector projection for product support. It is not Paperclip's database and it is not a second ecommerce catalogue.

The active approved packs contain only stable technical entities/facts, explicit relations, configuration rules, SKU crosswalks, support text and source evidence. Current product existence, parent/variation structure, URLs, status, price and stock remain authoritative only in live WooCommerce.

Generated packs first live under `references/product-support/review/` with `approval.state=review_required`. Operators can inspect them with `node src/admin.mjs review-pack --dir <directory>`, but normal validation and import reject them. Approval creates a separate immutable pack under `references/product-support/packs/`; it does not regenerate or silently change the reviewed technical data. Provenance states whether `source_revision` is a Git commit or a deterministic SHA-256 snapshot of the exact allowlisted source files.

The MCP process connects as `enki_support_reader` with SELECT-only grants, no temp/schema creation and read-only transactions. It exposes exactly:

- `knowledge_resolve_product`
- `knowledge_get_technical_profile`
- `knowledge_check_compatibility`
- `knowledge_list_allowed_options`
- `knowledge_get_configuration_model`
- `knowledge_search_support`
- `knowledge_get_evidence`
- `knowledge_coverage`

There is no raw SQL, generic request, import, write, entity deletion or reindex tool in the agent surface. Administrative commands are operator-only. Importing a new approved pack atomically supersedes the previous pack for the same brand/domain; only a complete superseded pack can later be purged with a fresh impact preview and one-time token.

Lexical search works without an external provider. Optional embeddings add hybrid retrieval, but search is never compatibility authority. See the package [operations runbook](../../runbooks/catalog-knowledge.md).
