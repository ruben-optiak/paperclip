---
name: optiak-docs-drift
description: Detect evidence-backed drift across Optiak public documentation, product behavior, API contracts, examples, and positioning
---

# Optiak documentation drift

For each bounded review, record URL, retrieval timestamp, heading/anchor, exact claim summarized without excessive quotation, audience, and freshness.

Compare against the strongest available authority:

1. approved product decision or versioned API contract;
2. released behavior in an identified environment/version;
3. immutable code or generated schema;
4. another public page;
5. fixture or hypothesis, clearly labelled non-authoritative.

Check terminology, navigation, prerequisites, authentication, endpoint/schema examples, error behavior, permissions, lifecycle, feature availability, deprecations, positioning, and links. Classify as confirmed drift, likely drift, internally inconsistent, stale-risk, or blocked on authority.

Do not duplicate the whole docs site or publish changes. See [example](examples/drift.md) and `fixtures/claims.json`.
