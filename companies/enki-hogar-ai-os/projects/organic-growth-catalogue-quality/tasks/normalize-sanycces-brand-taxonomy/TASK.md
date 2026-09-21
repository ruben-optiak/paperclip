---
slug: normalize-sanycces-brand-taxonomy
name: Normalizar la marca Sanycces
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

Use the complete Woo export dated 2026-09-19, SHA-256 `d17beb10f05664e264b01c7b514a68267cae626842fcd3fd09531ad0d3201d95`, as frozen evidence only. It contains 354 published rows labelled `Sanycess` instead of `Sanycces` (4 top-level products and 350 variations), 306 private rows without a brand (51 top-level products and 255 variations), 986 correctly branded published rows, and one correctly branded private row.

Produce an exact parent-and-variation change set that maps the confirmed typo to the canonical brand without creating a second taxonomy term, changing slugs, altering visibility, or touching unrelated brands. Review the 306 private blank-brand rows separately; a blank inactive row is not automatically an error and must not be mass-filled without confirming its product identity and intended retention state.

Acceptance requires a fresh complete export, exact affected IDs and SKUs, parent/variation coverage, redirect or taxonomy-impact analysis, a dry-run diff with zero out-of-scope cells, and a post-change full-export audit. Keep every WooCommerce mutation operator-only and Board-approved.
