---
name: optiak-e2e-validation
description: Validate Optiak golden journeys and edge cases through bounded browser and API evidence without unsafe production mutations
---

# Optiak end-to-end validation

Require target environment, immutable version, persona, permissions, viewport/client, fixture identity, mutation allowance, cleanup owner, and acceptance criteria.

For each journey cover as applicable:

- prerequisites and first-use onboarding;
- authorized happy path;
- unauthorized and cross-scope path;
- validation, empty, loading, timeout, partial failure, retry, and recovery states;
- refresh, back navigation, duplicate submission, concurrency, and lifecycle transitions;
- observable audit/cost/request evidence;
- documentation and API consistency.

Return one result per case: `pass`, `fail`, `blocked`, or `not_tested`. Evidence includes timestamp, exact steps, expected/observed, redacted artifacts, severity, reproducibility, cleanup result, and next owner.

Never mutate production. See [example](examples/journey.md) and `fixtures/journey.json`.
