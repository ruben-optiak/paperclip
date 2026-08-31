# Versioned product-support packs

This directory stores small, rebuildable technical-support projections. It never stores a raw WooCommerce export, live prices, stock, orders, customer data, source PDFs or manufacturer media.

## Lifecycle

- `source-snapshots/` contains deliberately narrow, dated and sanitized evidence needed to review identity mappings. A snapshot is historical evidence, never current WooCommerce truth.
- `review/` contains structurally valid candidates with `approval.state = review_required` and blank crosswalk approvals. The product-support importer must reject them.
- `packs/` contains exact human-approved packs. These are the only directories that may pass `validate-pack` and be imported.

The six data files inside a candidate or pack are immutable for a given version. Approval changes the manifest and fills the crosswalk approval columns; it does not regenerate technical content.

## Enki mirrors pilot

Generate the deterministic review candidate from the existing Enki workspace:

```sh
ENKI_KNOWLEDGE_SOURCE=../enki-hogar \
node companies/enki-hogar-ai-os/scripts/product-support/generate-enki-espejos.mjs \
  --output companies/enki-hogar-ai-os/references/product-support/review/enki/espejos/1.0.0
```

Review it with the connector without a database:

```sh
node companies/enki-hogar-ai-os/connectors/catalog-knowledge/src/admin.mjs review-pack \
  --dir companies/enki-hogar-ai-os/references/product-support/review/enki/espejos/1.0.0
```

`validate-pack` and `import-pack` must fail while the candidate remains `review_required`. After the catalogue owner approves the exact `manifest_sha256` and `source_revision` shown by `review-pack`, finalize the immutable pack:

```sh
node companies/enki-hogar-ai-os/scripts/product-support/finalize-support-pack.mjs \
  --review-dir companies/enki-hogar-ai-os/references/product-support/review/enki/espejos/1.0.0 \
  --output companies/enki-hogar-ai-os/references/product-support/packs/enki/espejos/1.0.0 \
  --approved-by catalog-owner \
  --approved-at 2026-08-31T14:00:00+02:00 \
  --expected-review-manifest-sha256 REVIEW_HASH \
  --expected-source-revision SOURCE_HASH
```

Never edit approval fields by hand. Finalization refuses a changed candidate, a changed source revision and any non-empty approved-pack output directory.

The source workspace is currently not a Git repository. For that reason this pilot uses `source_snapshot_sha256`: a deterministic digest of the exact official PDF, normalized master, empty QA queues, publication evidence and sanitized live identity snapshot. This is truthful provenance and avoids inventing a Git commit.
