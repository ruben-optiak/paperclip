---
slug: verify-sanycces-official-crosswalk
name: Verificar el crosswalk oficial de Sanycces
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

The PDF `GRIFERIA_N_2026-SP` is the catalogue-inventory source of truth; the official website is not complete enough to define inventory and does not expose the catalogue SKU in the inspected page or public REST body. The reviewed Pool pass reconciles 27 visual index cards with 28 PDF inventory groups: 20 base product candidates, four kits and four components. Two additional references are compatibility-only mentions. The earlier five-family web canary is enrichment evidence only, not Pool coverage.

Create a human-reviewed PDF↔Woo crosswalk using the exact index, technical and matrix pages, product drawing/image, title, collection, configuration and finish set. Record competing matches and fail closed on ambiguity. Use official web pages only as optional enrichment or a bounded check for a specific ambiguity; absence online must never reject a PDF group. Extend the PDF-first method to every proposed absent or partial family before drafting products, SEO or media.

Acceptance requires an immutable mapping revision, reviewer, evidence locators, explicit confidence reasons, zero unresolved collisions and an exact list of mappings approved for downstream use. Similar titles or images alone are insufficient.

The frozen official Pool filter captured on 2026-09-20 contains 26 cards. Twenty-two official pages map as enrichment to 24 PDF groups: 18 product pages cover 20 base groups, and four Sanybox pages cover the four PDF components. Four official Pool accessories have no Pool inventory record in the attached PDF and must remain `official_web_only_not_in_attached_pdf_pool_inventory`. Conversely, the four PDF kit groups have no standalone official page. Preserve this many-to-many result; do not force a false one-page-per-group mapping or let the four web-only accessories expand PDF inventory.
