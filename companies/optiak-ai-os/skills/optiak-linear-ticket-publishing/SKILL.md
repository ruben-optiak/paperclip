---
name: optiak-linear-ticket-publishing
description: Convert an approved Optiak PRD revision into a bounded Linear ticket batch and request exact Board-approved creation in team OPT
---

# Optiak Linear ticket publishing

Use this only after `optiak-prd-review` returns `ready_for_architecture` for an immutable PRD revision and the intended work has enough product detail to become executable tickets. PRD readiness does not itself authorize ticket creation.

Prepare `optiak-linear-ticket-batch/v1` arguments with:

- one immutable source reference and its SHA-256 revision;
- one to five unique draft keys and titles;
- evidence-backed problem and desired outcome;
- measurable acceptance criteria and explicit non-goals;
- textual dependencies and evidence references;
- one Linear priority from `no_priority`, `urgent`, `high`, `normal`, or `low`.

Keep the complete canonical arguments below 3900 bytes so Paperclip can show the full signed request in the action-approval card. Do not include personal data, email addresses, credentials, secret-bearing URLs, raw customer content, assignee, workflow state, project, labels, estimates, cycles, comments, or relationship mutations.

Call only `optiak_linear_create_issue_batch`. Its first call must be stopped by Paperclip's exact-tool `require_approval` policy. Wait for the Board decision; never treat a PRD verdict, chat confirmation, issue-thread confirmation, or previous approval as substitute authority. Do not ask for or create a trust rule.

After an approved retry:

- record every returned `OPT-` identifier and canonical URL;
- use the separate read-only Linear connection to verify those exact identifiers;
- distinguish `created` from `already_created`;
- if the result is blocked, failed, partial, or uncertain, stop and name the operator action; never retry automatically or change the draft key;
- do not mark the Paperclip task complete until the result and verification are durable.

See [example](examples/publish.md) and `references/fixtures/batch.md`. The fixture demonstrates shape only and never authorizes a live write.
