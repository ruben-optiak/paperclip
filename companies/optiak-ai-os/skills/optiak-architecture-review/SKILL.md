---
name: optiak-architecture-review
description: Review Optiak architecture and RFCs for invariants, boundaries, failure modes, migrations, operations, and long-term cost
---

# Optiak architecture review

Require an immutable proposal revision, problem statement, constraints, and affected contracts. Evaluate:

- system context, data ownership, tenancy, trust and secret boundaries;
- API compatibility and versioning;
- control-plane versus inference data-plane responsibilities;
- failure isolation, retries, idempotency, concurrency, ordering, and partial failure;
- latency, availability, scalability, cost, operability, telemetry, privacy, and auditability;
- migration, backwards compatibility, rollout, rollback, and data repair;
- alternatives, decision drivers, irreversible choices, and exit strategy.

Resolve every material claim through
`references/architecture-authority-map.json`. Record the domain, exact source
revision, source status, freshness, owner, and unavailable behavior. Public
documentation is context, source code is revision-scoped implementation
evidence, and neither proves the deployed state. Preserve conflicts for the
named human owner instead of choosing a convenient source.

Produce `approve`, `approve_with_conditions`, `changes_required`, or `blocked_on_evidence`. A rewrite requires incremental proof and rollback. See [example](examples/review.md) and `references/fixtures/proposal.md`.
Use `references/fixtures/authority-claims.md` to verify authority selection and
fail-closed behavior without live sources.
