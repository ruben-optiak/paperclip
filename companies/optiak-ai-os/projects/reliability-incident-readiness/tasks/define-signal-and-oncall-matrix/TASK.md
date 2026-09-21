---
slug: define-signal-and-oncall-matrix
name: Define the trusted signal and on-call matrix
assignee: reliability-incident-engineer
project: reliability-incident-readiness
---

Maintain `skills/optiak-incident-triage/references/observability-source-contract.json`
and `runbooks/observability-and-oncall.md`. Inventory alert, log, metric, trace,
status, deploy, error-tracking, and coordination signals. For each, define owner,
freshness, trust level, environment, query limits, redaction, wake path,
deduplication, acknowledgement, and fallback.

The offline definition is done when fixtures prove that missing or stale signals
cannot be mistaken for healthy production and no unmanaged polling is required.
Live on-call remains incomplete until every source smoke and the signed-alert
tabletop pass in a deployed environment.
