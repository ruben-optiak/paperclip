---
slug: record-sanycces-source-provenance
name: Registrar procedencia de los productos Sanycces
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

All 1,647 rows in the 2026-09-19 export have empty `_enki_source_refs`, `_enki_source_page` and `_enki_original_pdf_sku` fields. This prevents a reviewer from tracing current catalogue data to the exact official evidence used to create or correct it.

Define and populate a checksum-closed provenance ledger that relates each reviewed product or variation to the catalogue SHA-256 `65b51d42c3d09f893fa909fb17ce93d01934dfdde3ad7ee4195543627d93f285`, printed index/technical/matrix pages, raw catalogue reference and evidence geometry. An official Sanycces URL is optional enrichment and must never be required to retain a PDF inventory item. Keep PDF inventory evidence separate from Woo live state and preserve the original value when normalizing a field.

Acceptance requires schema validation, exact parent/variation linkage, no host paths or raw documents in Woo metadata, a deterministic replay test and a local proposed change set. Do not backfill provenance for an entity whose PDF identity or Woo linkage remains unresolved.
