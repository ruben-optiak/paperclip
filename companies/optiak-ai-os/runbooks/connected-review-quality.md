# Connected review quality gates

These controls refine the existing read-only Product workflow. They do not
connect GitHub, activate routines, change provider permissions or enable writes.
Runtime IDs and credentials remain outside Git. A portable package's pending
connection defaults are not a live health assessment.

## 1. Operator preflight

Before a connected run, execute `scripts/linear-preflight.mjs --live` with:

| Variable | Meaning |
| --- | --- |
| `OPTIAK_PAPERCLIP_URL` | Exact approved instance API base |
| `OPTIAK_BOARD_TOKEN` | Board credential supplied only to this operator process |
| `OPTIAK_COMPANY_ID` | Optiak company in that instance |
| `OPTIAK_LINEAR_CONNECTION_ID` | Existing managed read-only connection |
| `OPTIAK_PRODUCT_AGENT_ID` | Product in that company |

Obtain these from the existing CLI authentication and instance metadata in
process memory, not by pasting values into commands, issues or files. The helper
does not read the operator's auth file implicitly. Do not pass its credential
to an agent. Without `--live`, the script evaluates a supplied JSON fixture.

The preflight checks both endpoint projections, both `quarantineNewEntries`
flags, health/catalog freshness, installation scope, deny-default profile,
effective access for every company agent and the reviewed catalog fingerprints
in `policies/linear-catalog-baseline.json`. Its output contains counts and
diagnostic codes, not credentials, profile IDs, user identities or ticket bodies.

It refuses to read the catalog if auto-inclusion is enabled: a GET can refresh
the provider catalog and should not extend permissions. It performs no writes,
provider tool calls or health refresh. A stale health check is a blocker, not
proof that OAuth is broken. Refresh health through the normal reviewed operator
workflow, then repeat the metadata preflight. Never auto-approve a new hash to
make a preflight pass. New and changed tools stay denied pending human review.

The 38-entry baseline preserves the existing reviewed surface; it is not a
recommendation to call all 38 tools. Product's current task uses only bounded
issue reads. Team OPT scoping is an agent/task constraint, not a provider-enforced
tenant filter, and this preflight does not prove credential revocation.

## 2. Run and close once

Keep the ten agents and all schedule triggers paused until a bounded manual
test is explicitly selected. Resume just its agent and assign once; do not
combine assignment with another manual invoke. Apply the existing 300-second
ceiling and pause the agent after the terminal run. No retries by default.

The installed durable-completion skill carries executable helpers. Validate
structured report fields in memory, bind them to the current run/task, persist
one combined disposition/report update and verify the readback. Invalid enums,
stale sources, unsupported per-item dispositions or mismatched provenance are
not fixable by repeating a raw API call. See the skill's completion-helper
reference. Generic validation is not factual verification of claims.

## 3. Operator QA without reopening

Do not POST a normal comment to a completed agent task just to annotate it:
the comment route may request continuation and recovery can mark a paused
assignee's task blocked. `reopen: false` is not a general no-wake guarantee.

Use `scripts/record-qa-note.mjs --submit`. It takes `reportId` and Markdown
`body` via JSON stdin, and `OPTIAK_PAPERCLIP_URL`, `OPTIAK_BOARD_TOKEN`,
`OPTIAK_COMPANY_ID`, `OPTIAK_ISSUE_ID` from the operator environment. It requires
a done, idle, same-company issue and an existing run-linked agent comment.

The helper creates one new content-addressed `qa-*` issue document, never edits
an existing review/approval target, never posts a comment, and never changes
status, assignee or agent state. Repeating identical input returns the existing
document. It verifies disposition, assignment, active runs and comment count
afterwards; unexpected behavior is reported, not repaired automatically.
Open the document from the task's Documents section or the returned document key.
The note links the original report and is not a second canonical analysis.

## Limits and rollout proof

- JSON/field allowlists minimize the returned ledger and operator preflight.
  They do **not** redact Paperclip's previously persisted raw MCP audit results.
  `get_issue` may return creator/assignee identities even without customer needs;
  use exact details sparingly. Raw audit minimization needs its own scoped fix.
  The offline candidate in `connectors/linear-privacy/README.md` now projects
  metadata before the gateway boundary. It is not connected or active and
  deliberately excludes the narrative required for semantic Product triage.
- Hash baselines detect declared catalog drift, not an unannounced provider
  behavior change. Read-only credentials and the provider endpoint remain
  necessary boundaries.
- A single-writer completion helper is not a server-side exactly-once guarantee.
  Do not launch concurrent writers or parallel completions for one run.
- Unit tests prove helper behavior. Confirm an import preview, imported script
  content, one fixture-only agent completion and a duplicate no-wake QA note
  before treating the installed workflow as verified.
- Do not disable Git signing to bypass an unavailable signing agent; uncommitted
  work can be validated and tested locally but is not a production candidate/tag.
