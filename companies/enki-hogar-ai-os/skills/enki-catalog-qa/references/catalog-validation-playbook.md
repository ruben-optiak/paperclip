# Catalogue validation playbook

Snapshot: 2026-08-29. Governs draft preparation only.

The canonical pipeline is:

`fuentes → normalizado → comparativa → QA → aprobación → export`

- Sources: identify document, authority, date, product match, and extracted evidence.
- Normalized: map fields, units, lists, and variants without losing source values.
- Comparison: show current, candidate, evidence, confidence, and reason.
- QA: validate identity, required fields, internal consistency, media, and critical-field conflicts.
- Approval: a human accepts or rejects critical candidates.
- Export: generate a local, inspectable draft with checksum. It is not uploaded automatically.

Preferred authority is official product documentation followed by official web material. If no authoritative evidence exists for a critical field, leave it blocked rather than guessing.
