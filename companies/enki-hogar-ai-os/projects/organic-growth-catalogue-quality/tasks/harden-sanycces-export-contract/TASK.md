---
slug: harden-sanycces-export-contract
name: Endurecer el contrato de exportación Sanycces
assignee: technology-manager
project: organic-growth-catalogue-quality
---

The exact 2026-09-19 Woo export has 470 columns and duplicate headers at fixed positions: `Title` at 1 and 351, `URL` at 350 and 356, and `Featured` at 355 and 379. It has no row-width anomalies, but any name-only CSV reader can silently bind to the wrong field. The `Product Type` value also labels 1,435 child rows as `variable`, so hierarchy must be derived from verified parent IDs rather than that field alone.

Freeze the exporter configuration and positional schema. Require exact header count, duplicate positions, source SHA, row width, unique IDs and referential parent coverage before analysis or import. Add negative fixtures for reordered duplicate headers, orphan variations and hierarchy ambiguity. Decide separately whether the upstream exporter can remove redundant fields without breaking existing consumers.

Acceptance requires deterministic parsing, fail-closed drift detection, parent/variation metrics and a migration plan for any exporter change. This task grants no Woo import authority.
