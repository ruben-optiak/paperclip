# Enki Catalogue Evidence MCP

Read-only MCP boundary for `EAI-022`. It serves only an exact, Board-approved
`enki-catalog-evidence-publication/v1` projection mounted at
`CATALOGUE_EVIDENCE_ROOT`.

The mount is deliberately not a pipeline run directory. It may contain only
`manifest.json`, hashed run manifests under `runs/`, hashed field records under
`evidence/`, and optional hashed PNG/WebP/JPEG crops under `crops/`. Startup
fails on pending/rejected decisions, selector drift, missing or extra files,
checksum drift, symlinks, path traversal, credential-like names, raw PDFs/CSV,
or any record that claims external-write authority.

Tools:

- `catalogue_list_approved_runs`
- `catalogue_search_field_evidence`
- `catalogue_get_field_evidence`
- `catalogue_get_evidence_crop`
- `catalogue_evidence_coverage`

All tools are read-only, closed-world and idempotent. Queries are exact and
bounded. Coordinates remain useful when an approved crop was not published.
The MCP has no import, approval, mutation, reindex, filesystem-browse or raw
input tool.

Run locally only with a prepared publication outside Git:

```sh
CATALOGUE_EVIDENCE_MCP_TOKEN='<independent random bearer>' \
CATALOGUE_EVIDENCE_ROOT='/absolute/path/to/approved-publication' \
npm start
```

Validate that exact directory before Compose startup:

```sh
npm run validate -- /absolute/path/to/approved-catalogue-evidence-publication
```
