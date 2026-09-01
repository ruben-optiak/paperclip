# Catalogue PDF preparation

This runbook covers the first reproducible stage of the catalogue workflow:

`official snapshot → per-page raster → geometric inventory`

It deliberately stops before product extraction, normalization, comparison, QA, approval and export. See [catalogue QA](../skills/enki-catalog-qa/SKILL.md) and [product-support operations](catalog-knowledge.md) for those separate boundaries.

## 1. Prepare external storage

Create two non-overlapping directories outside every Git worktree:

- input: one dated, immutable snapshot of the official source PDF;
- output: disposable/rebuildable run artifacts.

Do not place `.env`, OAuth, ADC, WordPress, Google Ads, WooCommerce or Paperclip credentials in the input tree. Do not put Woo exports in this source snapshot; commercial comparison is a later stage. The runtime rejects symlinks and common credential filenames.

The existing Enki operating workspace may be used as input only while it remains outside Git and the selected PDF belongs to a frozen dated snapshot. Results still go to a different external directory.

## 2. Build the pinned image

```sh
docker build \
  --tag enki-catalog-pipeline:0.3.0 \
  companies/enki-hogar-ai-os/scripts/catalog-pipeline
```

The Dockerfile consumes the same verified Python 3.12/uv base-image digest recorded in `runtime/compatibility.lock.yaml`. The permissively licensed PDF stack is fixed by both `pyproject.toml` and `uv.lock`: pdfplumber `0.11.10`, pypdfium2 `5.13.0` and Pillow `12.3.0`.

## 3. Run the safety preflight

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/catalog-input \
  /path/outside/git/catalog-results \
  preflight \
  --pdf buades/catalogo.pdf
```

The PDF path is relative to the input root. A successful response reports only the logical path, SHA-256, byte size and storage boundary; it writes nothing.

Stop if the checksum is not the approved source snapshot, either root resolves into Git, the roots overlap, a symlink exists or a credential-like file is present.

## 4. Prepare one immutable run

```sh
companies/enki-hogar-ai-os/scripts/catalog-pipeline/run-docker.sh \
  /path/outside/git/catalog-input \
  /path/outside/git/catalog-results \
  prepare \
  --pdf buades/catalogo.pdf \
  --source-slug buades-catalogo-2026 \
  --category bathroom \
  --run-id buades-catalogo-2026-09-01
```

The wrapper enforces `--network none`, a read-only input mount, a separate output mount, a read-only container root, no capabilities and no credentials. The runtime refuses an existing `run-id`; correct a run by choosing a new ID, never by mutating approved evidence in place.

## 5. Verify the result

Require all of the following before downstream work:

- source path is logical and source SHA-256 matches preflight;
- page count matches the PDF;
- every page has exactly one `pages/page-NNNN.png` row;
- default raster resolution is 300 dpi unless the run records an approved exception;
- `page_inventory.csv` identifies layout candidates but asserts no product truth;
- `block_inventory.csv` retains every extracted word with page number and `x0,y0,x1,y1` coordinates;
- no artifact contains a host absolute path, secret, customer data or Woo commercial snapshot;
- rerunning the same source with the same runtime produces byte-identical artifacts in a different output root.

These are preparation artifacts, not approval. `EAI-018` defines the strict run, field-evidence and local change-set contracts plus their [historical migration rules](catalog-contract-migration.md). `EAI-019` provides the [sanitized multimarca regression](catalog-regression.md), EAI-020 adds the [small extraction core and four versioned adapters](catalog-adapters.md), and EAI-021 adds [strict positional Woo reconciliation and post-import audit](catalog-reconciliation.md). None authorizes a broad `ENK-7` run or a Woo import; approved-run access remains gated by EAI-022.

## Production portability

Production uses the same tagged source and later an independently verified OCI digest. Mount production object storage or an isolated working volume at the same `/input:ro` and `/output` boundaries. If the exact approved source and result artifacts are retained with matching checksums, they can be promoted without re-extracting; if either input, runtime or rule version changes, create a new run and repeat QA.
