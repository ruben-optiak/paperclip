# Public web functional and performance baseline

`EAI-027` uses `references/web/public-web-baseline-v1.json` as the pinned,
read-only test contract. It covers the homepage, a category, one current public
product and the purchase-help page. The product was selected from the public
Woo Store API on 2026-09-03; replacing it requires a reviewed config change.

Run from the repository root on macOS:

```sh
node companies/enki-hogar-ai-os/scripts/web/run-public-web-baseline.mjs
```

The command uses Playwright's managed Chromium by default. Set
`ENKI_CHROME_PATH=/absolute/path/to/chrome` only when that browser is absent.
The run launches a fresh headless context, blocks every method except GET/HEAD, never clicks or
submits a form, disables service workers and retains neither bodies, cookies,
screenshots nor user-agent strings. A purchase smoke proves only that the
product page exposes a purchase control; it never adds an item to a cart.

The JSON result separates required functional signals from lab budgets for
TTFB, FCP, LCP, CLS, load and encoded bytes. Missing metrics are failures, not
zeros. A budget breach is a reproducible finding for review and grants no
optimization or publication authority.

This browser harness does **not** emit a Lighthouse score. Its Web Vitals and
navigation timings are useful lab evidence, but must not be relabelled as
Lighthouse. The pinned auxiliary audit is reproducible with:

```sh
CHROME_PATH=/absolute/path/to/chrome \
  pnpm dlx lighthouse@13.4.1 https://www.enkihogar.com/ \
  --output=json --output-path=/tmp/enki-lighthouse.json \
  --only-categories=performance,seo,best-practices,accessibility \
  --chrome-flags="--headless --no-sandbox" --quiet
```

Retain only the summary fields represented by
`references/web/snapshots/eai-027-lighthouse-home-2026-09-03.json`; discard the
raw report because it contains page bodies, screenshots and request details.
The initial mobile result scored performance 0.62, accessibility 0.86,
best-practices 1.00 and SEO 1.00. FCP was 2.94 s and LCP 6.27 s, both outside
the explicit browser-harness budgets. The read-only browser snapshot also
found the selected category `noindex` without canonical and slow category and
product TTFB/FCP. These are findings for a future governed change, not an
instruction to alter the live site.
