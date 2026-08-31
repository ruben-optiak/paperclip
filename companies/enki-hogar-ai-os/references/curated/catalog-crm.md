# Catalogue and CRM context

Snapshot: 2026-08-29. Historical context, not live operational data.

The catalogue spans bathroom and kitchen categories and multiple manufacturers. Product quality work must preserve manufacturer evidence, product identity, parent/variation structure, compatible measurements, commercial fields, media, and customer-facing explanations.

WooCommerce live is the sole authority for the current commercial catalogue: what is sold, URL/status, parent/variations, price and stock. Bulk reconciliation uses a fresh complete Woo export as a dated work snapshot in the `enki-hogar` pipeline. The product-support database is separate and rebuildable; it holds only approved stable technical facts, explicit relations, configuration semantics, support text and SKU crosswalks. It must never become a second commercial catalogue.

CRM work in v1 is deliberately zero-PII: agents may use aggregate commerce information and cases already anonymized by the operator. There is no exact-order lookup, customer list, outbound messaging, order mutation, or refund capability, even with approval.

Catalogue candidates are drafts until the evidence pipeline and human approval are complete.
