---
name: optiak-product-triage
description: Turn Optiak ideas and findings into evidence-backed product decisions and prioritized next actions
---

# Optiak product triage

Before making any live claim about priority, ownership, schedule, duplication, or
backlog status, read `references/product-authority.yaml` and apply its authority,
freshness, conflict, and retention rules. Linear team `OPT` is authoritative only
for the operational backlog fields named there, and only after the managed
read-only connection returns a healthy, fresh result.

A source declaring `semanticReviewAvailable: false` exposes metadata only.
Report the observed fields and the missing evidence; do not infer a ticket's
problem, duplicates, business priority or acceptance criteria from its identifier
or workflow state. A projection's timestamp or successful filter is not proof of
live evidence. Request an approved content source instead of bypassing the filter
or fetching raw text. The offline privacy candidate is not an installed connection.

For every input:

1. Identify source, date, affected persona, environment, and whether it is evidence, hypothesis, preference, or constraint.
2. State the user or platform problem without prescribing a solution.
3. Check alignment with Optiak's platform-layer boundary.
4. Assess impact, urgency, confidence, reach, strategic alignment, risk reduction, effort uncertainty, and dependency risk.
5. Detect duplicates and relationships only against an authorized current backlog. Cite the Linear identifier, canonical URL, source update time when available, and retrieval time.
6. Choose one disposition: reject, needs discovery, candidate, scheduled, urgent defect, or Board decision.
7. Produce acceptance criteria and the next owner when the item advances.

Never copy the whole backlog, expand pagination without a task-bounded reason, or
invoke Linear create, update, comment, assignment, archive, or administrative
tools. A Linear issue marked done is not release evidence, and a Linear issue
count is not customer-demand evidence. If the connection is unhealthy, the result
is older than 15 minutes, or the requested item is outside team `OPT`, report the
source as unavailable instead of guessing.

Do not fabricate demand, metrics, duplicates, or roadmap state when sources are disconnected. Numerical scoring is a comparison aid, never invented precision. See [example](examples/triage.md), `references/fixtures/items.md`, and `references/fixtures/authority-conflicts.md`.

For an initial connected review, use at most two `list_issues` calls of five
results (started/unstarted, newest `updatedAt`, team OPT, archived excluded),
no cursor expansion, and three exact `get_issue` calls from that sample. Omit
assignee fields from list projections; do not request customer needs or releases.
Get detail only when it affects a decision: the provider's detail response may
include incidental identity fields and Paperclip may retain them in its audit.
Do not copy them into the report. A task may narrow this scope further, not widen
it without a separately approved query contract.

Return observed state separately from proposals; never call the sample a global
priority ranking. Close through the assigned `optiak-durable-completion` helper
using its `optiak-product-sample/v1` per-item ledger. Operator preflight and fresh
gateway evidence determine connection availability; portable `pending` defaults
do not override verified instance evidence or authorize a disconnected source.
