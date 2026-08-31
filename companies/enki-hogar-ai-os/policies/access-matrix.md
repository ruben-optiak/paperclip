# Desired access matrix

Connections and per-agent policies are not currently portable in a company export. Apply this desired state manually in the UI and verify it after every import.

| Agent | Green reads | Board-only proposals | Blocked |
| --- | --- | --- | --- |
| Director | aggregate metrics, connector state, publication history and technical-support coverage | none by default | publication calls, all other mutations and customer PII |
| Ecommerce & Catalogue | live Woo product/SKU/variation/inventory, approved technical facts/evidence, and operator-provided Merchant or complete-export evidence | none by default | product, price, stock, feed, Merchant, WordPress, support-pack import/reindex/purge, or external catalogue mutation |
| Growth | GA4, GSC, Google Ads queries; live Woo, approved technical evidence and WordPress/Meta publication history | exact reviewed WordPress/Facebook/Instagram publication via ask-first connector | catalogue ownership or support-storage administration, Ads mutation, GSC indexing, feed, direct API, delete, bulk/social-account or web changes |
| Finance & BI | Woo aggregate sales/orders; Ads query | none by default | exact orders, PII, budgets, prices, refunds |
| Technology | `/health`, versions, support coverage, publisher capability state, logs already redacted, tool catalogs | credential-presence check without values and operator journal reconciliation proposal | support administration through MCP, secrets, publication, deployment, restart, config/code mutation |
| Customer Experience | live Woo product structure, approved technical facts/evidence and policy reads | none | support administration, exact or bulk orders, customer data, messages, order changes, refunds |
| Telegram gateway | allowlisted text → Director issues/comments; safe Director/routine summaries and approval notices | none | approval decisions, agent resume/invoke, issue mutation, tools, PII/secrets, customer/order details |

Global v1 rules:

- Green: reads, analysis, local drafts.
- Yellow: Board decision only for proposed new sources, tools, profiles, agents or routines; agents cannot apply the change.
- Orange: the three exact publication tools are ask-first and bound to reviewed arguments; campaigns, prices, stock, emails, indexing, feed, direct APIs, deletes and web changes remain blocked.
- Red: PII, customer-level data, refunds, budgets, deployments, credentials, destructive or massive operations; blocked.
- Tool catalog additions and semantic changes are quarantined until manual review.
- The content connector's own write kill switch stays `disabled` through catalog review. `wordpress-drafts` permits only approved WordPress drafts; `approved` still does not bypass Paperclip ask-first policy.
- Every publication uses a stable issue/document/revision idempotency key. An uncertain provider outcome blocks automatic retry until operator-only reconciliation against the live platform.
- Support-pack import, embedding reindex and whole-superseded-pack purge are operator CLI actions outside every agent gateway. Corrections use a new approved pack; purge requires backup, an unchanged preview and a one-time token.
- Telegram is an untrusted transport edge even for an allowlisted account: it may request work, but Paperclip remains the sole task, identity, budget, policy, and approval authority.
