# Governed WooCommerce product drafts

This runbook creates at most five reviewable product candidates from frozen
sources and permits one exact WooCommerce `draft` only after Board approval. It
does not authorize product updates, publishing, taxonomy creation or bulk work.

## 1. Freeze the sources

- Record one official brand domain and a dated catalogue SHA-256.
- Obtain a fresh complete WooCommerce product export and record its SHA-256.
- Limit the canary to one brand and one to five simple or variable products.
- Prove each product is new using manufacturer reference, SKU and GTIN when
  available. Stop on identity collisions or ambiguous parent/variation state.
- For the exact Sanycces 2026 faucet snapshot, run the pinned
  `sanycces-griferia-2026` adapter and retain its manifest, page evidence and
  group review. Any other Sanycces fingerprint still needs a new sanitized
  fixture and versioned adapter; a similar layout is not evidence.
- Treat the frozen PDF as catalogue inventory truth. Treat the locked Woo export
  as current Enki state. Manufacturer pages may enrich copy or media and resolve a
  specific ambiguity, but a missing web page never removes a PDF product.
- Require the Pool double check before any Pool shortlist: 28 inventory groups,
  of which 24 are product candidates and four are components. Ten is the number
  of Pool matrix pages, not the number of products.

## 2. Research and prepare

Capture only bounded HTTPS pages and media from declared official domains,
subject to their robots and terms. Record capture time and hashes. Write original
commercial copy rather than copying manufacturer paragraphs. Every technical,
identity and price claim needs field evidence.

Transform each rights-confirmed image with `prepare-product-media` and the exact
approved `enki-product-media-profile/v1`. Verify the output is WebP, has no
retained metadata, was not pixel-upscaled, and matches its recorded SHA-256.
PDF-embedded JPEGs and rendered crops remain evidence candidates until mapped and
visually reviewed. Reject them as final media when their source pixels are too
small; rendering the PDF at a higher DPI does not increase source-image quality.

For a white-background primary product cutout, apply the separate, versioned
`references/commerce/product-primary-image-policy.json` after source review. It
detects the non-white product bounds, preserves the exact geometry with uniform
scaling, recentres the product on a 1000 × 1000 white canvas, targets 78% content
occupancy, strips metadata and encodes WebP at quality 92. Upscaling is capped at
2× for official brand media and 1.75× for PDF-derived media; when the cap prevents
the target occupancy, retain the smaller result and record `upscaleCapped=true`
rather than inventing detail. This policy applies only to isolated product
cutouts. Do not apply it to inspiration photography, dimensions drawings or
finish swatches.

Every batch that changes primary framing must produce before/after contact sheets
and individual candidates for human approval before any WooCommerce write. A
generative reconstruction is never an accepted product hero because it may alter
components, proportions, finishes or nozzle patterns.

Use this customer-facing structure unless the catalogue proves that an asset is
not applicable:

1. Name the page `tipo de producto – marca – serie`, adding only a useful,
   evidenced differentiator. Keep the working title at 70 characters or fewer;
   the Merchant hard limit is 150 characters.
2. For a product with finishes, order the parent gallery as: designated
   merchandising finish on white, the remaining available finish cutouts,
   optional in-context inspiration, dimensions-only drawing, then finish
   swatches. For Sanycces Pool, use Metal Raw first and Níquel cepillado second;
   do not preselect a variation merely to obtain that initial hero. Never include
   the product photo or feature copy inside the dimensions crop. Every child must
   still use the exact image for its finish; retain it with `gallery=false` only
   when an approved merchandising decision excludes it from the parent gallery.
3. Structure the long description as: concise product introduction, series
   style, bounded technical bullets with customer benefit, series/options summary
   with an Enki search link, and a reusable brand summary. Put the series CTA in
   its own paragraph immediately after the options summary so it starts on a new
   visual line. Do not expose source, review or provenance notes to customers.
4. Keep the short description product-specific, concise and free of links or the
   generic brand boilerplate. Merchant accepts at most 5,000 characters for its
   description, but the Woo short description should prioritize the useful
   product facts that can appear first in a shopping surface.
5. Do not inherit series-level material or finish claims into a component. A
   label such as `Inox` does not prove grade `316L`, and a simple product without
   a finish attribute must not use a finish CTA. Product-benefit bullets must
   name the exact applicable use (for example basin or bidet), not a generic
   family containing uses that do not apply.

