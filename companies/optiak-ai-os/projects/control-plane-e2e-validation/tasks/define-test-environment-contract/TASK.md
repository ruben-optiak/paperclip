---
slug: define-test-environment-contract
name: Define the test-environment and data contract
assignee: qa-e2e-validation-engineer
project: control-plane-e2e-validation
---

Define allowed local and staging targets, production denial, tenant identity, personas, synthetic naming, provider budget, secret handling, mutation classes, cleanup, evidence retention, reset, and abort conditions.

Persist the contract in
`optiak-e2e-validation/references/test-environment-contract.json`. Completing
this task defines the boundary; it does not approve a target or complete the
connected smoke.

Done when a tester cannot confuse local, staging, and production; every sandbox
write has a bounded lifecycle and owner; and missing target prerequisites fail
closed.
