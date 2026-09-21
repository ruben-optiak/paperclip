# Measurement reconciliation baseline

`EAI-006` was captured read-only on 2026-09-03 for the two closed calendar
months 2026-07-01..31 and 2026-08-01..31 in `Europe/Madrid`. The sanitized
machine-readable receipt is
`references/measurement/eai-006-baseline-2026-09-03.json`; it contains no
property/customer/account IDs, queries, credentials or row-level data.

## Reproducible queries

- WordPress: `wordpress_list_posts(status=publish,page=1,per_page=100)` creates
  the exact public editorial inventory. The observed inventory was 26 posts.
- GA4 totals: `run_report` with no dimension and metrics `sessions`,
  `activeUsers`, `screenPageViews`, `engagedSessions`, `eventCount`,
  `keyEvents`, `totalRevenue`, `purchaseRevenue` for each closed month.
- GA4 events: the same period grouped by `eventName`, using `eventCount` and
  `keyEvents`; inspect at least `page_view`, `view_item`, `add_to_cart`,
  `begin_checkout` and `purchase`.
- GA4 page coverage: group by `pagePath` with `screenPageViews`, limit 250000,
  normalize only query string and trailing slash, then exact-match the public
  WordPress canonical paths.
- GSC: `gsc_search_analytics` on `sc-domain:enkihogar.com`, type `web`, grouped
  by `page`, row limit 25000 and start row 0. Sum clicks/impressions; calculate
  CTR as clicks/impressions and position weighted by impressions. The observed
  row counts were 267 and 272, so neither response reached the limit.
- Woo: `woo_sales_summary` for the same calendar dates. It queries the exact
  recognized current statuses and returns aggregates without order/customer
  rows.

Keep each connector response in its canonical evidence envelope during the
run. Commit only the aggregate receipt. A future rerun creates a new dated
receipt; it never overwrites this observation.

## Finding

The baseline is `PARTIAL`, not zero and not a tracking PASS:

- July: Woo observed 8 recognized orders and EUR 2,586.05 gross checkout
  revenue; GA4 observed 4 purchase events and EUR 1,684.73 purchase revenue.
- August: Woo observed 1 recognized order and EUR 316.49; GA4 observed zero
  purchase events and zero revenue.
- August editorial coverage was 9/26 published paths with any GA4 page view
  and 1/26 with GSC impressions. GSC reported 131 impressions and zero clicks
  for that matched editorial path; GA4 reported 19 editorial page views.
- GA4 reported no sampling metadata or other-row data loss in the totals, so
  those flags do not explain the commercial mismatch.
- Consent/tag status is unknown because no governed consent diagnostic source
  is connected. It must not be inferred from event volume.

## Metric usability

- GSC clicks, impressions, CTR and position are usable for scoped search
  visibility comparisons with exact dates and dimensions.
- GA4 sessions, views and engagement are directional behavioural measures.
- GA4 purchases and revenue are not commercial truth until the missing purchase
  coverage and revenue differences reconcile against Woo.
- Woo recognized orders and checkout revenue remain the current commercial
  aggregates, but provide no marketing attribution or verified profit.
- Editorial outcome claims remain partial because URL coverage across GA4 and
  GSC is sparse.

`EAI-007` and `EAI-023` therefore remain blocked from performance claims. A
Technology follow-up should inspect consent/tag firing and the exact purchase
event path without changing production during diagnosis. Any implementation
requires a separate reviewed change and before/after verification.
Do not change analytics, tags, consent, campaigns or the site in this ticket.
