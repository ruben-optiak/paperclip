# Optiak AI OS

Portable `agentcompanies/v1` package for Optiak's internal Product & Engineering Assurance organization.

## Purpose

Optiak AI OS provides a durable operating layer for planning, reviewing, testing, diagnosing, and improving Optiak. It is designed as an engineering safety system, not as a collection of generic chat agents.

The initial operating scope includes:

- product discovery, backlog triage, roadmap and PRD review;
- architecture review and technical-debt discovery;
- implementation and debugging support once repositories are connected;
- independent pull-request and release review;
- event-driven incident triage and post-incident learning;
- browser-based UI, brand, accessibility, and end-to-end validation;
- OpenAI-compatible API and Optiak governance conformance;
- public documentation accuracy and developer-experience review.

Finance, infrastructure FinOps, revenue, growth, legal, and people operations are explicit future extensions. They belong in this same company unless a real legal, budget, leadership, or data boundary requires another company.

## Product boundary

Optiak is an AI gateway and control plane. Its applications group credentials, models, guardrails, tools, data integrations, cost settings, and inference defaults. Services send inference requests through Optiak using application API keys. This package must not reposition Optiak as a chatbot, agent builder, or end-user application layer.

See `references/product-boundary.md` and `references/source-map.yaml`.

## Product & Engineering operating model

The organization works through six durable domains without creating one agent per heading:

| Domain | Accountable owner | Current delivery coverage |
| --- | --- | --- |
| 4.1 Product Management & Strategy | Product & PRD Lead | Product, Brand/UI, Documentation/DX and QA |
| 4.2 Core Product Platform | Engineering Assurance Lead | Architecture, Platform Engineering, Independent Review and QA |
| 4.3 Integrations & Enterprise | Engineering Assurance Lead (temporary) | Architecture, Platform Engineering, Independent Review and QA |
| 4.4 Data Platform & AI Quality | Engineering Assurance Lead (temporary) | Explicit staffing gap; Architecture and QA cover the initial contract |
| 4.5 Infrastructure & Reliability | Engineering Assurance Lead | Reliability, Platform Engineering, Independent Review and QA |
| 4.6 Engineering Handbook | Engineering Assurance Lead | Documentation/DX custody with chapter-specific owners and review |

See `references/product-engineering-operating-model.md` for scope, decision rights, the feature-delivery pipeline, handoffs, and evidence-based hiring gates. `references/system-repository-register.yaml` keeps systems and approved repositories distinct from live connection proof. `references/engineering-handbook-index.md` assigns chapter custody without inventing handbook content that has not yet been connected.

Use `references/agent-role-review-matrix.md` to review the ten roles together.
It defines one controlled case and the same ten quality gates per agent while
still running them one at a time and returning each agent to `paused`.

## Organization

| Agent | Reports to | Primary responsibility |
| --- | --- | --- |
| Director of Optiak | — | Intake, prioritization, cross-functional coordination, Board escalation |
| Engineering Assurance Lead | Director | Technical delivery, quality gates, release readiness |
| Product & PRD Lead | Director | Product intent, roadmap, backlog and acceptance criteria |
| Principal Platform Architect | Engineering Assurance Lead | Architecture, RFCs, technical debt and platform boundaries |
| Senior Platform Engineer | Engineering Assurance Lead | Reproduction, debugging and approved implementation, including frontend work in Paperclip-managed isolated workspaces |
| Independent Code & PR Reviewer | Engineering Assurance Lead | Independent correctness, security and maintainability review |
| Reliability & Incident Response Engineer | Engineering Assurance Lead | On-call triage, mitigation proposals, incident evidence and postmortems |
| QA & E2E Validation Engineer | Engineering Assurance Lead | Golden journeys, edge cases, browser/API validation and regressions |
| Brand & UI Quality Reviewer | Product & PRD Lead | Brand consistency, design system, accessibility and visual evidence |
| Documentation & DX Steward | Product & PRD Lead | Public docs, examples, API developer experience and drift detection |

The Board may assign work directly to any specialist. Reporting lines define accountability and handoff ownership; they do not prevent collaboration.

Engineering engagement is on-demand rather than an automatic all-agent
pipeline. Each of the ten agents has one distinct lead request class. Every
question has exactly one lead, at most two consulted specialists and one
canonical output. Each consultation carries a different narrower question and
expected evidence delta, and downstream gates reuse fresh accepted reports by
reference.

## Operating workflows

### Feature and PRD

`idea → product intent/PRD when needed → conditional architecture/implementation/review → affected functional/UI/docs/reliability gates only → release evidence → Board decision`

