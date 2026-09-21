---
slug: staging-golden-journey-smoke
name: Staging golden-journey smoke
assignee: qa-e2e-validation-engineer
project: control-plane-e2e-validation
recurring: true
---

Run the approved minimal staging journey set against an identified version and synthetic tenant. Record pass/fail/blocked/not-tested per case, evidence, cleanup, new regressions, and owner.

Use `optiak-e2e-validation/references/test-environment-contract.json` and
`optiak-e2e-validation/references/golden-journey-matrix.json`. Local evidence
cannot satisfy this staging task.

The schedule stays paused until staging identity, browser/API access, synthetic data, cleanup, tool policy, provider budget, production denial, and a manual smoke run are approved.
