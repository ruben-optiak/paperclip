# Enki catalogue pipeline runtime

Versioned, credential-free catalogue runtime. Version `0.3.0` has four isolated responsibilities:

1. rasterizes every PDF page with pinned pypdfium2/PDFium and Pillow at 300 dpi by default;
2. records portable page and word-geometry inventories with pinned pdfplumber, source SHA-256 and page geometry;
3. executes a small geometry core plus four snapshot-scoped brand adapters against the immutable sanitized EAI-019 oracle.
4. reads one locked complete Woo export by exact position, creates v1 evidence plus an idempotent local change set, and audits a later complete export for unexpected cells or identity drift.

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
  --tag enki-catalog-pipeline:0.3.0 \
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

The output run contains:

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

## Test

```sh
PYTHONDONTWRITEBYTECODE=1 uv run \
  --project companies/enki-hogar-ai-os/scripts/catalog-pipeline \
  --locked --isolated --no-env-file \
  python -m unittest discover \
  -s companies/enki-hogar-ai-os/scripts/catalog-pipeline/tests \
  -v
```
