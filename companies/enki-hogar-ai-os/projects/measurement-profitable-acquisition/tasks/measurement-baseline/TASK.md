---
slug: measurement-baseline
name: Levantar baseline de medición
assignee: growth-manager
project: measurement-profitable-acquisition
---

Reproduce the closed-period GA4/GSC/Woo reconciliation in `runbooks/measurement-baseline.md`. Preserve canonical evidence envelopes during execution and retain only the sanitized aggregate receipt. Treat GSC visibility and GA4 traffic as scoped measures, Woo as the commercial aggregate, and GA4 purchases/revenue as unusable commercial truth until the observed mismatch is resolved. Consent status remains unknown without a governed diagnostic source. Escalate an exact read-only tagging/consent diagnosis to Technology; do not change analytics, tags, consent, campaigns or the site.
