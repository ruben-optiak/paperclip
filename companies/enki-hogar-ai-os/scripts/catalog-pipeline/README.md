# Enki catalogue pipeline runtime

Versioned, credential-free catalogue runtime. Version `0.5.0` has seven isolated responsibilities:

1. rasterizes every PDF page with pinned pypdfium2/PDFium and Pillow at 300 dpi by default;
2. records portable page and word-geometry inventories with pinned pdfplumber, source SHA-256 and page geometry;
3. executes a small geometry core plus four snapshot-scoped brand adapters against the immutable sanitized EAI-019 oracle.
4. reads one locked complete Woo export by exact position, creates v1 evidence plus an idempotent local change set, and audits a later complete export for unexpected cells or identity drift;
5. converts one rights-confirmed local JPEG, PNG or WebP into deterministic, metadata-stripped WebP using an explicit reviewed profile, without upscaling pixels;
6. applies the exact `sanycces-griferia-2026` product adapter to its pinned PDF and complete Woo export, classifies all 264 logical pages, extracts only the 50 reviewed finish matrices, records every geometric observation, optionally renders and splits every logical page with visual-QA contact sheets, and inventories original embedded JPEG candidates without resampling;
7. prepares the 28 reviewed Pool inventory records, deterministic official-source WebP candidates and an offline PDF↔Woo↔frozen-public-snapshot audit without granting draft or publication authority.

The extraction adapter core remains `0.2.0` inside this runtime. It consumes already classified page elements and deterministically pairs evidence candidates, but does not infer an unknown layout or extract a canonical product master. Reconciliation requires independently prepared `enki-catalog-field-evidence/v1`, a profile locked to the exact Woo SHA/row count/columns, and a strict entity allowlist. It never creates an import CSV, support pack or external write.

## Boundary

- Every selected PDF, CSV and JSON/JSONL input is addressed by a path relative to an external input root.
- The input root is mounted read-only by `run-docker.sh`.
- Results go to a separate external output root and an existing run is never overwritten.
- Both roots must be outside Git and may not contain symlinks or credential-like files.
- Artifacts contain logical relative paths, never host paths.
- The container receives no credentials, has no network, a read-only root filesystem, no Linux capabilities and a small writable `/tmp`.

## Build and run

From the Paperclip repository root:

```sh
docker build \
  --tag enki-catalog-pipeline:0.5.0 \
  companies/enki-hogar-ai-os/scripts/catalog-pipeline

companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/catalog-input \
  /path/outside/git/catalog-results \
  preflight \
  --pdf brand/catalog.pdf

companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/catalog-input \
  /path/outside/git/catalog-results \
  prepare \
  --pdf brand/catalog.pdf \
  --source-slug brand-catalog-2026 \
  --category mirrors \
  --run-id brand-catalog-2026-09-01
```

Prepare one product image with a profile supplied inside the read-only input root:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/product-media-input \
  /path/outside/git/product-media-results \
  prepare-product-media \
  --source media/source.jpg \
  --profile profiles/enki-square.json \
  --run-id sanycces-ref-001-media \
  --asset-key sanycces-ref-001-01 \
  --alt "Descripción factual de la imagen" \
  --source-url https://official.example.invalid/media/source.jpg \
  --rights-confirmed
```

The output includes `media/<asset-key>.webp` and `media-result.json` with source,
profile and output hashes. The candidate profile in the publishing skill is not
production authority until Enki approves its dimensions and compression.

Analyze the exact reviewed Sanycces sources without network or credentials:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/sanycces-input \
  /path/outside/git/sanycces-results \
  analyze-sanycces-products \
  --pdf GRIFERIA_N_2026-SP.pdf \
  --woo Productos-Export-2026-September-19-1740.csv \
  --run-id sanycces-griferia-2026-review \
  --render-evidence \
  --evidence-dpi 144 \
  --image-rights-confirmed
```

The built-in adapter rejects any PDF or Woo fingerprint drift. It binds duplicate
Woo headers by exact position, verifies finish-column geometry and writes
`candidate-review.csv`, `product-group-review.csv`, their JSONL evidence, a page
inventory and a Spanish report. The PDF is the inventory source of truth for this
catalogue; the manufacturer website is optional enrichment and cannot remove an
item observed in the PDF. `not_in_export` and `absent_from_export` prove absence
only from the exact Woo snapshot, never assortment approval or authority to create
the item.

`--render-evidence` writes 264 deterministic logical-page PNGs and 22 contact
sheets. Embedded DCT/JPEG objects on the 50 reviewed technical pages are extracted
byte-for-byte into a hash-addressed evidence directory. They remain `needs_review`,
are never upscaled and are never final Woo media automatically. The Pool-only
reviewed mapping pattern pairs 28 image candidates to 28 PDF inventory groups by
vertical order across ten exact technical/matrix pairs; the pattern is not applied
to other series.

