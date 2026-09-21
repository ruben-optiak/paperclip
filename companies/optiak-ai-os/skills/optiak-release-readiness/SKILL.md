---
name: optiak-release-readiness
description: Aggregate independent product, architecture, code, QA, UI, docs, security, operational, rollout, and rollback evidence for an Optiak release decision
---

# Optiak release readiness

Evaluate an immutable release candidate. Required gates are proportional to changed surfaces but must be explicit:

- approved intent and acceptance criteria;
- architecture decision where needed;
- independent code review;
- focused tests and relevant regression suite;
- API compatibility and migration evidence;
- UI, accessibility, and golden-journey evidence;
- documentation and developer-experience impact;
- security, tenancy, privacy, secret, cost, and governance review;
- observability, alerts, dashboards, support/runbook impact;
- staged rollout, abort signals, rollback, data repair, and owner coverage.

Return `ready`, `ready_with_board_accepted_risk`, `not_ready`, or `blocked_on_evidence`. Missing evidence is never converted into a pass. This skill does not deploy or approve release actions. See [example](examples/verdict.md) and `references/fixtures/release.md`.

For promotion of Optiak AI OS itself, apply
`references/ai-os-promotion-contract.json` and the evaluator in
`scripts/evaluate-promotion-readiness.mjs`. Keep that decision separate from an
Optiak product release. A direct local-to-production path is denied; the same
immutable package and Paperclip image candidate must pass preproduction first.
Database-only backup evidence is incomplete because artifacts, workspaces, and
secret-provider recovery material live outside the database.

The promotion evaluator may return `ready_for_board_decision`; that value is
advice only and never deploys, imports, activates, or approves. See
`references/fixtures/promotion.md` for gate-complete fixture-only, missing,
failed, and direct-to-production cases; fixture-only evidence remains blocked.
