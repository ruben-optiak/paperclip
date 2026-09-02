---
name: optiak-e2e-validation
description: Validate Optiak golden journeys and edge cases through bounded browser and API evidence without unsafe production mutations
---

# Optiak end-to-end validation

Load `references/test-environment-contract.json` and
`references/golden-journey-matrix.json` before any connected test. The contract
is the safety boundary; the matrix is test scope, not evidence that any case
passed.

Require target environment, immutable version, persona, permissions,
viewport/client, fixture identity, mutation allowance, cleanup owner, and
acceptance criteria. Re-probe the target immediately before every run. A saved
health result, source branch name, public-doc claim, fixture, or old screenshot
is never current runtime evidence.

Use one of three explicit modes:

- `fixture`: offline only; no live product claim.
- `local_reachability`: credential-free `GET` checks against exact loopback
  endpoints; no visual, authenticated, inference, or release claim.
- `connected_synthetic`: only after every contract readiness gate passes for
  the exact local or staging target.

Never silently promote local evidence to staging evidence. Never infer that a
healthy UI means the Admin API, Gateway, authentication, provider, or cleanup
path is healthy.

For each journey cover as applicable:

- prerequisites and first-use onboarding;
- authorized happy path;
- unauthorized and cross-scope path;
- validation, empty, loading, timeout, partial failure, retry, and recovery states;
- refresh, back navigation, duplicate submission, concurrency, and lifecycle transitions;
- observable audit/cost/request evidence;
- documentation and API consistency.

Return one result per case: `pass`, `fail`, `blocked`, or `not_tested`. Evidence includes timestamp, exact steps, expected/observed, redacted artifacts, severity, reproducibility, cleanup result, and next owner.

For a connected synthetic run:

1. Inventory exact synthetic objects before the first mutation.
2. Confirm the host, tenant, persona, budget, secret boundary, write prefix,
   cleanup owner, and production denial.
3. Run matrix cases in order with zero automatic retries.
4. Stop immediately on any contract abort condition.
5. Revoke generated credentials before removing their parent application.
6. Reconcile the final inventory. Cleanup residue makes the run `blocked`, not
   complete.

Do not put authorization headers, cookies, application keys, provider keys,
personal data, raw prompts, or sensitive provider responses in evidence. Never
mutate or probe production. Prove production denial through policy and exact
host checks only.

See [example](examples/journey.md), `references/fixtures/journey.md`,
`references/test-environment-contract.json`, and
`references/golden-journey-matrix.json`.