### Pull request

`PR event → independent review → risk-based specialist review → required tests → review verdict → human merge decision`

### Incident

`trusted alert → incident triage → reproduction/evidence → diagnosis → mitigation proposal → approved change → regression proof → postmortem`

### Documentation drift

`scheduled public-doc review → claim/source comparison → evidence-backed finding → Product or Engineering owner → verified correction proposal`

“Always on” means event-driven alerts and bounded routines. Agents must not burn budget by polling unmanaged processes or claim on-call coverage when no signal source is connected.

## Safety state in v0.1.29

- All ten agents have one distinct lead request class, canonical output,
  exclusions and stop condition. Every consultation must name a different
  narrower question and evidence delta. The engagement evaluator rejects wrong
  leads, duplicate consultations, duplicate evidence, blanket fanout, parallel
  full reports and repeated accepted evidence.
- Functional QA, Brand/UI, Documentation/DX and Reliability are separate
  conditional gates. None acts as a generic second review, and Engineering
  Assurance indexes their accepted artifacts instead of recreating them.
- The controlled role-review harness is an exact fail-closed state machine:
  create unassigned, resume one agent, assign, accept exactly one assignment
  run, persist `ROLE_REVIEW_FINAL` and `done` in that run, inspect, then pause.
  A recovery run is negative evidence and never repairs the same review.

- Architecture owns structural decisions; Senior Engineering owns diagnosis and
  approved implementation; Reliability owns fresh runtime/incident questions;
  QA owns executable behavior evidence; Engineering Assurance owns the combined
  risk gate. The shared engagement evaluator rejects wrong leads, blanket
  fanout, duplicated reports and repeated accepted evidence.
- QA source execution is defined for exact commits of `optiak/optiak`,
  `optiak/optiak-frontend` and `optiak/iac-infra`. Profiles expose fixed argv
  steps for backend static/unit, frontend static/unit and IaC static validation;
  they do not expose arbitrary shell. The reference Docker runner is non-root,
  read-only, no-network, receives a read-only tracked-file snapshot, writes only
  to tmpfs, exposes no repository/production credential or Docker socket, and
  is removed by its host controller. A synthetic boundary smoke does not prove
  any real repository or authorize implementation.

- A read-only post-import doctor compares all ten live agents with
  `.paperclip.yaml` and fails on adapter, model, arguments, managed-MCP,
  heartbeat, budget, permission or paused-state drift. It never repairs or
  activates an agent and omits instance IDs and unrelated fields from output.
- The Director is a `general` root (`reportsTo: null`), has
  `canCreateAgents: false`, and receives `tasks:assign` through an explicit
  portable grant. The live authority proof must observe a real read-only
  `403 agents:create` denial using a short-lived key that is revoked before the
  proof can pass.
- The three approved repositories have a versioned execution-workspace
  contract and deterministic evaluator. The first live
  `optiak/optiak-frontend` lifecycle proof created a clean Paperclip-owned,
  issue-scoped `git_worktree` from the exact `origin/main` revision and archived
  it with zero commits ahead. Agent-side Git inspection remains blocked because
  the shared control-plane container's legacy read-only sandbox denies
  worktree Git metadata. The evaluator now also requires a dedicated execution
  boundary, Bubblewrap, readable Git metadata and no control-plane privilege
  relaxation. Shared checkouts, nested worktrees, merge, deploy, production
  credentials and Reviewer writes remain denied.
- The official Daytona sandbox-provider manifest `0.1.7` remains installed but
  disabled in the local Optiak instance, and the Environments UI is off. No
  provider secret, saved environment, sandbox lease, agent
  default-environment assignment, adapter migration or native-runner rollout
  exists. Agent-authored implementation is intentionally deferred: agents may
  read approved sources, analyze, review and draft, but must not receive an
  implementation workspace or create code changes.

- Product advisory work follows the OPT-39 quality baseline. Priority and
  roadmap recommendations require an exact approved strategy reference;
  `updatedAt` samples support hygiene only, every recommended ticket requires a
  same-review detail read, and the Board memo is separated from its machine
  envelope. The deterministic evaluator also fails on excess scope, missing
  evidence depth, external writes and context-efficiency regression.

- Every agent carries `optiak-notion-knowledge`. The live connection is bound
  explicitly to the ten current agents, with no future-agent inheritance, and
  exposes only `Get tool access`, `Fetch Notion entities`, and `Query Notion
  data sources`; the remaining 42 actions are off and none are ask-first. The
  hosted OAuth flow inherits the authorizing Notion user's access and did not
  present page selection, so logical Product & Engineering roots are a
  fail-closed behavioral contract until a dedicated restricted Notion identity
  or enforcing proxy supplies a hard content boundary. Agents remain paused.

