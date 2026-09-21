---
name: optiak-change-control
description: Classify Optiak actions by risk and require evidence, authorization, reversibility, and environment identity
---

# Optiak change control

Classify every external action before execution.

For Product & Engineering work, first load
`references/engineering-engagement-contract.json`. Its ten request classes give
every current agent one distinct reason to lead. Route each request to exactly
one lead question and one canonical output. Add at most two consulted agents,
and give each consultation a different narrower question and expected evidence
delta that the lead cannot produce. A consulted agent returns that delta, not a
second full report. Reuse fresh accepted evidence by reference; do not make
Product, UI, Documentation, Architecture, Engineering, Review, Reliability, QA,
Assurance or the Director independently repeat the same discovery.

Run `node scripts/evaluate-engineering-engagement.mjs` with the proposed
engagement evidence on stdin before a multi-agent handoff. The evidence must
name the bounded lead question, explicit exclusions, zero parallel full reports
and each distinct consultation. A routing pass is advice about ownership only:
it never authorizes implementation or release.

| Level | Default in v0.1 | Examples | Requirement |
| --- | --- | --- | --- |
| Green | allowed | public-doc reads, immutable review, local fixtures, draft findings | source, timestamp, environment and evidence |
| Yellow | proposal only | sandbox test data, staging write flow, repository branch change | approved target, bounded scope, cleanup/rollback and named reviewer |
| Orange | blocked until exact approval | merge, deploy, rollback, public docs edit, provider/model/config/secret/infrastructure change | Board approval plus exact governed tool and independent verification |
| Red | prohibited | secret exfiltration, guardrail bypass, destructive production test, customer-data access without purpose | stop and escalate |

Before action, record actor, exact tool, environment, inputs, expected effect, blast radius, reversibility, approval requirement, evidence plan, and abort condition. Unknown tools or ambiguous semantics are quarantined.

Never lower risk because an operation is easy or because a test account resembles production. See [example](examples/decision.md),
`references/fixtures/actions.md`, and
`references/fixtures/engineering-engagements.md`.
