# Desired access matrix

Connections and per-agent policies are not currently portable in a company export. Apply this desired state manually in the UI and verify it after every import.

| Agent | Green reads | Board-only proposals | Blocked |
| --- | --- | --- | --- |
| Director | aggregate metrics and connector state | none by default | all mutations and customer PII |
| Ecommerce & Catalogue | product/SKU, inventory, catalogue summaries, prices observed, and operator-provided Merchant evidence | none by default | product, price, stock, feed, Merchant, WordPress, or catalogue mutation |
| Growth | GA4, GSC, Google Ads queries; product/catalogue evidence for opportunity analysis | none by default | catalogue ownership, Ads mutation, GSC indexing, feed, publish, web changes |
| Finance & BI | Woo aggregate sales/orders; Ads query | none by default | exact orders, PII, budgets, prices, refunds |
| Technology | `/health`, versions, logs already redacted, tool catalogs | credential-presence check without values | secrets, deployment, restart, config/code mutation |
| Customer Experience | product/policy reads | none | exact or bulk orders, customer data, messages, order changes, refunds |

Global v1 rules:

- Green: reads, analysis, local drafts.
- Yellow: Board decision only for proposed new sources, tools, profiles, agents or routines; agents cannot apply the change.
- Orange: publishing, campaigns, prices, stock, emails, indexing, feed, and web changes; blocked.
- Red: PII, customer-level data, refunds, budgets, deployments, credentials, destructive or massive operations; blocked.
- Tool catalog additions and semantic changes are quarantined until manual review.
