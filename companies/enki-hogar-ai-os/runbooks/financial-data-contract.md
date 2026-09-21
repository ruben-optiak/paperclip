# Minimum financial data contract

`EAI-008` defines which financial measures Enki can and cannot calculate with
the governed sources available on 2026-09-03. The machine-readable contract is
`references/finance/minimum-data-contract-v1.json`.

## Available now

The zero-PII Woo aggregate supports recognized order count, gross checkout
revenue, explicit refund total attributed to the original order period, tax
total, customer shipping charge and discount total. These are commerce
operating measures, not an accounting P&L.

Google Ads can conditionally supply spend and platform-attributed conversion
value when the exact account, currency, period and conversion-action set are
declared. It cannot establish customer-level attribution. GA4 traffic and
engagement are directional; its purchase and revenue measures failed the
EAI-006 comparison with Woo and cannot replace Woo commercial aggregates.

## Unavailable inputs

No governed source currently supplies verified COGS, statutory net revenue ex
VAT, carrier fulfilment cost, PSP fees, refunds by refund transaction date,
deduplicated new customers or cross-channel attribution. Consequently CAC,
gross margin, contribution margin and channel profitability are unavailable.
Their value is `null`, never zero or an estimate.

Woo `tax_total` is not called VAT until tax classes and refund-tax treatment
are validated. Woo `shipping_total` is the amount charged to a customer, never
carrier cost. Ads ROAS remains a platform attribution measure and must not be
described as profit.

## Admission of a new source

A new input requires owner, grain, period semantics, timezone, currency,
freshness, completeness, reconciliation rule and an explicit statement about
PII. Store credentials only in a connector/secret boundary. Prefer governed
aggregates; do not create customer/order joins merely to calculate CAC.

Finance updates the contract in a new version after reconciling a representative
closed period. Until then `ENK-5`, `EAI-024` and every profitability claim stay
blocked. This ticket authorizes documentation and read-only validation only;
it does not authorize accounting imports, campaign changes, price changes or
access to customer-level data.
