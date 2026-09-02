---
name: optiak-durable-completion
description: Close Optiak work exactly once with run-linked evidence, in-memory payloads, verified persistence, and trustworthy time provenance
---

# Optiak durable completion

Use this skill for the final disposition of every Optiak issue. It complements the Paperclip coordination skill; it does not replace checkout, authorization, approval, or status rules.

## Completion contract

1. Finish the requested analysis or deliverable before preparing the final report.
2. Re-read the issue state and this run's comments. If this run already left the intended final report and the issue already has the intended disposition, stop without writing again.
3. Build one concise Markdown report entirely in process memory. Do not create a temporary payload, report, or cleanup file for a control-plane update.
4. Send the report and disposition together in one `PATCH /api/issues/{issueId}` request with one JSON object such as `{ "status": "done", "comment": report }`. Include the current run header required by Paperclip. Do not call the standalone comment endpoint first and do not repeat the report in a later status update.
5. Treat the response as confirmation only when it returns the expected issue status and a persisted comment. Verify that the comment is attributed to the current run through `createdByRunId` when that field is returned.
6. After an empty response, timeout, lost connection, or other ambiguous result, do not blindly replay the write. Re-fetch the issue and its comments first, then reconcile by `createdByRunId` and the intended status:
   - report present and status present: success; write nothing;
   - report absent and status present: add the report once without repeating the status transition;
   - report present and status absent: update only the status;
   - neither present: retry the combined update at most once, following Paperclip's bounded-write rule.
7. Leave `done` for a completed report even when the report's conclusion is partial, failed, unknown, or not verifiable. Use `in_review` or `blocked` only when the corresponding first-class waiting path exists.

Checkout and necessary work-product writes are outside the single-disposition-write count. The invariant is one final report, one intended disposition transition, and no duplicate completion comment from the same run.

## Result integrity

Never collapse workflow completion, report history, reviewed-object verdict, operational readiness, and evidence authority into one status. Every final report must preserve the fields defined in `references/result-taxonomy.md`:

- `paperclip.issueDisposition` describes only the issue workflow;
- `report.state`, `report.purpose`, and `report.canonical` describe this report's place in history;
- `object.verdict` uses the vocabulary of the selected domain skill for the exact revision;
- `operations.readiness` is separate and remains `not_assessed` unless its gate ran;
- `evidence.scope` and `evidence.prerequisiteState` state what could actually be assessed.

Do not use an unqualified `done`, `complete`, `PASS`, `blocked`, or `ready` as the overall result. A final issue comment may render the envelope as a compact labelled list instead of JSON, but the qualified field names and exact values must remain visible.

At most one report from a run can be canonical, and at most one report can be canonical for `(object.type, object.revision, object.reviewKind)`. Preserve prerequisite diagnostics and recovery messages as history. When a valid retry supersedes them, point them to the new report; never delete or silently reinterpret them.

## Time provenance

- Paperclip's persisted `comment.createdAt`, issue status timestamps, and run timestamps are authoritative for when control-plane actions occurred.
- Do not invent, round, predict, or manually restate an execution timestamp in the report. Normally say that execution time is recorded in Paperclip metadata, or omit it.
- A timestamp from a fixture, document, log, HTTP response, or monitoring system describes that evidence only. Name the source and timezone beside it; never present it as the current time.
- If a required time cannot be obtained from an approved source, write `unknown` and name the source needed to resolve it.
- Relative claims such as “today”, “current”, “latest”, or “fresh” require a sourced comparison timestamp and an explicit timezone.

## Context discipline

- Start from the current issue, wake payload, and comments created by the current run. Do not load unrelated company history by default.
- For multi-report synthesis, work from a bounded source manifest. Fetch a complete thread only to verify a material claim, provenance gap, ambiguity, or contradiction.
- Read each selected source once and retain a compact ledger of authority, freshness, and scope. Do not repeat broad searches merely to restate already captured evidence.
- Never create a second source of truth just to shorten context. A compact index may point to canonical reports, but it must preserve their provenance and freshness.
- Keep the final report concise without removing negative evidence, unknowns, safety gates, or approval requirements.
- Do not query token usage from inside the working run. Paperclip records final usage after completion; the operator evaluates it against `policies/execution-budget.yaml`.

## Safe transport

Prefer a structured Paperclip tool or direct API client that accepts an in-memory object. If the CLI is used, follow the Paperclip skill's content-argument rules and pass a shell variable directly to `npx paperclipai`; never interpolate model output into `pnpm paperclipai` and never persist the payload solely to make the command easier to quote.

Never paste bearer tokens, environment secrets, or bridge URLs into the report. Never infer success from an exit code with an empty body or from a piped/truncated response.

Use [the completion example](examples/completion.md), [the qualified result example](examples/result-envelope.md), and the portable fixtures at `references/fixtures/completion.md` and `references/fixtures/result-set.md`.
