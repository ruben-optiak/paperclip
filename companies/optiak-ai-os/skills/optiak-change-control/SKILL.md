---
name: optiak-change-control
description: Classify Optiak actions by risk and require evidence, authorization, reversibility, and environment identity
---

# Optiak change control

Classify every external action before execution.

| Level | Default in v0.1 | Examples | Requirement |
| --- | --- | --- | --- |
| Green | allowed | public-doc reads, immutable review, local fixtures, draft findings | source, timestamp, environment and evidence |
| Yellow | proposal only | sandbox test data, staging write flow, repository branch change | approved target, bounded scope, cleanup/rollback and named reviewer |
| Orange | blocked until exact approval | merge, deploy, rollback, public docs edit, provider/model/config/secret/infrastructure change | Board approval plus exact governed tool and independent verification |
| Red | prohibited | secret exfiltration, guardrail bypass, destructive production test, customer-data access without purpose | stop and escalate |

Before action, record actor, exact tool, environment, inputs, expected effect, blast radius, reversibility, approval requirement, evidence plan, and abort condition. Unknown tools or ambiguous semantics are quarantined.

Never lower risk because an operation is easy or because a test account resembles production. See [example](examples/decision.md) and `fixtures/actions.json`.
