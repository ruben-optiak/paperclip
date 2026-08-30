# Licensing and provenance notice

This package contains material with different licensing scopes.

| Scope | Paths | Terms |
| --- | --- | --- |
| Enki-authored package code and configuration | `agents/`, `connectors/` wrappers, `policies/`, `projects/`, `runbooks/`, `runtime/`, `scripts/`, `skills/` except their `references/` subdirectories, `tests/`, `.paperclip.yaml` and public package documentation | MIT; see `LICENSE` |
| Enki company knowledge, source inventory, and runtime mirrors | root `references/` and every `skills/*/references/` directory | Enki Internal; see `LICENSE-ENKI-INTERNAL.md` |
| Installed upstream dependencies | Dependency locks and connector images | Their original licenses; see `THIRD_PARTY_NOTICES.md` |

The offline implementation under `skills/wordpress-publisher/` is a restricted
adaptation of Enki's internal operational skill at the logical source path
`skills/wordpress-publisher/`. The source script observed for this review had
SHA-256 `c25f0156c66b9f32e2385a07f40562c4c48b2fd69979b79ebca54e7e3f5d94f2`;
the packaged offline rewrite has SHA-256
`656486d82ad1d293354824bede2947730c74f9e5fc855fbfedaa47b2e9a0580e`.
The source directory had no verifiable Git revision, so provenance remains
revision-pending. Only the restricted package file is distributed; the live
network/publishing implementation is not. “Vendorizada” denotes this
functional lineage, not a claim that the two files are byte-identical.

`references/source-snapshots/`, runtime credentials, Paperclip exports, database
backups, and storage backups are deliberately outside the distributable source
package.
