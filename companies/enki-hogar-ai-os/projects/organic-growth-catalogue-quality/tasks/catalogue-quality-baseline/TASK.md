---
slug: catalogue-quality-baseline
name: Auditar un alcance exacto del catálogo
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

Execute one bounded catalogue-audit pilot under `EAI-013`. Do not start until Board has attached an exact mandate containing:

- one brand and one technical domain;
- one immutable official manufacturer snapshot with date and SHA-256;
- one complete, freshly generated Woo export with `fetched_at`, SHA-256 and row count;
- one exact adapter key/version/definition SHA that passes the immutable cross-brand regression;
- an allowlist of at most 25 entity keys and 50 field selectors;
- one named target for a possible technical support-pack candidate; and
- an explicit statement that Woo import, support-pack import, feed changes and all external mutations are unauthorized.

If any precondition is absent, produce a short `BLOCKED` preflight naming only the missing artifacts or decision. Never reconstruct the complete Woo snapshot through MCP pagination and never reuse the historical EAI-021 replay as current commercial truth.

For an eligible mandate, follow [the bounded audit pilot](../../../../runbooks/catalog-audit-pilot.md): run the locked regression, validate the exact adapter and sources, reconcile only the allowlisted entities and fields, perform human QA, and prepare a separate checksum-closed evidence publication. Deliver a `catalogue-audit-report` with `PASS`, `PARTIAL`, or `FAIL`, coverage, mismatches, blocked fields, exact hashes and follow-up recommendations. A support pack remains a separately reviewed candidate and every change set remains local `needs_review`; do not create an import file or update WooCommerce, Merchant Center, feeds, WordPress or the support database.