- The Linear privacy candidate projects metadata before the gateway/audit
  boundary and is tested with synthetic identity canaries. It is **offline,
  not deployed or imported as a connection**. Semantic Product review is not
  possible from its metadata-only output. Runtime placement/authentication and
  live sink verification remain separate gates; see `connectors/linear-privacy/README.md`.
- New report completions use a self-contained installed helper: enum and source
  validation, exact run binding, one write and verified readback. A connected
  Product sample has per-item dispositions, not an invented aggregate verdict.
- Linear has an operator-only metadata preflight with reviewed catalog hashes,
  fail-closed quarantine and audience checks. It neither refreshes credentials
  nor grants access, and does not claim to redact raw provider audit storage.
- Linear ticket creation is a separate, offline connector with one tool. It
  starts disabled, accepts at most five PII-free tickets whose complete signed
  arguments fit the approval card, and requires an exact Board action approval
  on every call. It creates only unassigned `OPT` issues, persists no ticket
  bodies or provider credentials, and stops for operator reconciliation rather
  than retrying an uncertain mutation. Importing the package does not install or
  activate it; see `runbooks/linear-ticket-publishing.md`.
- Post-completion operator QA uses immutable issue documents instead of comments
  that could reopen a closed task. See `runbooks/connected-review-quality.md`.
- Product advisory quality follows `runbooks/product-advisory-review.md`: strategy
  before priority, detail before recommendation, compact Board output and a
  deterministic efficiency/evidence gate.
- All agents and routine schedules import paused.
- Senior Platform Engineer carries a portable frontend implementation skill for
  `optiak/optiak-frontend`, but it fails closed until Paperclip assigns an
  approved isolated writable execution workspace. It uses the branch and
  workspace supplied by the control plane and never creates its own worktree.
- Independent PR review uses a versioned behavior-first rubric in either remote
  MCP mode or an exact Paperclip-provided workspace. No local worktree scripts,
  machine paths, repository writes, merge authority or deployment authority are
  bundled.
- Six Product & Engineering domains route to the existing ten agents. No new
  agent, repository access, source connection, or authority is created by the
  operating-model taxonomy. Data Platform & AI Quality remains an explicit
  staffing gap under temporary Engineering Assurance coverage.
- Public documentation may be read; its freshness must be recorded.
- Architecture claims resolve through eight domain-specific authorities; public
  docs, source revisions, health endpoints, and fixtures cannot silently stand
  in for implementation, deployment, readiness, or live behavior.
- The 14 approved public documentation pages map to explicit Product,
  Engineering, Documentation, release, cadence, and escalation ownership. The
  map stores no page content and authorizes neither crawling nor publication.
- PRD readiness uses 16 deterministic cross-functional gates. A passing result
  hands the exact revision to Architecture and never starts implementation.
- Material-incident postmortems separate evidence, hypotheses, verified root
  cause, contributing conditions, corrective actions, learning, and recurrence
  risk. They require independent human review and never close an incident or
  execute an action.
- Local fixtures and draft work products are allowed.
- Linear team `OPT` is selected as the operational backlog authority; its live connection and smoke evidence remain instance state rather than package content.
- GitHub authority is limited to read-only evidence from `optiak/optiak`, `optiak/optiak-frontend`, and `optiak/iac-infra`, initially for Independent Code and PR Reviewer only. Every other repository is denied by default, and IaC source never substitutes for deployed-state evidence.
- The verified local GitHub pattern uses the generic MCP connector with three secret-backed headers, enables fourteen repository-scoped reads, leaves five broad search/collaborator tools off, quarantines future tools and applies a missing-scope ask-first, exact-repository allow, fallback-deny policy chain. These live controls are instance state and must be reapplied and rechecked after import.
- The GitHub connection may remain deliberately deferred without broadening any other source.
- Local UI, Admin, Gateway, documentation, and MCP endpoints are governed by a
  machine-readable environment contract. Only credential-free loopback
  reachability is currently allowed; all five local surfaces are reachable, the
  browser is disconnected, and the local tenant data classification is unknown.
- A thirteen-journey matrix covers authentication, permissions, synthetic
  application and key lifecycle, both OpenAI-compatible API styles, streaming,
  observability correlation, tenant isolation, and mandatory cleanup. Its
  presence is test scope, not evidence of a pass.
