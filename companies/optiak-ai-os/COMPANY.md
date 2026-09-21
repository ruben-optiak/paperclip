---
name: Optiak AI OS
description: Product and engineering assurance operating system for the Optiak AI governance platform
slug: optiak-ai-os
schema: agentcompanies/v1
version: 0.1.29
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

Version 0.1.29 hardens the controlled ten-agent review into an exact single-run state machine and adds a dedicated disposable QA source runner. Review issues are created unassigned, one paused agent is resumed before assignment, the canonical report and final disposition must be persisted by the same assignment run, and any retry or recovery fails the review. QA receives a non-root, no-network, read-only Docker boundary with fixed profile IDs, source snapshots, capped evidence and controller-confirmed cleanup; it still has no implementation, repository-write, merge, deployment or release authority.

Version 0.1.27 sharpens the boundaries between Architecture, Platform Engineering, Reliability, QA and Engineering Assurance. Every engineering question has one lead, at most two necessary consulted agents and one canonical report; contributors return only new evidence and accepted work is reused by reference. It also defines a dedicated ephemeral QA source runner for three exact repositories and allowlisted static/unit profiles. The runner remains disconnected until its isolation smoke passes and grants no arbitrary shell, repository write, implementation, production or release authority.

Version 0.1.26 converts the Board review of the historical OPT-39 Product run into a read-only advisory quality gate. Strategy or an explicit Board question must drive priority selection; an `updatedAt` sample can support hygiene only, every recommendation requires an exact detail read, and executive output is separated from the machine envelope. The gate limits recommendations and decisions, preserves facts/hypotheses/missing evidence, and records context-efficiency regressions without authorizing a retry, Linear write, agent activation, or implementation.

Version 0.1.25 deliberately parks agent-authored implementation while the advisory and read-only operating model is refined. The locally installed Daytona provider is disabled, environment management is off, no remote environment or provider secret exists, and `OAI-011` plus `OAI-042` remain deferred. Agents may read approved sources, analyze, review and draft inside Paperclip; they may not receive an implementation workspace or create code changes.

Version 0.1.24 stages the dedicated execution boundary without pretending it is operational. The official Daytona sandbox-provider manifest `0.1.7` is installed and healthy in the local Optiak instance, and environment management is enabled. No Daytona environment, API key, sandbox lease, agent adapter change or native-runner rollout exists yet. The first migration probe remains limited to Senior Platform Engineer on `codex_local`; every agent stays paused and the legacy fallback remains pinned until the remote Bubblewrap, Git metadata, write-denial and network gates pass.

Version 0.1.23 records the first live Paperclip-owned execution-workspace lifecycle proof. Paperclip created and archived a clean issue-scoped `optiak/optiak-frontend` worktree at an immutable `origin/main` revision, but the agent-side Git smoke failed because the shared control-plane container's legacy read-only sandbox denies worktree Git metadata. The readiness evaluator now requires a dedicated execution boundary, Bubblewrap, agent-readable Git metadata and no control-plane privilege relaxation. A disposable repository-only diagnostic proved Bubblewrap read and write denial, but it is explicitly not live activation authority.

Version 0.1.22 removes the Director's inherited legacy agent-creation authority. The Director remains the only organizational root through `reportsTo: null`, now uses the non-privileged `general` role, and receives only an explicit portable `tasks:assign` grant. A sanitized live proof uses a short-lived agent key and a read-only gated endpoint to require a real `403 agents:create` denial; it always revokes the key and never creates or activates an agent.

Version 0.1.21 adds a read-only post-import parity doctor after a live import drifted all ten agents from `codex_local` to an unusable `process` adapter. The doctor compares portable identities, adapter settings, runtime containment, heartbeat limits, budgets, permissions and paused state without exporting database IDs or secrets. It also adds the fail-closed contract and evaluator for future Paperclip-owned execution workspaces in the three approved Optiak repositories; this contract creates no worktree, branch, credential, merge or deployment authority.

Version 0.1.20 recorded the live-validated Notion boundary. The official hosted MCP OAuth grant inherits the authorizing Notion user's workspace access and, in the observed flow, does not offer page selection. Paperclip therefore permits only `Get tool access`, exact `Fetch Notion entities`, and exact `Query Notion data sources`; all other 42 catalog actions, including every mutation and all global/private/user/search surfaces, are off. All ten current agents are selected explicitly and future agents inherit no access. A dedicated least-privilege Notion identity or an enforcing proxy remains required before treating logical Product & Engineering roots as a hard provider boundary. Notion is authority for approved intent and knowledge, Linear for execution state, GitHub for implementation at an immutable revision, and Paperclip for AI-work coordination and approvals. The package defines policy and agent behavior but never stores the OAuth grant, live connection identifiers, or page content.

The Director is the organizational root and routes questions to the right specialist. Product & PRD Lead owns product intent. Engineering Assurance Lead owns technical delivery and quality coordination. Authors never approve their own changes: independent review and evidence-based validation remain separate responsibilities.

The canonical Product & Engineering ownership and handoff contract lives in `references/product-engineering-operating-model.md`. Domain ownership does not grant repository, runtime, production, deployment, or approval authority.

This initial package contains no source checkout, provider credential, production access, connection instance state, observability connection, or active automation. Agents and routines import paused. Provisional monthly budgets, daily run and cost caps, a five-minute fixture timeout, and a reproducible token baseline are versioned; unpriced subscription runs remain unknown-cost rather than zero-cost. Until an approved source passes its connection smoke, agents must state that evidence is unavailable rather than infer current runtime or code state. The only designed external write is separately gated creation of unassigned `OPT` backlog issues; it is disabled by default and is not production-product authority. Merges, deployments, rollbacks, infrastructure changes, secret operations, destructive actions and customer-impacting mutations remain denied.

Public product context is anchored to [Optiak's documentation](https://docs.optiak.dev/getting-started/overview). The versioned source map records canonical locations without copying the live documentation into a second source of truth.
