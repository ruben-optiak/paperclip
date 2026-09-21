# Ten-agent role review matrix

Use this matrix to review the organization as one system after importing the
same package candidate. It is not authority to activate every agent at once.
Run one controlled case at a time through `scripts/run-agent-role-review.mjs`,
return the agent to `paused`, then compare all ten outputs using the same gates
in `agent-role-review-matrix.json`.

The enforced order is:

`create unassigned → resume one agent → assign → one assignment run → persist ROLE_REVIEW_FINAL and done in that run → inspect → pause`

An assigned-while-paused issue, a second/recovery run, an open issue after the
report, an unbound report, a remaining active run or a non-paused agent is a
failed review. The runner stops; it never repairs the result by invoking the
agent again.

| Agent | Lead class | Canonical output | Primary non-overlap check |
| --- | --- | --- | --- |
| Director | `cross_domain_coordination` | Prioritized decision brief | Routes; does not redo specialist work |
| Product & PRD | `product_intent_or_prd` | Product decision or PRD review | Owns outcome; not architecture or QA |
| Brand/UI | `ui_brand_quality` | Annotated UI quality report | Visual evidence; not functional pass |
| Documentation/DX | `documentation_dx_drift` | Documentation drift report | Public claim; not runtime truth |
| Principal Architect | `architecture_decision` | Architecture decision record | Structural choice; not implementation |
| Senior Platform Engineer | `implementation_diagnosis` | Technical diagnosis | Root-cause path; not repeated QA |
| Independent Reviewer | `immutable_change_review` | Independent review verdict | Exact change; not implementation or release |
| QA/E2E | `product_behavior_validation` | Executable test report | Observed behavior; not root cause |
| Reliability | `live_incident_or_slo_risk` | Incident/reliability brief | Fresh runtime impact; not generic debugging |
| Engineering Assurance | `release_readiness` | Evidence index and risk disposition | Checks completeness; never reruns evidence |

## Common review gates

Every run must pass all ten gates:

1. Correct lead class.
2. One bounded lead question.
3. Only the canonical output.
4. Evidence and freshness are explicit.
5. Excluded work is explicit.
6. No parallel full report.
7. Handoff contains only a distinct evidence delta.
8. No permission or decision-authority overreach.
9. The role stops when its question is answered or blocked.
10. Context and output are proportionate to the decision.

A fixture pass proves the instructions and evaluator are coherent; it does not
prove a live connection, runtime, source, implementation or release capability.
No result activates another agent automatically.

The hardened sequential runner passed its connected-local fixture regression on
2026-09-21: ten exact assignment runs, ten same-run final dispositions, zero
recoveries, zero active runs at completion and all ten agents returned to
`paused`. The durable issue/run evidence remains in OPT-77 through OPT-86; the
negative transport case OPT-76 is intentionally preserved. This status does not
expand the fixture-only evidence boundary.

Validate a saved transcript without mutations:

```sh
node scripts/run-agent-role-review.mjs --evidence evidence.json --pretty
```

The live form is dry-run unless `--execute` is supplied. Use `--agent <slug>`
for one case or `--all` for the sequential matrix; never run multiple instances
of the harness in parallel.
