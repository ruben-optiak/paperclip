# Curated Enki knowledge

`curated/` is the reviewed snapshot agents may use as historical context. It is not a live data source and every document carries a snapshot date. Current metrics must come from an approved connector.

`source-allowlist.tsv` declares the only files eligible for synchronization from `ENKI_KNOWLEDGE_SOURCE`. Set `ENKI_KNOWLEDGE_REVISION` to the exact source Git commit, release ID, or immutable dated snapshot ID. The sync script verifies a Git HEAD when available and records the declared revision plus each source SHA-256 in the ignored `source-snapshots/SNAPSHOT.tsv`. It writes unmodified candidates only after content checks; a human must review and distil changes into `curated/` with `apply_patch` before committing them.

```sh
ENKI_KNOWLEDGE_SOURCE=<reviewed-source-directory> \
ENKI_KNOWLEDGE_REVISION=<immutable-source-id> \
companies/enki-hogar-ai-os/scripts/sync-knowledge.sh
```

Excluded regardless of allowlist:

- `auth_*.json`, `google-ads.yaml`, ADC, OAuth tokens, passwords and private keys.
- Customer-level exports or any personal information.
- PDFs, images, archives, databases and unnecessary binaries.
- WordPress private access paths and machine-specific absolute paths.
- Bulk catalogue, order, CRM or analytics exports.

See `inventory.yaml` for purpose, internal licensing, source revision status, and the SHA-256 of every committed curated document. When curating a new snapshot, update the target hashes and replace the pending source status only with evidence from `SNAPSHOT.tsv`; do not infer a revision or digest.

`metrics/` and `contracts/` are package-authored internal contracts, not synchronized copies. They are listed separately as `internalDocuments` with content hashes and must never be added to the source allowlist.

## Runtime mirrors

Paperclip materializes files contained inside each imported skill, but does not currently mount this root directory into agent workspaces. The required subset is therefore copied into `skills/<skill>/references/`. Root `references/` remains canonical; the package validator compares every runtime mirror byte-for-byte with its canonical file and rejects missing or stale copies. Both locations remain `LicenseRef-Enki-Hogar-Internal` under `NOTICE.md`.
