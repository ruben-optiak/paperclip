---
slug: support-sanycces-variable-drafts
name: Soportar borradores variables de Sanycces
assignee: technology-manager
project: organic-growth-catalogue-quality
---

The governed product publisher currently accepts only simple hidden drafts. The frozen export contains 153 top-level variable products and 1,435 child variations, while only 59 top-level products are simple. Sanycces faucet families commonly require finish variations, so forcing them into simple products would break identity, filters and stock/price ownership.

Extend the strict product-draft bundle and Woo client with an atomic parent-plus-variation plan. Pin exact parent attributes and term IDs, child SKUs, finish values, media assignments and evidence. Require a dry-run plan, idempotency per parent revision, duplicate-SKU preflight, partial-failure reconciliation, created-object readback and a kill switch. Existing-product updates remain a separate operator workflow.

Acceptance requires schema fixtures, negative tests, a sandboxed two-finish Pool canary, zero live publication authority and Board approval over the exact final arguments. Do not widen the current simple-draft tool until all tests and rollback evidence pass.

## Implemented 2026-09-20

`enki-product-draft-bundle/v1` now accepts strict simple and variable parents.
The variable contract pins parent attribute IDs/options plus private child SKU,
manufacturer reference, option values, media position, regular/sale prices and
their evidence. The publisher preflights every parent/child SKU, executes one
journaled parent revision, rereads every object and leaves partial provider
outcomes uncertain with parent/child IDs for operator reconciliation. A sanitized
two-finish Pool fixture, schema negatives, client partial-failure test and full
readback test pass locally. Write mode remains disabled by default, the tool can
only create hidden drafts, and no live canary or product was created.
