# Context and editorial memory

Paperclip stores durable work, but it does not inject the whole company history into every agent run. A heartbeat receives the current issue and a bounded wake delta; the agent must explicitly fetch or search broader history when the task needs it. A resumed Codex session is useful working context, not the source of truth.

## Where each kind of knowledge lives

| Layer | System of record | Use |
| --- | --- | --- |
| Stable rules | This package: agent contracts, skills and curated references | Brand, safety, schemas, metric definitions and historical baselines |
| Operational history | Paperclip database: issues, comments, issue documents and work products | Decisions, briefs, drafts, reviews, approvals and handoffs |
| Published content | WordPress and Meta, read through approved connectors | Current post IDs, URLs, state and publication dates |
| Demand and seasonality | WooCommerce, GA4, GSC and Google Ads | What sold, what was searched, channel performance and comparison periods |
| Live commercial catalogue | WooCommerce | What is sold now: SKU, parent/variations, status, URL, price and stock |
| Stable product support | Approved product-support packs | Technical identity, specifications, explicit compatibility, configuration semantics and support text |
| Current market trends | An approved, dated external source | Claims about what is happening outside Enki now |

Snapshots in Git never prove current state. Paperclip conversation history never proves what is currently published. Connector data never replaces a recorded decision or approval.

The product-support projection is not conversational memory and not a commercial catalogue. Bulk product reconciliation always starts from a fresh complete Woo export in the `enki-hogar` pipeline; support answers join live Woo facts to a dated approved technical pack through the SKU crosswalk.

## Content ledger

Use the `content-memory-ledger` issue in the Organic Growth project as the discoverable anchor. Its issue document key is `content-ledger` and its body follows `enki-content-ledger/v1` from `references/contracts/content-ledger-v1.schema.json`. Planning lives in the source issue document `editorial-brief`, follows `references/contracts/editorial-brief-v2.schema.json`, and moves through `references/contracts/editorial-workflow-v2.json`. Once initialized, an update to a completed anchor issue must use Paperclip's explicit resume semantics.

The ledger stores only non-sensitive summaries: channel, external ID, canonical URL, status, publication time, topic cluster, product/SKU references, categories, campaign and verification time. It never stores credentials, customer data, message recipients or raw analytics payloads. WordPress and Meta remain authoritative; the ledger records coverage and can be `partial` or `unavailable`.

Before proposing content, Growth must:

1. Record the current instant and `Europe/Madrid` timezone.
2. Search Paperclip company data for the topic, product, campaign and related drafts/reviews.
3. Read the latest `content-ledger` revision and state its coverage.
4. Query the approved WordPress and Meta read surfaces for current published/scheduled content. If a provider is not configured or healthy, mark that channel `unavailable`; do not claim the search is complete.
5. Query dated WooCommerce/GA4/GSC/Ads evidence for demand and seasonality. Compare explicit periods; never infer a seasonal pattern from the calendar alone.
6. Use a current approved market source before claiming a recent external trend. Without it, write `UNKNOWN`.

## Phase-gated editorial workflow

1. **Research.** Growth creates or updates `editorial-brief` with current instant, timezone, objective, explicit periods, freshness, source coverage, history searches and limitations. A current market trend requires an approved dated market source; otherwise it is `UNKNOWN`.
2. **Shortlist.** Growth types each candidate surface, keeps WordPress and Woo identities separate, records the declared score weights and recalculable dimensions, and saves the exact brief revision plus SHA-256 candidate fingerprint.
3. **Candidate validation.** Only after Growth finishes, the Director sends that exact revision and fingerprint to Ecommerce. Ecommerce validates the same `candidateKey + surfaceType + canonicalUrl` set without additions or omissions. Missing input is `BLOCKED / NOT VALIDATED`; commercial evidence that does not apply to an editorial surface is `not_applicable`, not PASS.
4. **Board decision.** The Director presents the validated revision, computed totals, risks, unknowns and requested next step. Only Board records `accepted`, `accepted_with_conditions` or `rejected` against that exact revision. The decision itself grants no external-write authority.
5. **Apply the decision.** Director or Growth creates a strictly newer `editorial-brief` revision that records the decision, conditions and next action. Until it exists, the decision gate is incomplete. `draft` remains forbidden unless Board explicitly selected it as the next stage.
6. **Draft and review.** Growth creates `content-draft` only from the authorized post-decision brief. The Director then creates the Ecommerce review with the exact source issue, document key and revision. Ecommerce applies Brand Guardian; missing or inaccessible input is `BLOCKED / NOT REVIEWED`, never a zero-claim PASS.
7. **Publish.** Growth may request publication only through the reviewed `content_publisher` tools with a stable issue/document/revision idempotency key. Paperclip binds a separate approval to the exact arguments; only Board approves. After connector success, Growth reconciles the ledger from the live response. An uncertain journal entry blocks retry until operator reconciliation.

Before each handoff, run the validator vendored with `enki-editorial-planning`. Its fixtures preserve the corrected `ENK-24` lessons without carrying live database identifiers: category/article identity separation, exact candidate alignment, deterministic score totals and a mandatory post-decision revision.

Company search is retrieval, not automatic memory. Every content brief must name what was searched, the period covered, missing channels and the freshness of each source.
