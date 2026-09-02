# Test environment runbook

This runbook turns the portable E2E policy into an operator-controlled local or
staging smoke. It does not authorize an environment merely because it is
reachable.

The canonical machine-readable inputs are:

- `skills/optiak-e2e-validation/references/test-environment-contract.json`
- `skills/optiak-e2e-validation/references/golden-journey-matrix.json`

## Recorded local discovery

The 2026-09-02 observation is tied to backend revision
`87ca4876cb89b4aa03e505079e80c921ffac9001` and frontend revision
`b44db112e4fe08c836e23d8d4362109660b968d8`. It is historical after those
revisions or processes change.

| Surface | Candidate URL | Observed state |
| --- | --- | --- |
| Control-plane UI | `http://localhost:3000` | HTTP 200; no connected browser, so no visual or authenticated claim |
| Local documentation | `http://localhost:3001` | HTTP 307 redirect |
| Admin health | `http://localhost:8081/health` | HTTP 200 |
| Gateway health | `http://localhost:8080/health` | HTTP 200 after removing the unsupported local provider block |
| MCP health | `http://localhost:8082/health` | HTTP 200 |

The earlier Gateway failure was caused by an ignored local `optiak.toml` whose
first router provider used `config_type = "codex"` without fields accepted by
the current provider schema. The operator removed that unsupported block and a
fresh credential-free probe returned HTTP 200 on 2026-09-02. Treat this as a
repaired local configuration mismatch, not a staging incident or product
regression. Never paste the file or its secrets into Paperclip evidence.

## 1. Static safety gate

From the Paperclip repository:

```sh
node companies/optiak-ai-os/scripts/probe-test-environment.mjs --json
```

This verifies that local probes are credential-free `GET` requests to exact
loopback URLs, staging remains disconnected, production is denied, cleanup is
mandatory, and the proposed initial provider cap remains at most USD 1 and
twelve requests.

## 2. Fresh reachability gate

Run from the host, never from an agent prompt:

```sh
node companies/optiak-ai-os/scripts/probe-test-environment.mjs --live-local --json
node companies/optiak-ai-os/scripts/probe-test-environment.mjs --live-local --require-api-ready --json
```

The probe sends no cookie, bearer token, API key, request body, or arbitrary
URL. The second command now passes for the recorded local revisions, but must
fail closed again if Admin, Gateway, or MCP health regresses.

To repair the prerequisite, update the ignored local Gateway configuration in
the backend checkout to a provider type and required fields supported by the
exact checked-out revision. Keep provider values in the backend runtime secret
boundary. Restart only the Gateway service, then require a fresh HTTP 200 from
`/health`. Configuration repair does not authorize inference.

## 3. Classify and approve one target

The Board records exactly one target as `approved_synthetic`:

- exact control-plane and Gateway hosts;
- immutable deployed version or both exact source revisions;
- a dedicated tenant label and confirmation it contains no customer data;
- cleanup owner and manual fallback owner;
- retention and reset behavior;
- explicit production-host denial.

Loopback means local development, never staging. The currently discovered
staging Gateway hostname is only a candidate from versioned test configuration;
it is not authorized and its control-plane hostname is still unknown.

## 4. Provision synthetic identities

Use distinct, dedicated identities for:

- organization admin;
- organization member;
- outsider in a separate synthetic scope for isolation checks;
- application client, represented by one expiring application credential.

Browser cookies stay in the browser connection. The application credential is
bound directly to a purpose-scoped API connector or retained by the human
operator for a manual smoke; it never enters an agent environment, prompt,
issue, screenshot, shell transcript, or repository. Provider credentials stay
inside the Optiak runtime and are never exposed to Paperclip.

## 5. Approve and enforce the initial budget

The proposed first-smoke ceiling is:

- USD 1 total upstream-provider spend;
- twelve inference requests maximum, of which four are planned positives;
- 128 output tokens per inference request;
- zero automatic retries;
- immediate stop if cost cannot be observed.

Optiak's application budget is documented as visibility, not a traffic hard
stop, so it cannot enforce this ceiling alone. Use a provider-side cap or a
bounded connector/request counter as the hard boundary. A versioned proposal
does not authorize spend; the Board must approve it before the first request.

## 6. Preflight data and tools

Before any Yellow action:

1. Record the exact issue and run sequence.
2. Use prefix `e2e-<issue>-<run-sequence>-` and marker
   `synthetic-test-only`.
3. Inventory applications and credentials in the synthetic tenant.
4. Review the effective browser/API tool catalog. Unknown tools stay
   quarantined.
5. Confirm no object with the planned prefix already exists.
6. Confirm cleanup can revoke the credential and remove only the exact new
   application.

Provider-key administration, tenant/member lifecycle, role changes,
organization governance, integrations, and billing remain Orange and outside
the initial agent smoke. Pre-provision the single approved low-cost model via a
separate operator-reviewed action.

## 7. Execute the matrix

Run `golden-journey-matrix.json` in order. Preserve `pass`, `fail`, `blocked`,
and `not_tested` per case. The bounded inference positives are:

1. one non-streaming Chat Completions request;
2. one streaming Chat Completions request;
3. one non-streaming Responses request;
4. one streaming Responses request.

Authentication, permission, malformed-input, unavailable-model, stream
termination, request correlation, refresh-before-retry, and cross-tenant cases
remain explicit. Do not retry an ambiguous mutation or inference automatically.

## 8. Cleanup and close

Revoke every generated credential first. Verify one bounded post-revocation
denial, remove only the exactly prefixed synthetic application, and compare the
final inventory with the preflight inventory. Any residue, ambiguous write, or
unverifiable revocation leaves the smoke blocked with a named owner.

Keep QA, Brand/UI, and all routines paused after the manual smoke. Activation
is a separate Board decision.
