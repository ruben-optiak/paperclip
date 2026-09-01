---
name: Optiak AI OS
description: Product and engineering assurance operating system for the Optiak AI governance platform
slug: optiak-ai-os
schema: agentcompanies/v1
version: 0.1.0
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

Version 0.1.0 establishes a ten-agent organization covering direction, product and PRD review, architecture, implementation support, independent code review, incident response, end-to-end validation, brand and UI quality, and public documentation. The organization combines hub-and-spoke intake with explicit pipelines for features, pull requests, incidents, releases, and documentation drift.

The Director is the organizational root and routes questions to the right specialist. Product & PRD Lead owns product intent. Engineering Assurance Lead owns technical delivery and quality coordination. Authors never approve their own changes: independent review and evidence-based validation remain separate responsibilities.

This initial package contains no source repositories, provider credentials, production access, backlog connection, observability connection, or active automation. Agents and routines import paused. Until an approved source is connected, agents must state that evidence is unavailable rather than infer current runtime or code state. Production remains read-only; merges, deployments, rollbacks, infrastructure changes, secret operations, and destructive or customer-impacting actions require explicit Board approval and separately governed tooling.

Public product context is anchored to [Optiak's documentation](https://docs.optiak.dev/getting-started/overview). The versioned source map records canonical locations without copying the live documentation into a second source of truth.
