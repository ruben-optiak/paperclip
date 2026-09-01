---
name: optiak-debugging
description: Diagnose Optiak defects through reproducible evidence, ranked hypotheses, discriminating tests, and minimal verified fixes
---

# Optiak debugging

Use this loop:

1. Confirm environment, version, time window, impact, reporter, and known-good baseline.
2. Reproduce safely or state why reproduction is unavailable.
3. Build the smallest timeline across client, gateway, policy/routing, provider, persistence, and response.
4. Separate observations from hypotheses. Rank hypotheses and choose the cheapest discriminating test.
5. Stop when evidence falsifies a hypothesis; do not patch symptoms blindly.
6. Identify root cause, contributing conditions, detection gap, and blast radius.
7. Propose the smallest fix, regression test, rollout, rollback, and telemetry improvement.

Redact secrets and sensitive payloads. Never claim a fix without testing the original failure mode. See [example](examples/debug.md) and `fixtures/bug.json`.
