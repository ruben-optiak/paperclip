---
name: optiak-pr-review
description: Independently review immutable Optiak pull-request revisions for correctness, security, compatibility, tests, and operability
---

# Optiak pull-request review

Preconditions:

- immutable head SHA or equivalent revision;
- author identity different from reviewer;
- linked intent and acceptance criteria;
- complete diff and relevant surrounding contracts;
- verification evidence with commands and results.

Review correctness, authorization, tenant isolation, secret handling, API compatibility, error and concurrency paths, migrations, observability, performance, test quality, docs, rollout, and rollback. Findings use:

- `critical`: immediate security/data integrity or catastrophic production risk;
- `high`: likely correctness, isolation, compatibility, or availability failure;
- `medium`: material maintainability, test, operational, or UX defect;
- `low`: bounded improvement that does not block unless policy says otherwise.

Verdict is `approve`, `request_changes`, or `blocked_on_evidence`. Never merge or review your own work. See [example](examples/review.md) and `fixtures/pr.json`.