Prepare Pool after freezing the official Pool listing, the two deterministic
Store API pages, the four direct HTTP checks and the 22 official images inside the
clean input root:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/sanycces-pool-input \
  /path/outside/git/sanycces-pool-results \
  prepare-sanycces-pool \
  --pdf catalog.pdf \
  --woo woo.csv \
  --tariff PVP_NACIONAL_2026.xlsx \
  --analysis analysis.json \
  --groups product-groups.jsonl \
  --candidates candidates.jsonl \
  --official-listing official-pool.html \
  --live-page-1 live-page-1.json \
  --live-page-2 live-page-2.json \
  --direct-checks direct-checks.json \
  --profile media-profile.json \
  --run-id pool-audit-20260920 \
  --image-rights-confirmed
```

The command fails closed unless the Pool gate remains 28 inventory records, the
official filter remains 26 cards, every Store API product exactly matches the
locked export, every PDF inventory reference has one unique positive official
tariff PVP, and the attached PDF still has no explicit monetary signals. It writes
article copy, SEO metadata and per-reference PVP for local review. Expected Woo
regular prices are derived with the reviewed 21% VAT rate. Sale prices apply the
approved `sanycces-pvp-tier-2026-v1` policy against official net PVP: 5% below
EUR 25, then 7.5%, 10%, 15%, 17.5% and 20% at the 25/50/100/250/500 boundaries.
That policy exactly reproduces all 1,217 published sale prices in the frozen
export after cent rounding. The four Sanybox records are standalone simple
products. The four PDF kits remain blocked on a dedicated hero image; the four
official web-only Pool accessories remain outside the PDF inventory.

Before replacing white-background Pool hero images, generate a deterministic
review package with the shared primary-image policy:

```sh
uv run python scripts/prepare_pool_primary_review.py \
  --bundle-root /path/to/reviewed-pool-bundles \
  --official-source-dir /path/to/frozen-official-media \
  --policy ../../references/commerce/product-primary-image-policy.json \
  --output-dir /path/to/pool-primary-image-review
```

The package contains individual NB/RM WebP candidates, four before/after contact
sheets and a hash manifest. It performs no external writes. The policy preserves
geometry, targets 78% product occupancy on a 1000 × 1000 white canvas, encodes at
quality 92 and records whenever the source-specific upscale cap prevents the
target. Human approval is required before any WooCommerce media replacement.

The same run also reconciles every published sellable Sanycces SKU, including
products outside the attached grifería PDF, against the official tariff. Variable
parent SKUs are treated as local grouping identifiers rather than priced items.
Exact manufacturer references and reviewed Cardiff composites are written to
`published-tariff-audit.csv`; tariff lines without an exact published SKU are
written to `tariff-not-published-audit.csv` for later classification by catalogue,
product, component and service. Absence from one supplied PDF is never treated as
evidence that a published product is obsolete or should be removed.

List the locked adapters and run their independent regression from the repository root:

```sh
PYTHONPATH=companies/enki-hogar-ai-os/scripts/catalog-pipeline/src \
PYTHONDONTWRITEBYTECODE=1 uv run \
  --project companies/enki-hogar-ai-os/scripts/catalog-pipeline \
  --locked --isolated --no-env-file \
  python -m enki_catalog_pipeline adapter-list

PYTHONPATH=companies/enki-hogar-ai-os/scripts/catalog-pipeline/src \
PYTHONDONTWRITEBYTECODE=1 uv run \
  --project companies/enki-hogar-ai-os/scripts/catalog-pipeline \
  --locked --isolated --no-env-file \
  python -m enki_catalog_pipeline adapter-regression \
  --manifest companies/enki-hogar-ai-os/skills/enki-catalog-qa/fixtures/catalog-regression/v1/manifest.json
```

The runner loads rules only from `adapters/registry.json`, verifies every definition and fixture by SHA-256, and computes output before consulting the oracle. A valid report is exactly four adapters, six fixtures, 21 pairs, subject coverage `1`, error rate `0` and fixture pass rate `1`.

Run a locked local Woo comparison:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/reconcile-input \
  /path/outside/git/reconcile-results \
  woo-reconcile \
  --profile profile.json \
  --candidates candidates.jsonl \
  --woo woo-before.csv \
  --run-id bounded-reconciliation
```

After a separate human-approved, operator-run import, audit a fresh complete export:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/audit-input \
  /path/outside/git/audit-results \
  woo-audit \
  --profile profile.json \
  --change-set approved-change-set.json \
  --before-woo woo-before.csv \
  --after-woo woo-after.csv \
  --audit-id post-import-audit
