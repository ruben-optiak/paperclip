---
slug: normalize-sanycces-finish-taxonomy
name: Normalizar acabados Sanycces
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

The 2026-09-19 export has 260 published variations without `pa_acabado`. Existing values also mix forms such as `Cromo` and `Cromo Brillo`, `Negro` and `Negro mate`, `Níquel mate` and `Níquel cepillado`, plus the new `Metal Raw`. A missing finish is not automatically wrong outside products whose configuration uses finish variants.

For the verified faucet scope, map the catalogue codes CR, BM, MG, RM, NB, BG and RG to canonical storefront terms and compare each variation with its parent, SKU suffix and official Sanycces finish taxonomy. Keep material, colour and commercial finish concepts distinct. Report non-faucet rows separately and do not force them into the faucet mapping.

Acceptance requires an exact affected-variation list, old and proposed term IDs/slugs, feed and filter impact, no sibling collisions, a bounded canary and full-export post-change audit. Term creation or reassignment requires operator execution and Board approval.
