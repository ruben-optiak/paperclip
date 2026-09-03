# Approved catalogue evidence publication

This is the `EAI-022` boundary between the offline catalogue pipeline and the
Ecommerce & Catalogue Manager. The connector reads a deliberately small
publication projection. It never mounts a pipeline input directory, a complete
run output, a raw PDF, a Woo CSV, a normalized master or a review workspace.

## Authority

The publication contract is
`enki-catalog-evidence-publication/v1`. A readable record must pass all three
gates:

1. the publication itself is approved by Board;
2. its exact `enki-catalog-run/v1` is `local_export_ready`, decided
   `approved_for_local_export` by Board and still blocks external writes;
3. each exact `enki-catalog-field-evidence/v1` is `approved` by Board and has
   no external-mutation authority.

Approval here authorizes read access to evidence only. It does not authorize a
Woo import, support-pack import, publication, campaign, price, stock or feed
mutation. Woo live remains commercial truth. A catalogue run remains a
processing record, not live catalogue truth.

## Prepare a publication

1. Run the immutable cross-brand regression and the exact brand/snapshot
   adapter gate.
2. Validate the full run and every proposed field record with
   `validate_catalog_contracts.mjs` before Board review.
3. Record the Board decision on the exact run revision and on each field
   revision that may be queried. Do not infer approval from `candidate`,
   `needs_review`, a historical `validated` flag or a support-pack approval.
4. Create a new directory outside Git and outside all pipeline input/output
   roots. Copy only:
   - `manifest.json`;
   - approved run manifests as `runs/*.json`;
   - approved field records as `evidence/*.json`;
   - optional tightly cropped proof images as `crops/*.png|webp|jpg|jpeg`.
5. In the manifest, bind every file by SHA-256. Evidence selectors bind the
   exact run, brand, normalized series slug, SKU/manufacturer reference and
   field. A crop carries its own SHA-256 and MIME type.
6. Validate the closed directory:

   ```sh
   npm --prefix companies/enki-hogar-ai-os/connectors/catalog-evidence \
     run validate -- /absolute/path/to/approved-publication
   ```

The validator fails closed on extra or missing files, raw PDF/CSV files,
symlinks, traversal, credential-like paths, checksum drift, selector drift,
pending/rejected decisions and unsafe authority. Correct a publication by
creating a new immutable version; never edit the mounted version in place.

## Start and connect

Set `CATALOGUE_EVIDENCE_PUBLICATION_HOST_PATH` to the dedicated publication
directory and generate an independent `CATALOGUE_EVIDENCE_MCP_TOKEN`. Compose
mounts the directory at `/data/publication:ro`, uses a read-only container root
and exposes health only on loopback port `8050`.

Create `Enki Catalogue Evidence Read Only` from
`policies/desired-state.yaml`, refresh its catalog and require exactly these
five tools:

- `catalogue_list_approved_runs`
- `catalogue_search_field_evidence`
- `catalogue_get_field_evidence`
- `catalogue_get_evidence_crop`
- `catalogue_evidence_coverage`

Add them only to `enki.ecommerce-catalogue.read-only`. Do not install the
connection directly into an agent runtime. The existing agent-scoped governed
gateway remains the delivery path and its profile remains default-deny.

## Smoke and rotation

With agents and routines paused:

1. require `/health` to return only service/version/schema metadata;
2. verify missing and incorrect bearer tokens return `401`;
3. query the known approved fixture by brand, series, SKU and field;
4. fetch the field and verify source checksum plus PDF boxes or CSV position;
5. if a crop exists, verify its returned SHA-256; otherwise require the explicit
   coordinate-only response;
6. query a pending, rejected or unknown key and require no data;
7. add a temporary undeclared/raw file to a disposable copy and require startup
   validation to fail;
8. verify the MCP catalog has no mutation, approval, import, export, raw-file or
   filesystem-browse tool.

To rotate evidence, stop the service, validate a new immutable publication,
change the host mount atomically and restart. Keep the old publication for
audit according to retention policy. Never broaden the mount to make a failed
validation pass.
