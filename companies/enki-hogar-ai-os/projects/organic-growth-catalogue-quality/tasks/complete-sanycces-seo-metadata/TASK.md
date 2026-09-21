---
slug: complete-sanycces-seo-metadata
name: Completar metadata SEO de Sanycces
assignee: growth-manager
project: organic-growth-catalogue-quality
---

The frozen 2026-09-19 export contains 212 top-level products and 1,435 variations. None of the 212 top-level products has a Yoast SEO title, only four have a meta description, and none has a focus keyword. Variation rows are not a valid denominator for page-level metadata and must not receive duplicated page copy.

Build unique, source-backed SEO titles and meta descriptions for top-level product pages only. Use the official Sanycces product page, the exact catalogue page and the approved SKU crosswalk; preserve collection, product type and differentiating configuration without inventing claims. Treat focus keywords as an editorial aid, not a publication completeness requirement. Check title and description length, duplication, intent overlap, canonical URL and indexability before requesting any write.

Acceptance requires a per-parent draft ledger with source URLs and catalogue page locators, duplicate and cannibalization checks, brand review, and a bounded canary. No metadata may be pushed to WooCommerce or WordPress without exact Board approval and post-write readback.

Before any Pool parent leaves draft, review and enrich its visible description for search intent and conversion. Remove all internal provenance/process language. Add only source-backed content that helps a buyer decide: use case, installation and compatibility, what is included or required separately, flow rate, dimensions, finish choice and maintenance when the official sources support it. Growth must review SEO/SEM intent, cannibalization, internal-link opportunities, structured-data fit and metadata; Ecommerce retains responsibility for factual product accuracy. Record PASS/WARN/FAIL per parent and return factual gaps to Ecommerce rather than inventing copy.

## Pool checkpoint · 2026-09-21

- Administrative readback: 24/24 parents still `draft` + `hidden`; 40/40
  variations remain `publish`; brand and parent/child categories match the
  reviewed bundle.
- Current verdict: 20 PASS and four field-level FAILs. `MEN000SS`, `MH2000SS`,
  `RAC00012SS` and `TH2000SS` inherited unsupported `316L` and finish language
  in their meta descriptions.
- Local candidate v15 resolves those four metadata claims and tailors eight
  flow-rate benefits to the exact basin or bidet use. Candidate verdict: 24/24
  PASS. No external write was performed.
- Before rollout, request exact approval for the 12 changed parents. Then use
  `MNO006SS` as the only public canary and verify canonical, indexability,
  Product/Offer schema and rendered copy.
- Keep Woo→Merchant description mapping as PARTIAL until the actual feed field
  is read. After stable public URLs exist, add direct links from the eight
  external controls that require Sanybox to the exact compatible body.
- Evidence: `outputs/sanycces-pool-content-seo-review-20260921-v1/REPORT.md` and
  candidate manifest SHA-256
  `a0c563d2e329a1e2546fca4df308b2ddf32b372e6c74b22228858f5433730996`.

### Applied checkpoint

The operator approved that exact manifest on 2026-09-21. The bounded update
changed eight long descriptions and four Sanybox meta descriptions, then read
back all 12 affected parents. They remain `draft` + `hidden`; their 16 child
variations remain `publish`. Price, stock, media, taxonomy and brand were
preserved. Receipt:
`outputs/sanycces-pool-draft-bundles-20260921-v15-content-seo-review/content-seo-live-verification.json`
(SHA-256 `6850052c349bf8f752c365aae239733702eaa3380401087c64a5dd4e8db4945b`).
Publication remains a separate gate.

### Pool CTA layout checkpoint

