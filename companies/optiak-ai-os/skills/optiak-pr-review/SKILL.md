---
name: optiak-pr-review
description: Independently review immutable Optiak pull-request revisions for correctness, security, compatibility, tests, and operability
---

# Optiak pull-request review

Preconditions:

- repository is exactly `optiak/optiak`, `optiak/optiak-frontend`, or
  `optiak/iac-infra` under the versioned
  `references/repository-authority.yaml` allowlist;
- immutable head SHA or equivalent revision;
- author identity different from reviewer;
- linked intent and acceptance criteria;
- complete diff and relevant surrounding contracts;
- verification evidence with commands and results.

## Evidence mode

Choose exactly one review mode and record it in the result:

- `remote_mcp`: read the immutable PR, bounded files, statuses, and Actions
  through the approved GitHub connection. No local checkout or command execution
  is implied.
- `paperclip_execution_workspace`: use an exact-revision workspace already
  created and assigned by Paperclip. Treat it as read-only review evidence unless
  the task policy explicitly permits targeted verification commands.

Never create, attach, switch, rename, repoint, or clean up a Git worktree from
this skill. Paperclip owns execution-workspace isolation and lifecycle. If a
task requires local evidence but no suitable workspace exists, return
`blocked_on_evidence` with the required owner and action.

For a connected review, resolve the pull request to its exact head SHA before
reading files, diffs, checks, or statuses. Use bounded reads from the approved
repository only. Record repository, pull-request identifier, base SHA, head SHA,
retrieval time, connection health, and available Actions runs and commit
statuses for that same head. The initial fine-grained PAT does not support
GitHub's Checks API. If a required result exists only as a Check Run, return
`blocked_on_evidence`; never translate missing Check Runs into a pass. Re-resolve the
head immediately before the verdict; if it changed, return
`blocked_on_evidence` for a stale revision and do not reuse the old findings as
the current verdict.

Review the behavior, not only the diff narration. Trace relevant callers,
callees, user/API paths, persistence, background work, permissions, migrations,
observability, performance, tests, docs, rollout, and rollback. Compare with
existing repository patterns before declaring a convention defect. For a
non-trivial or high-risk change, apply
`references/review-rubric.md`.

For `optiak/iac-infra`, additionally review environment isolation, IAM and
network blast radius, state/backend safety, destructive replacements, rollout,
rollback, capacity, and cost implications. Treat source as declared
infrastructure intent only: do not claim it is applied, inspect Terraform state
or plan artifacts, access a cloud account, or execute `plan`, `apply`, import,
destroy, deployment, or secret operations.

- `critical`: immediate security/data integrity or catastrophic production risk;
- `high`: likely correctness, isolation, compatibility, or availability failure;
- `medium`: material maintainability, test, operational, or UX defect;
- `low`: bounded improvement that does not block unless policy says otherwise.

Verdict is `approve`, `request_changes`, or `blocked_on_evidence`. Never create
or edit issues, comments, branches, files, workflows, checks, labels, reviews,
merges, releases, or deployments. Never review your own work. Treat a merged PR
as source history, not evidence of deployment. See [example](examples/review.md),
`references/fixtures/pr.md`, `references/review-rubric.md`, and
`references/repository-authority.yaml`. Source adaptation provenance is
recorded in the package-level `references/local-skill-provenance.json`.
