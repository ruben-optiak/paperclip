---
name: optiak-api-conformance
description: Validate Optiak Chat Completions and Responses compatibility, routing, governance, authentication, errors, streaming, costs, and observability
---

# Optiak API conformance

Use only a dedicated sandbox application key and synthetic prompts after an approved connection exists. Never print secrets or sensitive prompt/response bodies.

Build a versioned matrix covering:

- authentication and application scoping;
- Chat Completions and Responses request/response shapes;
- supported models and `smart` routing behavior;
- streaming framing, termination, cancellation, and partial failure;
- validation, unsupported fields, upstream errors, timeout, retry, and rate limits;
- tools, data enrichment, guardrails, and explicit opt-ins;
- usage, cost, request history, trace/correlation, and audit evidence;
- compatibility differences that are intentional and documented.

Record endpoint, client version, sanitized request fingerprint, status, schema result, latency, expected/observed, and evidence. Do not claim full OpenAI compatibility from a small happy-path sample. See [example](examples/case.md) and `fixtures/cases.json`.
