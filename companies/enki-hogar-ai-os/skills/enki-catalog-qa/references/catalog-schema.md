# Catalogue schema and attributes

Snapshot: 2026-08-29. Curated rules, not a current catalogue export.

Each product candidate needs a stable identity such as manufacturer reference plus Woo parent/variation SKU and manufacturer/model evidence. A commercial comparison may include title, brand, model, EAN/GTIN where evidenced, category, product type, dimensions and units, materials, finishes, installation/compatibility attributes, price, stock state, media provenance, descriptions and source timestamps. Price, stock, URL, state and sellable structure always come from the fresh Woo snapshot.

A support pack is narrower: technical entities/facts, explicit relations, configuration rules, support chunks, evidence and SKU crosswalks. It excludes current commercial fields. Every configuration axis declares whether it is a Woo variation, configurator option, separate component or assisted-sale choice; never infer a Cartesian catalogue.

Variants must not silently inherit incompatible measurements, identifiers, finishes, price or stock. Units and enumerations are normalized before comparison. CSV columns with repeated visible names are tracked by position so one value cannot overwrite another. Missing is distinct from empty, zero, not applicable, and unverified.

Commercial or identity fields are critical and require explicit approval when changed.
