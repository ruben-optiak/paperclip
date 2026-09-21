# Desired access matrix

Connections and per-agent policies are not currently portable in a company export. Apply this desired state manually in the UI and verify it after every import.

| Agent | Green reads | Board-only proposals | Blocked |
| --- | --- | --- | --- |
| Director | aggregate metrics, connector state, publication history and technical-support coverage | none by default | publication calls, all other mutations and customer PII |
| Ecommerce & Catalogue | live Woo product/SKU/variation/inventory, approved technical facts, approved catalogue-run field evidence/crops, reviewed offline product-draft bundles, and operator-provided Merchant or complete-export evidence | one exact simple or variable hidden WooCommerce `draft` from an approved bundle via ask-first | unapproved runs, raw catalogue inputs, product update/publish/delete, taxonomy creation, price or stock mutation outside the exact new-draft bundle, feed, Merchant, WordPress articles, support-pack import/reindex/purge, or bulk catalogue mutation |
| Growth | GA4, GSC, Google Ads queries; live Woo, approved technical evidence and WordPress/Meta publication history | exact reviewed WordPress/Facebook/Instagram publication via ask-first connector | catalogue ownership or support-storage administration, Ads mutation, GSC indexing, feed, direct API, delete, bulk/social-account or web changes |
| Finance & BI | Woo aggregate sales/orders; Ads query | none by default | exact orders, PII, budgets, prices, refunds |
| Technology | `/health`, versions, support coverage, publisher capability state, logs already redacted, tool catalogs | credential-presence check without values and operator journal reconciliation proposal | support administration through MCP, secrets, publication, deployment, restart, config/code mutation |
| Customer Experience | live Woo product structure, approved technical facts/evidence, policy reads, and one Board-provided private proforma request | final PDF bound to the exact approved request SHA-256 | customer/order search, PII in Paperclip/Git/logs/receipts, messages, order changes, refunds |
| Telegram gateway | allowlisted text → Director issues/comments; safe Director/routine summaries and approval notices | none | approval decisions, agent resume/invoke, issue mutation, tools, PII/secrets, customer/order details |

Global v1 rules:

- Green: reads, analysis, local drafts.
- Yellow: Board decision only for proposed new sources, tools, profiles, agents or routines; agents cannot apply the change.
- Orange: the three exact publication tools are ask-first and bound to reviewed arguments; campaigns, prices, stock, emails, indexing, feed, direct APIs, deletes and web changes remain blocked.
- Red: PII and customer-level data remain blocked except for Customer Experience's file-scoped `enki-proformas` transformation; refunds, budgets, deployments, credentials, destructive or massive operations remain blocked.
- Proforma PII is input/output data inside the Customer Experience private workspace only. The request is Board-provided, the final PDF requires its exact SHA-256, and no WhatsApp/email action exists.
- Tool catalog additions and semantic changes are quarantined until manual review.
- The content connector's own write kill switch stays `disabled` through catalog review. `wordpress-drafts` permits only approved WordPress drafts; `approved` still does not bypass Paperclip ask-first policy.
- Every publication uses a stable issue/document/revision idempotency key. An uncertain provider outcome blocks automatic retry until operator-only reconciliation against the live platform.
- Support-pack import, embedding reindex and whole-superseded-pack purge are operator CLI actions outside every agent gateway. Corrections use a new approved pack; purge requires backup, an unchanged preview and a one-time token.
- Telegram is an untrusted transport edge even for an allowlisted account: it may request work, but Paperclip remains the sole task, identity, budget, policy, and approval authority.
