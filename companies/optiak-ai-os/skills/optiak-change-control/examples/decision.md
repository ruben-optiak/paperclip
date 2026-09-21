# Example decision

Action: create a synthetic application in a dedicated staging tenant.

- Classification: Yellow.
- Evidence: tenant identity and test-data marker recorded.
- Preconditions: staging allowlist, bounded application name, cleanup owner, no provider credential mutation.
- Decision: prepare the request; do not execute until the Board-approved staging profile exists.
- Abort: any production hostname, real customer identifier, or unreviewed tool catalog.

Engineering routing:

- Lead: QA & E2E Validation Engineer, because the question is observable product behavior.
- Consulted: none until a reproducible failure needs technical diagnosis.
- Canonical output: one executable test report.
- Handoff: Senior Platform Engineer receives only the failing case, evidence references and the root-cause question; QA does not speculate about the fix.

Documentation-only routing:

- Lead: Documentation & DX Steward, because the question concerns one exact public claim.
- Consulted: Senior Platform Engineer only for the narrower immutable API-contract comparison.
- Canonical output: one documentation drift report.
- Excluded: Product reprioritization, executable QA, source-code review and publication.
- Handoff: the implementation owner receives the mismatched claim and authority reference, not a duplicate full documentation review.
