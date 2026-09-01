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

## Organization

| Agent | Reports to | Primary responsibility |
| --- | --- | --- |
| Director of Optiak | — | Intake, prioritization, cross-functional coordination, Board escalation |
| Engineering Assurance Lead | Director | Technical delivery, quality gates, release readiness |
| Product & PRD Lead | Director | Product intent, roadmap, backlog and acceptance criteria |
| Principal Platform Architect | Engineering Assurance Lead | Architecture, RFCs, technical debt and platform boundaries |
| Senior Platform Engineer | Engineering Assurance Lead | Reproduction, debugging and implementation after repo connection |
| Independent Code & PR Reviewer | Engineering Assurance Lead | Independent correctness, security and maintainability review |
| Reliability & Incident Response Engineer | Engineering Assurance Lead | On-call triage, mitigation proposals, incident evidence and postmortems |
| QA & E2E Validation Engineer | Engineering Assurance Lead | Golden journeys, edge cases, browser/API validation and regressions |
| Brand & UI Quality Reviewer | Product & PRD Lead | Brand consistency, design system, accessibility and visual evidence |
| Documentation & DX Steward | Product & PRD Lead | Public docs, examples, API developer experience and drift detection |

The Board may assign work directly to any specialist. Reporting lines define accountability and handoff ownership; they do not prevent collaboration.

## Operating workflows

### Feature and PRD

`idea → product intent → architecture → implementation → independent review → QA/UI/docs → release evidence → Board decision`

### Pull request

`PR event → independent review → risk-based specialist review → required tests → review verdict → human merge decision`

### Incident

`trusted alert → incident triage → reproduction/evidence → diagnosis → mitigation proposal → approved change → regression proof → postmortem`

### Documentation drift

`scheduled public-doc review → claim/source comparison → evidence-backed finding → Product or Engineering owner → verified correction proposal`

“Always on” means event-driven alerts and bounded routines. Agents must not burn budget by polling unmanaged processes or claim on-call coverage when no signal source is connected.

## Safety state in v0.1

- All agents and routine schedules import paused.
- Public documentation may be read; its freshness must be recorded.
- Local fixtures and draft work products are allowed.
- No repositories, GitHub installation, staging tenant, browser session, backlog, logs, metrics, or production credentials are bundled.
- Production is read-only even after connection.
- Sandbox mutations require a dedicated test tenant, synthetic data, bounded cleanup, and an approved tool policy.
- Agents cannot merge, deploy, roll back, rotate secrets, change infrastructure, or approve their own work.

## Validation

```sh
./companies/optiak-ai-os/scripts/check.sh
```

Build a deterministic import archive outside the package:

```sh
./companies/optiak-ai-os/scripts/build-import-zip.sh /tmp/optiak-ai-os-v0.1.0.zip
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

The defaults are Compose project `paperclip-optiak`, host port `3200`, and data directory `data/docker-paperclip-optiak`. They do not reuse Enki's container, port, data, session secret, or integrations.

The current CLI preview command is:

```sh
npx paperclipai company import companies/optiak-ai-os --target new --dry-run
```

The UI import preview remains the recommended first application path because it makes collisions and paused state visible.

See `runbooks/local-setup.md`, `runbooks/connections.md`, `runbooks/security.md`, and `runbooks/smoke-test.md` before import.

## References

- [Optiak documentation](https://docs.optiak.dev/getting-started/overview)
- [Agent Companies specification](https://agentcompanies.io/specification)
- [Paperclip](https://github.com/paperclipai/paperclip)
