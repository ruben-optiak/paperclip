---
slug: rebuild-sanycces-series-taxonomy
name: Reconstruir la taxonomía de series Sanycces
assignee: ecommerce-catalogue-manager
project: organic-growth-catalogue-quality
---

The `pa_seriessanycess` export field is empty for every one of the 1,340 published rows. Only six private rows contain a value, all `New Lisboa`. The taxonomy key itself retains the misspelled brand form and must not be renamed blindly because it may be referenced by filters, feeds or templates.

Create a reviewed crosswalk from official collections and catalogue sections to each top-level product, then define variation inheritance. Start with the verified faucet sections Dedal, Pool, Loop, Cubo and Accessories. Identify whether the existing taxonomy should be retained, migrated or replaced, and inventory all storefront filters, URLs, Merchant mappings and theme dependencies before proposing a change.

Acceptance requires exact current and proposed terms, parent/variation counts, collision and redirect analysis, a local change set, and a rollback/readback plan. Taxonomy creation, term migration and product assignment remain operator-only.
