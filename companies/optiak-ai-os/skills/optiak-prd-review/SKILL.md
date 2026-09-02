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

Object verdicts are `ready_for_architecture`, `changes_required`, or `blocked_on_evidence`. Do not convert ambiguous product intent into engineering assumptions. In the common result envelope use `reviewKind: prd_review` and `verdictVocabulary: optiak-prd-review/v1`; keep Paperclip issue disposition and operational readiness separate. A missing prerequisite means the object was `not_assessed` and must not become the current PRD verdict after a repaired retry. See [example](examples/review.md) and `references/fixtures/prd.md`.
