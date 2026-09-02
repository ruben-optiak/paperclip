---
name: optiak-incident-triage
description: Triage Optiak incidents with a trusted signal, bounded severity, timeline, ownership, mitigation proposal, and postmortem handoff
---

# Optiak incident triage

Apply the machine-readable source contract at
`references/observability-source-contract.json`. Do not claim an incident from
an untrusted, disconnected, missing, or stale signal. Every observation uses a
signal envelope containing:

- environment, service, source id, observed time, retrieval time, and freshness;
- bounded query window and redaction status;
- immutable deployed revision for a deployment claim;
- request or trace correlation only when request-level evidence is approved.

Establish:

- environment and affected version;
- detection source, first observed time, freshness, and confidence;
- user impact, scope, security/data implication, and known workaround;
- incident owner, communications owner, next checkpoint, and live execution path.

Severity guide:

- `SEV0`: confirmed widespread security/data loss or platform-wide critical failure;
- `SEV1`: major production capability unavailable or severe customer impact;
- `SEV2`: degraded or scoped capability with meaningful impact;
- `SEV3`: minor, contained, or no-current-impact defect.

Missing or stale data means `unknown`, never `healthy`. Aggregate analytics is
the initial diagnostic source; raw events, stdout logs, broad trace search, and
session replay are denied. Exact trace and error-event detail are ask-first.
Health endpoints prove process liveness only. Source code, a merge, or a
successful workflow does not prove the deployed version.

Maintain a timestamped timeline. Separate mitigation from root cause. Propose
but do not execute production changes. Closure requires fresh recovery evidence,
regression ownership, and postmortem disposition. See [example](examples/triage.md),
`references/fixtures/alert.md`, and `references/fixtures/observability.md`.
