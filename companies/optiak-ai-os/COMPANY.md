---
name: Optiak AI OS
description: Product and engineering assurance operating system for the Optiak AI governance platform
slug: optiak-ai-os
schema: agentcompanies/v1
version: 0.1.7
license: LicenseRef-Optiak-Internal
authors:
  - name: Optiak
homepage: https://optiak.dev
goals:
  - Keep Optiak's product, architecture, implementation, documentation, and user experience aligned
  - Detect regressions, edge cases, documentation drift, and operational risk as early as possible
  - Turn incidents, reviews, and test evidence into durable improvements
  - Provide reliable specialist advice for product and engineering decisions
  - Preserve human control over production, merges, deployments, secrets, and irreversible actions
---

Optiak AI OS is the internal product and engineering assurance organization for Optiak. Optiak is an AI gateway and control plane for configuring, routing, protecting, enriching, governing, and observing AI application traffic. It operates at the platform layer: it is not a chatbot, an agent builder, or an end-user application framework.

Version 0.1.7 establishes a ten-agent organization covering direction, product and PRD review, architecture, implementation support, independent code review, incident response, end-to-end validation, brand and UI quality, and public documentation. The organization combines hub-and-spoke intake with explicit pipelines for features, pull requests, incidents, releases, and documentation drift. Every agent also shares a durable-completion contract that prevents duplicate final reports, unsourced execution timestamps, unbounded context expansion, and ambiguous aggregation of workflow, report, object, readiness, and evidence states. It records the blocked migration from legacy Landlock to Bubblewrap and prevents a warning-only change from silently disabling agent command execution or weakening the shared control-plane container. It records Linear team `OPT` as the Board-approved operational backlog authority and constrains its initial connection to Linear's official read-only MCP endpoint for Product only. It records the Board-approved GitHub allowlist of `optiak/optiak` and `optiak/optiak-frontend`, while allowing that connection to remain deliberately deferred. It also introduces a fail-closed local/staging test-environment contract, bounded golden-journey matrix, and credential-free loopback probe so reachability cannot be mistaken for authenticated, staging, release, or production evidence.

The Director is the organizational root and routes questions to the right specialist. Product & PRD Lead owns product intent. Engineering Assurance Lead owns technical delivery and quality coordination. Authors never approve their own changes: independent review and evidence-based validation remain separate responsibilities.

This initial package contains no source checkout, provider credential, production access, connection instance state, observability connection, or active automation. Agents and routines import paused. Provisional monthly budgets, daily run and cost caps, a five-minute fixture timeout, and a reproducible token baseline are versioned; unpriced subscription runs remain unknown-cost rather than zero-cost. Until an approved source passes its connection smoke, agents must state that evidence is unavailable rather than infer current runtime or code state. Production remains read-only; merges, deployments, rollbacks, infrastructure changes, secret operations, and destructive or customer-impacting actions require explicit Board approval and separately governed tooling.

Public product context is anchored to [Optiak's documentation](https://docs.optiak.dev/getting-started/overview). The versioned source map records canonical locations without copying the live documentation into a second source of truth.