Treat inspiration images as optional and never fabricate missing scenes or
finishes. Ask Growth to validate search intent, keyword demand, cannibalization
and the actual Woo-to-Merchant field mapping before publication; do not label a
keyword “high traffic” without dated search data.

## 3. Build and review the bundle

Create `product-draft-bundle.json` plus a direct-child `media/` directory and run:

```sh
node companies/enki-hogar-ai-os/skills/enki-product-publishing/scripts/validate_product_draft_bundle.mjs \
  --bundle /path/outside/git/product-draft-bundle.json \
  --verify-files
```

Require catalogue QA `PASS` or explicit `PARTIAL`, Brand Guardian `PASS` or
`WARN`, existing category/tag/attribute IDs, Yoast fields, `manageStock=false`
and `stockStatus=outofstock`. A simple-product price is optional and needs exact
evidence. A variable parent has no price: each private child pins its SKU,
manufacturer reference, exact variation options, regular price, optional sale
price, media position and evidence. Every parent option must be represented.
Parent gallery positions must exclude any media marked `gallery=false`, while a
child may still reference that hidden media position for its own finish image.

When a reviewed local preparation contains more than five candidates, split it
into multiple immutable bundles and keep the one-to-five limit in every bundle.
For Sanycces Pool, `build-sanycces-pool-bundles` resolves the existing Woo
category and `Acabado` IDs from frozen public taxonomy snapshots, verifies all
parent and child SKU plus slug absences against the exact Woo export, places the
four standalone Sanybox products in `Fontanería > Sanybox`, and excludes the four
kits while their dedicated heroes are missing. Then run the read-only batch
preflight:

```sh
node companies/enki-hogar-ai-os/connectors/content-publisher/scripts/preflight-bundle-batch.mjs \
  --batch /path/outside/git/BATCH_RUN/batch-manifest.json
```

The preflight parses the real WebP container, checks declared pixel dimensions,
rejects retained ICC/EXIF/XMP data and animation, verifies every GTIN check digit,
rejects duplicate or visibly truncated SEO fields, and independently recalculates
the gross and sale price for every SKU from `price-policy-audit.json` and the
hash-pinned discount policy. Its report is deterministic and may be rerun safely.
The batch manifest and preflight report are review conveniences only. They do
not expand approval scope: every later draft request still names one exact
`bundleSha256 + productKey` and opens its own approval gate.

Prepare the exact, non-authoritative canary dossier before requesting approval:

```sh
node companies/enki-hogar-ai-os/connectors/content-publisher/scripts/prepare-canary-review.mjs \
  --batch /path/outside/git/BATCH_RUN/batch-manifest.json \
  --product-key exact-product-key
```

The generated JSON and Markdown explicitly record `approvalGranted=false`, zero
external writes, the bundle SHA-256, product identity, sellable SKUs, prices,
GTINs and expected hidden-draft shape.

Upload the bundle as the inspectable issue artifact. Board approval must cite
the bundle SHA-256, one `productKey`, the issue identifier, document key and
revision. Any content or media change creates a new bundle hash and approval.

## 4. Disabled smoke and canary

Mount only that bundle directory at `/data/product-draft:ro`. Configure dedicated
revocable WooCommerce REST credentials and a dedicated WordPress Application
Password for product media. Keep both connector write modes disabled while
reconciling the exact twelve-tool catalog and confirming Ecommerce alone has the
three product-draft tools.

First call the two read tools and compare the returned bundle hash. Then enable
only `PRODUCT_PUBLISH_WRITE_MODE=woo-drafts`, restart the single connector
writer and request `woocommerce_create_product_draft` with a stable idempotency
key. Approve only the exact arguments in Paperclip.

The connector must check absence of the parent SKU and every child SKU, upload
the reviewed WebP bytes, create a simple or variable hidden parent draft with no
stock, create variable children as private, and read back every created object.
Inspect the draft manually before any later publication decision. This workflow
never publishes the draft.

If the journal records `uncertain`, do not retry. This includes a variable plan
where the parent or only some children were created. The error identifies the
parent and known child IDs without exposing provider bodies. An operator first
checks Woo and WordPress, then reconciles the journal as `applied` or
`not-applied`. Media uploaded before a failed product call may be orphaned;
record it for separate operator cleanup because the connector intentionally has
no delete tool.

After the canary, return `PRODUCT_PUBLISH_WRITE_MODE` to `disabled`, restart the
connector and retain the bundle, approval, journal and readback as evidence.
