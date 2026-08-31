# Catalogue validation playbook

Snapshot: 2026-08-29. Governs draft preparation only.

The canonical pipeline is:

`fuentes → normalizado → comparativa → QA → aprobación → export`

- Sources: identify document, authority, date, product match, extracted evidence and a complete fresh Woo export for commercial state.
- Normalized: map fields, units, lists, and variants without losing source values.
- Comparison: show current, candidate, evidence, confidence and reason; match manufacturer reference, parent SKU and variation SKU separately from page/slug.
- QA: validate identity, required fields, internal consistency, media and critical-field conflicts. Parse repeated Woo CSV headers by position and reject accidental Cartesian variation expansion.
- Approval: a human accepts or rejects critical candidates.
- Export: generate a local, inspectable draft with checksum. It is not uploaded automatically. After a human import, obtain another complete Woo export and repeat QA before closing.

Technical/support packs are a separate approved derivative, never the commercial export: they omit current price, stock, URL/status and full catalogue rows.

Preferred authority is official product documentation followed by official web material. If no authoritative evidence exists for a critical field, leave it blocked rather than guessing.