The operator approved manifest
`d60d0b25df9f6a68292c442687bcc445a0084a6d13bc50d96f6029ebef60a901`
on 2026-09-21. All 24 long descriptions now place the Pool-series search CTA in
its own paragraph. Independent readback verified 24/24 parents as
`draft` + `hidden` and 40/40 variations as `publish`; SEO metadata, prices,
stock, media, brand and taxonomy were preserved. Receipt:
`outputs/sanycces-pool-draft-bundles-20260921-v16-series-link-layout/series-link-live-verification.json`
(SHA-256 `8fb9efe808abd4d4ea1248938a12df53ffd2be012d049f48efbed79df02e2094`).

### Public canary checkpoint

The operator approved product bundle
`f56e19856fb2df28df4989ff4f7c2a09d36c7c8cdb34890694b7391cc8aca10c`
as the only public Pool canary on 2026-09-21. `MNO006SS` is now `publish` +
`visible`; the other 23 parents remain `draft` + `hidden`, and all 40 child
variations remain `publish`. Administrative readback found no changes to copy,
SEO metadata, price, stock, media or taxonomy. Public QA passed HTTP, canonical,
indexability, Product/AggregateOffer schema, gallery, variation visibility and
desktop/mobile rendering. Both finish selectors switch to the corresponding
Metal Raw or brushed-nickel image. Evidence:
`outputs/sanycces-pool-draft-bundles-20260921-v16-series-link-layout/MNO006SS-CANARY-RESULT.md`.

Merchant Center remains pending until the next real feed ingestion exposes the
product. Do not use this canary as approval to publish the other 23 parents;
verify Merchant field mapping, price, availability and item status first.

### Merchant readback preparation

The configured Google ADC was probed read-only on 2026-09-21 and does not carry
the Merchant `https://www.googleapis.com/auth/content` scope. No Merchant account
or feed state was changed. The bounded verifier
`connectors/content-publisher/scripts/verify_pool_mno006ss_merchant.mjs` is ready
and pins the approved product bundle. Once the operator renews the ADC with the
existing scopes plus `auth/content`, it will select only the account named Enki
Hogar, scan processed products, match the two canary variations by exact
SKU/GTIN/Woo ID, and verify price, availability, canonical link, variation
image, Woo-to-Merchant description mapping and Spain approval state. Its output
redacts account and data-source resource IDs by hashing them and declares zero
external writes. The other 23 Pool parents remain outside this gate.

The operator completed a second consent flow at 2026-09-21 11:59 CEST. The
isolated ADC now issues a token with `auth/content`; the verifier was corrected
to bind both the ADC file and its isolated gcloud configuration directory. The
next read-only request reached Google but returned `SERVICE_DISABLED`: neither
Merchant API nor the legacy Content API for Shopping is enabled in the OAuth
project. Treat this as a Google project configuration blocker, not as a product
or feed failure. No Merchant evidence or item-status verdict exists yet, and no
external write occurred. Enabling `merchantapi.googleapis.com` requires a
separate operator approval before the bounded readback can continue.

The operator approved that configuration change and Merchant API was enabled
successfully in the Enki OAuth project on 2026-09-21. The next read-only request
reached Merchant API but returned `GCP_NOT_REGISTERED`: Google requires the
Cloud project to be associated with the Merchant account through
`developerRegistration.registerGcp`. That registration also assigns the
`API_DEVELOPER` role to an existing Merchant user or emails an invitation to a
new one, so it remains a separate governed change requiring the exact Merchant
account ID, developer email and operator approval. Product and feed state remain
untouched; the other 23 Pool parents stay outside the gate.

The operator supplied Merchant Center ID `688622398` and authorized a minimal
registration without a developer email. Google rejected the request before any
link was created because the authenticated user is not a user of that managed
account. The API identified Merchant Center ID `5328211490` as the main account
where the user exists and instructed registration there instead. Registering
the main account may cover multiple managed merchant accounts, so it requires a
new exact operator approval; do not infer it from the rejected subaccount
attempt. No users, roles, products, feeds or account links were changed.

