---
name: optiak-incident-triage
description: Triage Optiak incidents with a trusted signal, bounded severity, timeline, ownership, mitigation proposal, and postmortem handoff
---

# Optiak incident triage

Do not claim an incident from an untrusted or stale signal. Establish:

- environment and affected version;
- detection source, first observed time, freshness, and confidence;
- user impact, scope, security/data implication, and known workaround;
- incident owner, communications owner, next checkpoint, and live execution path.

Severity guide:

- `SEV0`: confirmed widespread security/data loss or platform-wide critical failure;
- `SEV1`: major production capability unavailable or severe customer impact;
- `SEV2`: degraded or scoped capability with meaningful impact;
- `SEV3`: minor, contained, or no-current-impact defect.

Maintain a timestamped timeline. Separate mitigation from root cause. Propose but do not execute production changes. Closure requires recovery evidence, regression ownership, and postmortem disposition. See [example](examples/triage.md) and `fixtures/alert.json`.
