---
name: optiak-prd-review
description: Review Optiak PRDs for evidence, boundaries, acceptance criteria, dependencies, failure modes, and decision readiness
---

# Optiak PRD review

Review the exact PRD revision and report:

- problem, evidence, target persona, desired outcome, and non-goals;
- alignment with Optiak's platform-layer positioning;
- terminology and organization/application/provider ownership;
- functional, permission, lifecycle, error, empty, loading, recovery, and accessibility behavior;
- API, UI, docs, observability, billing, security, migration, and support impact;
- measurable acceptance criteria and explicit exclusions;
- unresolved decisions, dependencies, rollout, rollback, and evidence plan.

Verdicts are `ready_for_architecture`, `changes_required`, or `blocked_on_evidence`. Do not convert ambiguous product intent into engineering assumptions. See [example](examples/review.md) and `fixtures/prd.json`.
