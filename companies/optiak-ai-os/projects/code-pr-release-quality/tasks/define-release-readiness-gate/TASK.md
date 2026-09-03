---
slug: define-release-readiness-gate
name: Define the release-readiness gate
assignee: engineering-assurance-lead
project: code-pr-release-quality
---

Exercise `optiak-release-readiness` with fixtures and define which product, architecture, review, QA, UI, docs, security, observability, rollout, rollback, and support evidence is required by change class.

For the Optiak AI OS control plane, maintain the provider-neutral promotion
contract, evidence evaluator, complete-backup definition, preproduction path,
paused import, per-agent activation, routine-specific approval, and rollback
rehearsal in `runbooks/promotion.md`.

Done when missing evidence cannot become a pass and the gate clearly separates readiness advice from the human release action.
