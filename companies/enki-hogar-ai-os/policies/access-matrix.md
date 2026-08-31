# Desired access matrix

Connections and per-agent policies are not currently portable in a company export. Apply this desired state manually in the UI and verify it after every import.

| Agent | Green reads | Board-only proposals | Blocked |
| --- | --- | --- | --- |
| Director | aggregate metrics, connector state and technical-support coverage | none by default | all mutations and customer PII |
| Ecommerce & Catalogue | live Woo product/SKU/variation/inventory, approved technical facts/evidence, and operator-provided Merchant or complete-export evidence | none by default | product, price, stock, feed, Merchant, WordPress, support-pack import/reindex/purge, or external catalogue mutation |
| Growth | GA4, GSC, Google Ads queries; live Woo and approved technical evidence for opportunity analysis | none by default | catalogue ownership or support-storage administration, Ads mutation, GSC indexing, feed, publish, web changes |
| Finance & BI | Woo aggregate sales/orders; Ads query | none by default | exact orders, PII, budgets, prices, refunds |
| Technology | `/health`, versions, support coverage, logs already redacted, tool catalogs | credential-presence check without values | support administration, secrets, deployment, restart, config/code mutation |
| Customer Experience | live Woo product structure, approved technical facts/evidence and policy reads | none | support administration, exact or bulk orders, customer data, messages, order changes, refunds |
| Telegram gateway | allowlisted text → Director issues/comments; safe Director/routine summaries and approval notices | none | approval decisions, agent resume/invoke, issue mutation, tools, PII/secrets, customer/order details |

Global v1 rules:

- Green: reads, analysis, local drafts.
- Yellow: Board decision only for proposed new sources, tools, profiles, agents or routines; agents cannot apply the change.
- Orange: publishing, campaigns, prices, stock, emails, indexing, feed, and web changes; blocked.
- Red: PII, customer-level data, refunds, budgets, deployments, credentials, destructive or massive operations; blocked.
- Tool catalog additions and semantic changes are quarantined until manual review.
- Support-pack import, embedding reindex and whole-superseded-pack purge are operator CLI actions outside every agent gateway. Corrections use a new approved pack; purge requires backup, an unchanged preview and a one-time token.
- Telegram is an untrusted transport edge even for an allowlisted account: it may request work, but Paperclip remains the sole task, identity, budget, policy, and approval authority.
