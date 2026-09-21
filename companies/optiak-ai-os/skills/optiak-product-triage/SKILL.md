---
name: optiak-product-triage
description: Turn Optiak ideas and findings into evidence-backed product decisions and prioritized next actions
---

# Optiak product triage

Before making any live claim about priority, ownership, schedule, duplication, or
backlog status, read `references/product-authority.yaml` and
`references/product-advisory-contract.json`. Apply their authority, freshness,
selection, evidence-depth, output, and efficiency rules. Linear team `OPT` is
authoritative only for the operational backlog fields named there, and only after
the managed read-only connection returns a healthy, fresh result.

A source declaring `semanticReviewAvailable: false` exposes metadata only.
Report the observed fields and the missing evidence; do not infer a ticket's
problem, duplicates, business priority or acceptance criteria from its identifier
or workflow state. A projection's timestamp or successful filter is not proof of
live evidence. Request an approved content source instead of bypassing the filter
or fetching raw text. The offline privacy candidate is not an installed connection.

First classify the request as one of:

- `freshness_scan` or `backlog_hygiene_scan`: may use a bounded `updatedAt`
  sample, but cannot claim a global priority or roadmap sequence;
- `priority_ranking`, `roadmap_sequence`, or `strategy_recommendation`: requires
  an exact current Board decision or approved intent reference before reading
  the backlog. If it is unavailable, return `blocked_on_strategy` or narrow the
  work to evidence gaps; never substitute ticket recency for strategy.

For every input:

1. Identify source, date, affected persona, environment, and whether it is evidence, hypothesis, preference, or constraint.
2. State the user or platform problem without prescribing a solution.
3. Check alignment with Optiak's platform-layer boundary.
4. Assess impact, urgency, confidence, reach, strategic alignment, risk reduction, effort uncertainty, and dependency risk only to the extent supported by the approved sources.
5. Detect duplicates and relationships only against an authorized current backlog. Cite the Linear identifier, canonical URL, source update time when available, and retrieval time.
6. Choose one disposition: reject, needs discovery, candidate, scheduled, urgent defect, or Board decision.
7. Read an exact ticket in detail before including it in a recommendation. A
   list-only item may be recorded as `needs_detail_read`, but it cannot be one of
   the final recommendations.
8. Treat acceptance criteria as draft questions until an accepted PRD revision
   supplies authority. Do not silently turn a ticket description into an
   architecture decision.
9. Produce at most three actionable recommendations and three Board decisions.

Never copy the whole backlog, expand pagination without a task-bounded reason, or
invoke Linear create, update, comment, assignment, archive, or administrative
tools during triage. If an immutable PRD is ready and the Board wants tickets,
finish triage and switch to the separately assigned
`optiak-linear-ticket-publishing` contract; do not use the read connection for
that write. A Linear issue marked done is not release evidence, and a Linear issue
count is not customer-demand evidence. If the connection is unhealthy, the result
is older than 15 minutes, or the requested item is outside team `OPT`, report the
source as unavailable instead of guessing.

Do not fabricate demand, metrics, duplicates, or roadmap state when sources are
disconnected. Numerical scoring is a comparison aid, never invented precision.
See [example](examples/triage.md), `references/fixtures/items.md`,
`references/fixtures/authority-conflicts.md`,
`references/fixtures/advisory-cases.md`, and
`references/fixtures/opt-39-feedback.md`.

For a connected review, use no more than two `list_issues` calls of five results,
no cursor expansion, three exact `get_issue` calls, and six provider calls total.
Select through an approved goal, dependency chain, explicit Board question, or
risk signal. A newest-`updatedAt` sample is allowed only for freshness or hygiene
and must say that it is not a priority ranking. Omit assignee fields from list
projections; do not request customer needs or releases. The provider's detail
response may include incidental identity fields and Paperclip may retain them in
its audit. Do not copy them into the report. A task may narrow this scope further,
not widen it without a separately approved query contract.

Return a decision memo of at most 700 words:

1. An executive summary of at most five lines.
2. Separate `Observed facts`, `Hypotheses`, and `Missing evidence` sections.
3. At most three recommendations with source, observed state, proposal, reason,
   confidence, missing evidence, and next owner.
4. At most three Board decisions with recommendation and tradeoff.

Keep the machine envelope separate from the human memo. Close through the
assigned `optiak-durable-completion` helper using its
`optiak-product-sample/v1` per-item ledger. Before persistence, run the evidence
object through `scripts/evaluate-product-advisory.mjs`; only
`ready_for_board_review` is review-ready. A blocked or efficiency result is still
a valid bounded diagnosis, not permission to expand the sample or retry.

Target at most 25,000 uncached input tokens, 4,000 output tokens, and 180 seconds.
More than 40,000 uncached input tokens, 6,000 output tokens, or 240 seconds is an
`efficiency_regression`. These are review gates rather than native in-flight
limits: stop context expansion early, finish with explicit gaps, and never retry
automatically. Operator preflight and fresh gateway evidence determine connection
availability; portable `pending` defaults do not override verified instance
evidence or authorize a disconnected source.