- Application keys use the UI's shortest seven-day expiration and are revoked
  at the end of every smoke. A dedicated synthetic application may remain only
  as a Board-approved reusable fixture with zero active keys and a reconciled
  baseline.
- Local inference is intentionally deferred. Provider/model positives,
  streaming, cost correlation, and key-revocation proof will run only in a
  deployed inference environment under a new approval; local is not staging or
  release evidence.
- Observability has a versioned offline source contract. Aggregate analytics is
  first, exact traces are ask-first, and raw events, unstructured logs, broad
  trace search, session replay, attachments, and payload content are denied.
  All connections and automatic on-call coverage remain unavailable until their
  smokes and signed-alert tabletop pass.
- Promotion of this AI OS is governed separately from an Optiak product release.
  Direct local-to-production promotion is denied; the same immutable package
  and Paperclip image candidate must pass preproduction, complete backup/restore,
  paused import, selected-agent smokes, rollback rehearsal, and Board gates.
  No infrastructure provider has been selected and the evaluator cannot execute.
- No source checkout, GitHub credential or installation, approved staging tenant, browser session, backlog snapshot, logs, metrics, or production credentials are bundled.
- Production is read-only even after connection.
- Sandbox mutations require a dedicated test tenant, synthetic data, bounded cleanup, and an approved tool policy.
- Agents cannot merge, deploy, roll back, rotate secrets, change infrastructure, or approve their own work.
- Every agent closes work through one run-linked in-memory report and verifies ambiguous writes before any retry.
- Company and agent budget warnings are set to 80 percent and hard stops to 100 percent; daily run caps and five-minute fixture timeouts remain effective even while subscription cost is unpriced.
- Context efficiency is reviewed on uncached input rather than cumulative raw input; the committed baseline contains aggregates only and no prompts, comments, logs, database IDs, or credentials.
- Final reports keep issue disposition, report history, reviewed-object verdict, operational readiness, and evidence state separate; repaired retries supersede prerequisite diagnostics without deleting history.
- The deprecated Landlock flag remains temporarily pinned because Docker's built-in seccomp blocks Bubblewrap in the shared control-plane container. A versioned compatibility lock and live probe prevent removal until a dedicated execution boundary passes the full migration gates.

## Validation

```sh
npm ci --prefix companies/optiak-ai-os/connectors/linear-ticket-publisher --ignore-scripts
./companies/optiak-ai-os/scripts/check.sh
```

Build a deterministic import archive outside the package:

```sh
./companies/optiak-ai-os/scripts/build-import-zip.sh /tmp/optiak-ai-os-v0.1.29.zip
```

## Getting started

1. Use a Paperclip instance, database, secret store, and persistent storage separate from Enki.
2. Run the package validation and secret scan.
3. Create a backup of the target instance.
4. Preview the exact generated ZIP before applying it.
5. Import with every agent and routine paused.
6. Configure only the first approved source, run its manual smoke test, and review evidence.
7. Activate one agent at a time. Enable schedules only after their manual runs pass.

Start or inspect the isolated local instance with the versioned helper:

```sh
./companies/optiak-ai-os/scripts/local-instance.sh up --build
./companies/optiak-ai-os/scripts/local-instance.sh health
```

The defaults are Compose project `paperclip-optiak`, Paperclip instance id `optiak`, host port `3200`, and data directory `data/docker-paperclip-optiak`. They do not reuse Enki's container, port, data, auth-cookie namespace, session secret, or integrations.

The current CLI preview command is:

```sh
npx paperclipai company import companies/optiak-ai-os --target new --dry-run
```

The UI import preview remains the recommended first application path because it makes collisions and paused state visible.

See `runbooks/local-setup.md`, `runbooks/test-environment.md`,
`runbooks/execution-budgets.md`, `runbooks/connections.md`,
`runbooks/linear-ticket-publishing.md`,
`runbooks/product-advisory-review.md`,
`runbooks/qa-source-execution.md`,
`runbooks/observability-and-oncall.md`, `runbooks/security.md`,
`runbooks/sandbox-migration.md`, and `runbooks/smoke-test.md` before import.

Review `references/product-engineering-operating-model.md` and
`references/engineering-handbook-index.md` before changing ownership, creating
an agent, or modifying the feature-delivery pipeline.

## References

- [Optiak documentation](https://docs.optiak.dev/getting-started/overview)
- [Agent Companies specification](https://agentcompanies.io/specification)
- [Paperclip](https://github.com/paperclipai/paperclip)
