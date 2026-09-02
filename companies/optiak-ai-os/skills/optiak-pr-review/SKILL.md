---
name: optiak-pr-review
description: Independently review immutable Optiak pull-request revisions for correctness, security, compatibility, tests, and operability
---

# Optiak pull-request review

Preconditions:

- repository is exactly `optiak/optiak` or `optiak/optiak-frontend` under the
  versioned `references/repository-authority.yaml` allowlist;
- immutable head SHA or equivalent revision;
- author identity different from reviewer;
- linked intent and acceptance criteria;
- complete diff and relevant surrounding contracts;
- verification evidence with commands and results.

For a connected review, resolve the pull request to its exact head SHA before
reading files, diffs, checks, or statuses. Use bounded reads from the approved
repository only. Record repository, pull-request identifier, base SHA, head SHA,
retrieval time, connection health, and checks for that same head. Re-resolve the
head immediately before the verdict; if it changed, return
`blocked_on_evidence` for a stale revision and do not reuse the old findings as
the current verdict.

Review correctness, authorization, tenant isolation, secret handling, API compatibility, error and concurrency paths, migrations, observability, performance, test quality, docs, rollout, and rollback. Findings use:

- `critical`: immediate security/data integrity or catastrophic production risk;
- `high`: likely correctness, isolation, compatibility, or availability failure;
- `medium`: material maintainability, test, operational, or UX defect;
- `low`: bounded improvement that does not block unless policy says otherwise.

Verdict is `approve`, `request_changes`, or `blocked_on_evidence`. Never create
or edit issues, comments, branches, files, workflows, checks, labels, reviews,
merges, releases, or deployments. Never review your own work. Treat a merged PR
as source history, not evidence of deployment. See [example](examples/review.md),
`references/fixtures/pr.md`, and `references/repository-authority.yaml`.
