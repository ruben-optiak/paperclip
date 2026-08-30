# Catalogue schema and attributes

Snapshot: 2026-08-29. Curated rules, not a current catalogue export.

Each product candidate needs a stable identity such as SKU plus manufacturer/model evidence. Relevant fields include title, brand, model, EAN/GTIN where evidenced, category, product type, dimensions and units, materials, finishes, installation or compatibility attributes, price, stock state, media provenance, descriptions, and source timestamps.

Variants must not silently inherit incompatible measurements, identifiers, finishes, or stock. Units and enumerations are normalized before comparison. Missing is distinct from empty, zero, not applicable, and unverified.

Commercial or identity fields are critical and require explicit approval when changed.
