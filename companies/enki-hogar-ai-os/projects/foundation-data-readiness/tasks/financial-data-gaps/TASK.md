---
slug: financial-data-gaps
name: Definir datos financieros pendientes
assignee: finance-bi-manager
project: foundation-data-readiness
---

Apply `references/finance/minimum-data-contract-v1.json` and `runbooks/financial-data-contract.md`. Report recognized orders and checkout aggregates only with their exact Woo semantics. Keep COGS, statutory VAT/net revenue, carrier cost, PSP fees, refund-transaction timing, new customers and governed channel attribution unavailable until a reconciled source is admitted. CAC, gross margin, contribution margin and channel profitability remain `null`; do not estimate them as actuals or request customer-level data.
