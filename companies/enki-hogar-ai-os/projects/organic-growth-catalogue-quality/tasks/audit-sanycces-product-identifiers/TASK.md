---
slug: audit-sanycces-product-identifiers
name: Auditar SKU y GTIN de Sanycces
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

The frozen export resolves to 212 top-level products and 1,435 variations. Fifty-eight top-level variable parents have no SKU, which may be intentional. Global Unique Id is absent on 450 rows: 174 top-level products and 276 variations. Of those variations, 21 are published and 255 are private. No duplicate non-empty SKU was found.

Audit identifiers by entity role rather than treating every blank as an error. Verify the 21 published sellable variations first against an official manufacturer or supply-chain source. Confirm whether parent SKUs and parent GTINs are required by the store, feed and Merchant Center contracts. Never derive or fabricate a GTIN from a SKU, catalogue reference or sibling variation.

Acceptance requires a classification of expected blanks versus confirmed gaps, immutable evidence for every proposed identifier, duplicate checks across the complete fresh export and a zero-collision local change set. Identifier writes remain operator-only.

The 2026-09-20 published-catalogue crosswalk must not use the attached grifería PDF
as a deletion or obsolescence test. Of 160 published Sanycces parent products, 76
contain at least one exact reference from that PDF; the remaining products require
their corresponding catalogue or the full tariff, regardless of their Woo category.
The full tariff reconciliation now covers all 1,217 sellable published SKUs. The 86
non-empty SKUs on variable parents are local grouping identifiers, not priced
commercial references. Twenty-one sellable Cardiff SKUs are also intentionally
local composites; their `.G`, `.T` and `.TG` suffixes map to the official base plus
`SOLIDMEC`, `SOLIDTWMEC` or both. Do not report either class as a missing official
SKU without applying the entity-role and composition rules.

The official 2026 tariff adds one confirmed source defect: row 77, reference
`BA002BN156MA`, carries the 26-digit value
`84357377973818435737797381`, which is two concatenated EAN-13 values. Preserve
the raw evidence, do not choose one half automatically and obtain the correct GTIN
from an independent official source before any identifier write.