The operator then explicitly approved registration against main Merchant
Center account `5328211490`. Google confirmed the GCP association with one
project; no developer email was supplied and no user or role was added. A
direct read of managed account `688622398` confirmed the expected account name
Enki Hogar. The bounded verifier scanned seven pages and 6,631 processed
products but matched neither `MNO006SSNB` nor `MNO006SSRM`, so the Merchant
canary verdict is `PENDING`, with zero external writes. Evidence:
`outputs/sanycces-pool-draft-bundles-20260921-v16-series-link-layout/mno006ss-merchant-verification.json`
(SHA-256 `a0498291ade4c5ae5b8c559a33dbdcacae4b70626ec8437d6ab51af8a49336bf`).
Keep the other 23 Pool parents gated until the real feed ingests both variants
and their fields and Spain item status can be verified.

A separate read-only source check confirmed that the primary `Feed Google`
data source is an enabled daily file fetch for Spain, Free Listings and Shopping
Ads. The currently served XML contains none of the canary SKUs, Woo IDs or
canonical slug, so the delay is upstream of Merchant ingestion rather than an
item rejection. Evidence:
`outputs/sanycces-pool-draft-bundles-20260921-v16-series-link-layout/mno006ss-feed-presence-verification.json`
(SHA-256 `08232d58cbe2b53b5a566974264557025d4637afc8dfab987db5229baa6706af`).
Wait for or separately authorize regeneration of the WooCommerce XML before
rerunning the Merchant readback.

### Remaining Pool publication proposal

On 2026-09-21 the operator stated a preference to publish the remaining Pool
products despite the upstream feed delay. A zero-write rollout manifest now
enumerates exactly the other 23 parent IDs and their five reviewed bundle
hashes, excludes the already-public `MNO006SS`, and records the accepted risk
that Merchant item-level fields and Spain approval remain unverified until the
daily XML catches up. Manifest SHA-256:
`a1fd74f1b0d169077f374eaf1dcd0f2cd108371c67ce7b1bdcc562baf8494d65`.

Live preflight PASS: 23/23 targets remain `draft` + `hidden`, their reviewed v16
content matches, all 38 child variations remain `publish`, and the public
canary remains `publish` + `visible`. The intended write changes only each
target parent's status and catalog visibility; it preserves content, price,
stock, media, SEO metadata, taxonomy, children, feed and Merchant items.
Preflight receipt:
`outputs/sanycces-pool-draft-bundles-20260921-v16-series-link-layout/pool-remaining-23-publication-preflight.json`
(SHA-256 `22f13f45bbd7e7eca2b1266a57cb7d39a57700aae373ac710e1e1b881af09781`).
The preference statement is not exact publication authority: require approval
that cites the rollout manifest hash before any of the 23 writes.

### Remaining Pool publication applied

The operator approved the exact remaining-23 manifest
`a1fd74f1b0d169077f374eaf1dcd0f2cd108371c67ce7b1bdcc562baf8494d65`
and explicitly accepted that Merchant validation remains pending until the next
feed generation. The controlled rollout completed on 2026-09-21: all 23 target
parents are now `publish` + `visible`, the canary remains public, and all 40
variations remain `publish`. Per-parent before/after comparison and a second
full administrative readback found zero changes to content, prices, stock,
media, SEO metadata or taxonomy and zero failures.

Public verification passed for 24/24 URLs: HTTP 200, exact final URL and
canonical, indexability, Product schema, Pool-series CTA and no internal process
language. Merchant remains a separate `PENDING` follow-up, not a publication
failure. Evidence:

- journal SHA-256
  `86fc5f0dad848270f6c8299b106ab25d897c8990892345aba561673eb17ea43d`;
- administrative receipt SHA-256
  `0898f3489bdb55b50c457e0f2350e5e1663fd0170f40a381ca6dbe1afd28bad8`;
- public receipt SHA-256
  `e41dc7fdb160fd60c40e292d1b70e9862d377ad628608127420a9bfb8d092477`;
- report:
  `outputs/sanycces-pool-draft-bundles-20260921-v16-series-link-layout/POOL-ROLLOUT-RESULT.md`.