```

Operational audit accepts only exact changes approved for a local export. The sanitized fixture mode can simulate pending changes for regression without inventing Board approval. Audit reports hash out-of-scope row identities and values rather than copying them.

The generic PDF-preparation run contains:

```text
brand-catalog-2026-09-01/
├── runtime_metadata.json
├── pages_manifest.csv
├── page_inventory.csv
├── block_inventory.csv
└── pages/
    ├── page-0001.png
    └── ...
```

The preparation files implement `enki-catalog-runtime/v1`. Adapter output implements `enki-catalog-adapter-result/v1`. Reconciliation output implements `catalog-run/v1`, `catalog-field-evidence/v1`, `catalog-change-set/v1` and `catalog-reconciliation/v1`, but every generated decision remains pending and local-only. None is an import, live commercial truth beyond its exact Woo snapshot, or write authority.

The Sanycces product-analysis run implements
`enki-sanycces-product-catalog-analysis/v1` and adds
`pages.jsonl`, `candidates.jsonl`, `product-groups.jsonl`, two review CSVs,
`logical-page-renders.jsonl`, `contact-sheets.jsonl`,
`pdf-image-candidates.jsonl`, `pdf-image-candidate-review.csv`,
`pdf-image-contact-sheets.jsonl`, `report.md` and
an artifact manifest covering every nested file. Its reference grouping removes
finish suffixes only after geometric verification and keeps configuration tails,
components and compatibility-only mentions distinct. The Pool quality gate fixes
the reviewed result at 27 index cards, 28 inventory groups, 24 product candidates,
four components and two compatibility-only references; ten matrix pages are not
ten products.

The Pool preparation run implements `enki-sanycces-pool-preparation/v1` and adds
28 article/component records, 22 normalized WebP assets, reference- and
group-level publication audits, a published-product scope crosswalk, separate
live/export and PDF-reference price tables, an official-site crosswalk and the
full PDF price-signal scan. The regular-price net at 21% is recorded as a derived
audit value only; it never substitutes for a missing official PVP source. Pool
output includes the approved discount, derived sale price and policy key for each
reference, but remains local review evidence and grants no draft or publication
authority.

For Pool candidates that already have reviewed media, build bounded immutable
draft bundles with the frozen Woo taxonomy snapshots and approved discount
policy:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/pool-bundle-input \
  /path/outside/git/pool-bundle-results \
  build-sanycces-pool-bundles \
  --articles pool-articles.jsonl \
  --artifact-manifest artifact-manifest.json \
  --woo woo.csv \
  --categories-page-1 categories-page-1.json \
  --categories-page-2 categories-page-2.json \
  --attributes attributes.json \
  --finish-terms finish-terms.json \
  --discount-policy sanycces-discount-policy-v1.json \
  --run-id sanycces-pool-draft-bundles-20260920-v1 \
  --created-at 2026-09-20T11:02:32+02:00 \
  --catalog-captured-at 2026-09-19T19:31:00+02:00 \
  --woo-captured-at 2026-09-19T17:40:00+02:00 \
  --taxonomy-captured-at 2026-09-20T11:02:32+02:00
```

The command fails on SKU or slug collisions, unknown category paths, taxonomy
drift, non-NB/RM finish matrices, media drift or any Pool blocker. It also emits
the exact approved `discount-policy.json` and a per-SKU
`price-policy-audit.json` with net PVP, VAT-derived gross, tier and sale price. It groups the
20 ready variable products into four five-product bundles and the four Sanybox
products into a fifth bundle. The four kits without a dedicated hero remain in
the batch manifest as exclusions. Validate the resulting batch through the
publisher's read-only loader with:

```sh
node companies/enki-hogar-ai-os/connectors/content-publisher/scripts/preflight-bundle-batch.mjs \
  --batch /path/outside/git/pool-bundle-results/RUN_ID/batch-manifest.json
```

This dry run checks every manifest and WebP by hash, parses real dimensions,
rejects metadata and animation chunks, validates GTIN check digits and uniqueness,
detects duplicate or truncated SEO, and independently recalculates every declared
price and discount. It always records zero external writes. It does not authorize
treating the five bundles as one bulk publication operation; Board approval and
the write tool remain product-exact. Use `prepare-canary-review.mjs` with one exact
`productKey` to generate the later approval dossier without enabling a write.

## Test

```sh
PYTHONDONTWRITEBYTECODE=1 uv run \
  --project companies/enki-hogar-ai-os/scripts/catalog-pipeline \
  --locked --isolated --no-env-file \
  python -m unittest discover \
  -s companies/enki-hogar-ai-os/scripts/catalog-pipeline/tests \
  -v
```
