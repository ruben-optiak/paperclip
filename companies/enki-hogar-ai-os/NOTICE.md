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
revision-pending. Only the restricted package file is distributed from that
adaptation; the original live script is not copied into this package.
`connectors/content-publisher/` is a new, independently authored governed
implementation against the public WordPress and Meta APIs. “Vendorizada”
denotes the offline helper's functional lineage, not a claim that either new
implementation is byte-identical to the source script.

`references/source-snapshots/`, runtime credentials, Paperclip exports, database
backups, and storage backups are deliberately outside the distributable source
package.

The catalogue regression fixtures are independently authored synthetic test
data informed by visual review of historical manufacturer layouts. They retain
only minimal geometry and invented values. The original catalogues, page
images, commercial values, and manufacturer content are not distributed or
relicensed by this package; brand names identify compatibility coverage only.
The adapter definitions and Python implementation are new package code informed
by Enki's internal historical extractor behavior. They retain logical source
paths, geometry strategies and invented regression values only; no original PDF,
commercial tariff, manufacturer media or customer data is distributed.
