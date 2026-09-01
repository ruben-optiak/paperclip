# Woo catalogue reconciliation

This runbook governs `enki-catalog-pipeline` `0.3.0` and `catalog-reconciliation/v1`. It turns one exact, complete Woo export plus independently evidenced candidates into local review artifacts. It has no Woo credentials, no network and no import generator.

## What this solves

The Woo CSV is a positional matrix, not a dictionary:

- every row must contain exactly as many cells as the header;
- repeated headers remain separate through zero-based index, original header and stable deduplicated header;
- `variable` with no parent is a page-owning parent;
- `variable` or `variation` with a parent is a sellable variation;
- page title, SEO and media target a simple product or parent; SKU price, finish and configuration may target a variation;
- price comparisons lock currency and fiscal basis before comparing.

The result is idempotent: reconciling the expected post-state against the same candidates must produce zero changes.

## Prepare an external workspace

Use directories outside every Git worktree. Do not place credentials, customer data or arbitrary full exports in this repository.

```text
catalog-reconcile-input/
├── profile.json
├── candidates.jsonl
└── woo-before.csv

catalog-reconcile-results/
```

Start from the sanitized profile in `skills/enki-catalog-qa/fixtures/catalog-reconciliation/v1/profile.json`, but create a new operational revision. Pin:

- a unique `runKey` and `profileKey`;
- creation/snapshot timestamps with timezone;
- the exact SHA-256 and data-row count of the fresh complete Woo export;
- exact identity columns;
- an allowlist of entity keys and exact SKUs;
- one exact positional Woo binding for every candidate field;
- `surface`, normalization, unit, fiscal basis, criticality and risk per target.
- `audit.ignoredColumns: []`; v1 permits no hidden or volatile-column exception.

Never make the profile broader to make a failing run pass. A changed SHA, row count, header position, SKU, entity kind or parent relation requires investigation and usually a new profile revision.

## Validate the committed fixture

```sh
node companies/enki-hogar-ai-os/skills/enki-catalog-qa/scripts/validate_catalog_reconciliation.mjs \
  --manifest companies/enki-hogar-ai-os/skills/enki-catalog-qa/fixtures/catalog-reconciliation/v1/manifest.json
```

The locked result is five files, two entities, five candidate fields, two matches and three local differences.

## Build and reconcile

```sh
docker build \
  --tag enki-catalog-pipeline:0.3.0 \
  companies/enki-hogar-ai-os/scripts/catalog-pipeline

companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/catalog-reconcile-input \
  /path/outside/git/catalog-reconcile-results \
  woo-reconcile \
  --profile profile.json \
  --candidates candidates.jsonl \
  --woo woo-before.csv \
  --run-id brand-bounded-reconciliation-2026-09-01
```

The immutable run contains:

```text
brand-bounded-reconciliation-2026-09-01/
├── catalog-run.json
├── rules/reconciliation-profile.json
└── artifacts/
    ├── catalog-field-evidence.jsonl
    ├── catalog-change-set.json
    └── reconciliation-report.json
```

`catalog-change-set.json` contains mismatches only. Every generated change is `needs_review`, blocked on Board approval and ineligible for local export. The runtime does not create an import CSV. A human must review exact evidence and make a separate Board decision before an operator prepares or applies anything.

## Post-import audit

Only after an operator has applied a separately approved local import:

1. Generate a second complete Woo export immediately.
2. Preserve the exact approved change-set bytes and checksum.
3. Put the profile, exact change set, before export and after export in a clean external read-only input directory.
4. Run:

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/catalog-audit-input \
  /path/outside/git/catalog-audit-results \
  woo-audit \
  --profile profile.json \
  --change-set approved-change-set.json \
  --before-woo woo-before.csv \
  --after-woo woo-after.csv \
  --audit-id brand-post-import-audit-2026-09-01
```

Operational audit requires the exact Board-approved local-export decisions. PASS requires:

- every expected cell equals its candidate;
- no expected change is missing;
- no other cell changed, including rows outside the allowlist;
- no row appeared/disappeared;
- no SKU or parent relation changed;
- no duplicate SKU/ID, orphan variation or unknown row role exists.

Unexpected out-of-scope rows and values are represented only by hashes in the audit report. Any drift is FAIL and must be investigated with a field-specific correction; never reimport unrelated columns.

## Bounded historical replay

Before opening a broad live audit, survey one reviewed historical Woo export and replay its exact positional header shape with invented rows and at most five candidate fields. Keep the source export outside this package and run:

```sh
PYTHONPATH=companies/enki-hogar-ai-os/scripts/catalog-pipeline/src \
uv run \
  --project companies/enki-hogar-ai-os/scripts/catalog-pipeline \
  --locked --isolated --no-env-file \
  python companies/enki-hogar-ai-os/scripts/catalog-pipeline/scripts/bounded_historical_layout_replay.py \
  --woo-export /path/to/reviewed-historical-woo-export.csv \
  --fixture-root companies/enki-hogar-ai-os/skills/enki-catalog-qa/fixtures/catalog-reconciliation/v1
```

The source is read only to validate row width, duplicate headers, IDs, SKUs and parent/variation integrity. Reconciliation runs in a temporary directory against fully invented rows using the same header positions; the temporary run is deleted automatically. Standard output contains only checksum, aggregate counts, a sanitized artifact fingerprint and explicit `false` authority flags. It must never contain source rows, values or a host path.

The completed EAI-021 replay is recorded in [`references/replay-receipts/eai-021-buades-2026-04-26.json`](../references/replay-receipts/eai-021-buades-2026-04-26.json): the historical layout had 1,196 rows and 376 columns, with zero malformed rows, duplicate IDs/SKUs, unknown roles or orphan variations. Its three-row sanitized replay resolved two in-scope entities and four candidate fields as two matches and two local differences. No commercial value or generated artifact was retained.

The replay is evidence that the reviewed legacy layout can be interpreted; it is not current truth, approval or permission to import.

Do not expand from the bounded replay to all brands or all products. That remains gated by the read-only approved-run evidence connector and a fresh operational task.
