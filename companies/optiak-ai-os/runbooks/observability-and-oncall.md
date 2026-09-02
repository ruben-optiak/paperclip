# Observability and on-call

This runbook applies the machine-readable contract at
`skills/optiak-incident-triage/references/observability-source-contract.json`.
It defines desired state only. No observability or alert connection is live, and
Optiak AI OS does not currently provide automatic on-call coverage.

## What local work proves

Local development can validate source contracts, policy, fixtures, liveness,
redaction rules, and fail-closed behavior. Local inference is unavailable and is
not a release gate. Provider-backed inference, end-to-end request correlation,
streaming, cost evidence, and credential revocation must be tested later in a
deployed inference environment under a fresh Board approval.

## Connection order

Connect one source at a time. Use a separate read-only identity for each trust
boundary and preserve all agents and routines paused during setup.

1. Aggregated Optiak analytics for one environment, organization, and at most
   one application in an initial 15-minute window.
2. Deployment metadata that joins the exact workflow commit SHA to the running
   ECS task definition and immutable image digest.
3. Prometheus through reviewed, parameterized queries with mandatory
   `environment` and `service` labels.
4. Tempo for a single exact trace or request ID after approval.
5. Sentry issue indexes with environment filters and connector-side redaction.
6. Signed alert ingress with replay protection, deduplication, acknowledgement,
   and an auditable Paperclip wake.

Do not initially connect the raw events endpoint, application stdout logs,
Sentry session replay, attachments, or broad trace search. They expose more
detail than initial triage needs and do not yet have an adequate bounded
redaction contract.

## Per-source smoke

For each source, record source id, effective identity, environment, allowed
operations, query bounds, retrieval time, source timestamp, freshness, and
redaction result. Then prove:

1. an allowed bounded read succeeds;
2. another environment or tenant is refused by policy without probing unrelated
   customer data;
3. an over-wide time range, bulk export, mutation, and newly discovered action
   are absent, refused, or quarantined;
4. synthetic canary secrets and payloads do not appear in the returned data,
   agent context, issue, comment, screenshot, or artifact;
5. credential revocation is independent and auditable.

Failure of any check returns the source to `disconnected` or `quarantined`.

## Triage sequence

1. Verify the signed alert or explicit human report. Record environment,
   service, observation time, retrieval time, freshness, and source id.
2. Deduplicate by alert event id. When it is absent, use the contract fingerprint
   inside the fixed 15-minute window.
3. Assign an incident owner and next checkpoint. A severity hint is never a final
   severity decision.
4. Read aggregate analytics before requesting request-level detail.
5. Establish the immutable deployed revision from both control-plane workflow
   evidence and runtime image evidence.
6. If needed, ask for one exact trace. Do not search broadly or return prompts,
   responses, tool payloads, credential metadata, or customer identifiers.
7. Separate observation, hypothesis, test, mitigation proposal, recovery
   evidence, and root cause in the incident timeline.
8. Propose changes; never deploy, restart, fail over, roll back, rotate secrets,
   or mutate production from this connection.

Missing, stale, contradictory, or inaccessible evidence means `unknown`, never
`healthy`. A shallow `/health` response proves process HTTP liveness only. A
cleared alert does not close an incident without fresh recovery evidence and an
explicit owner decision.

## Alert and wake proof

Before claiming on-call coverage, send one signed synthetic alert and an exact
duplicate. Prove that Paperclip creates or wakes exactly one incident issue,
records acknowledgement and owner, rejects an invalid signature and stale
event, and leaves no unmanaged poller. Run the bundled fixture cases for fresh,
partial, stale, and disconnected evidence.

Only the Board can accept the covered environments, services, hours, escalation
path, and response objective. Until then, the honest status is “incident runbook
defined; automatic on-call unavailable.”
