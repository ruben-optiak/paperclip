---
slug: obtain-sanycces-priced-tariff
name: Obtener tarifa PVP Sanycces 2026 con precios
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

The supplied `GRIFERIA_N_2026-SP.pdf` is an inventory and technical source, but a full 133-physical-page word scan finds zero currency symbols and zero explicit PVP, price, IVA, VAT or EUR labels. Its decimal values are dimensions, flow rates and other technical specifications. The current export also leaves `_enki_pdf_pvp_sin_iva`, `_enki_price_basis_note` and `_enki_regular_price_includes_vat` empty. Therefore no PDF-to-Woo price mismatch can be asserted from this attachment.

Obtain the priced edition of the same catalogue or an official reference-level tariff whose edition, effective date, currency and VAT basis are explicit. Bind it immutably by SHA-256 and reconcile every reference without inferring prices from retailers. Keep three separate values: official PVP excluding VAT, expected Woo regular price including the reviewed VAT rate, and the independently governed sale price/discount. Define rounding at the reference level and record exceptions.

Acceptance requires a source fingerprint, edition/effective date, exact SKU coverage, explicit VAT and rounding rules, a reviewed mismatch tolerance, and a report that distinguishes missing price evidence from confirmed price errors. No price write, draft creation or publication is authorized by this task.

## Evidence received 2026-09-20

`PVP_NACIONAL_2026.xlsx` was supplied as the official tariff and locked by
SHA-256 `7d5b13c4213ac53e849994a651c8d4f23e532d8f86e60990d3bd4982785b67d8`.
It contains 7,660 unique unfiltered `PVPNA` rows, covers all 925 inventory
references from the reviewed PDF and all 52 Pool references. Applying 21% VAT to
the tariff PVP reproduces the current Woo regular price exactly for all 414
published references that have an exact PDF identity. The workbook has no explicit
IVA label, so this cross-check is retained as the tax-basis evidence. Discounted
sale prices remain a separate commercial decision.

The full published-site reconciliation is broader than the grifería PDF. It covers
all 1,217 sellable published SKUs: 1,196 match a tariff reference directly and 21
Cardiff variants are exact combinations of a tariff base plus `SOLIDMEC` and/or
`SOLIDTWMEC`. All 1,217 regular gross prices equal the applicable official net PVP
or component sum multiplied by 1.21. There are no unresolved published identities,
missing regular prices or confirmed price differences. The 6,464 tariff references
without an identical published SKU are a classification backlog, not automatic
publication candidates; two are used as Cardiff components and 6,462 are not
represented by the published catalogue.

Three tariff rows outside the attached PDF inventory have PVP zero: `ACC655`,
`ACC658` and `ACC662`. They do not affect the 925-reference reconciliation or the
Pool preparation, but require a commercial-source check before any future attempt
to publish those accessories.

The published catalogue also proves the approved Sanycces price-tier policy on
all 1,217 sellable SKUs: 5% below EUR 25 net PVP; 7.5% from 25 to below 50; 10%
from 50 to below 100; 15% from 100 to below 250; 17.5% from 250 to below 500;
and 20% from 500. Woo regular gross is rounded after 21% VAT, then the discount
is applied and rounded half-up to cents. The resulting sale price matches every
published SKU exactly. The immutable operational record is
`references/commerce/sanycces-discount-policy-v1.json`; a different future rule
requires a reviewed revision rather than an implicit override.
