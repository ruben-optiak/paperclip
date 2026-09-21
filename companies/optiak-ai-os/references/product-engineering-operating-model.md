# Product & Engineering operating model

This document is the human-readable contract for Optiak Product & Engineering. It defines durable domains and decision ownership; it is not an instruction to create one agent per heading. The machine-readable companion is `product-engineering-operating-model.json`.

## Principles

- Organize around durable accountabilities, not the current number of people or agents.
- Keep product intent, technical approval, implementation, independent review, validation, release, and measurement as distinct decisions.
- A reporting line establishes accountability, not exclusive access. The Board may assign work directly to any specialist.
- One agent may cover several domains temporarily, but every temporary assignment and capability gap must remain visible.
- No role may approve its own authored change. A successful review or test is evidence for a human decision, never merge, deployment, production-change, or spend authority.
- Current-state claims require the exact authority named in `source-map.yaml`; a domain owner does not create evidence by title alone.
- Every question has exactly one lead, at most two necessary consulted agents and one canonical report. Consulted agents return only new evidence or a role-specific delta.
- Reuse fresh accepted evidence by reference. Do not ask each specialist to repeat discovery, summarize the same source set or produce parallel conclusions.

## Domain ownership

| Domain | Mission | Accountable | Responsible specialists | Independent evidence / custody |
| --- | --- | --- | --- | --- |
| 4.1 Product Management & Strategy | Convert evidence and company direction into product decisions, goals, discovery, PRDs, roadmap proposals, and measurable outcomes | Product & PRD Lead | Brand & UI Quality Reviewer; Documentation & DX Steward | QA validates executable acceptance criteria; Board owns strategy conflicts and priority changes |
| 4.2 Core Product Platform | Preserve the gateway, APIs, governance, routing, context, customer-facing observability, and core architecture as one coherent platform | Engineering Assurance Lead | Principal Platform Architect; Senior Platform Engineer | Independent Code & PR Reviewer; QA & E2E Validation Engineer |
| 4.3 Integrations & Enterprise | Own connector, MCP, identity, permission, delegation, BYO provider/model, and enterprise-capability contracts | Engineering Assurance Lead (temporary) | Principal Platform Architect; Senior Platform Engineer | Independent Reviewer for code/contracts; QA for permission and lifecycle behavior |
| 4.4 Data Platform & AI Quality | Own event/data models, analytics pipelines, transformations, evaluations, benchmarks, experiments, and ML-pipeline quality | Engineering Assurance Lead (temporary, explicit staffing gap) | Principal Platform Architect; QA & E2E Validation Engineer | Independent Reviewer; Reliability for production signals |
| 4.5 Infrastructure & Reliability | Own cloud, IaC, environments, CI/CD, SRE, performance, capacity, incidents, postmortems, and security engineering | Engineering Assurance Lead | Reliability & Incident Response Engineer; Senior Platform Engineer | Independent Reviewer; QA for release and recovery evidence |
| 4.6 Engineering Handbook | Keep architecture principles, ADR/RFC process, development standards, testing strategy, release process, and ways of working explicit and current | Engineering Assurance Lead | Documentation & DX Steward as custodian; chapter owners in `engineering-handbook-index.md` | Independent Reviewer for enforceable technical rules; Board for authority changes |

### Scope boundary

The six domains describe Product & Engineering only. Strategy, Finance, GRC, Marketing & Brand, Sales, and HR remain future company functions. Security engineering belongs in 4.5 for engineering delivery; company-wide legal, regulatory, risk, and compliance governance would be a separate GRC function when created.

## Conditional feature delivery pipeline

```text
Product intent and PRD, when required
  -> Architecture review, when structural
  -> Domain implementation, when approved
  -> Independent change review, when code changed
  -> Functional QA, when behavior changed
  -> UI quality, when a UI surface changed
  -> Documentation/DX, when a public claim changed
  -> Reliability, when runtime or rollout risk changed
  -> Release-readiness evidence, when advancement is requested
  -> Human release decision
  -> Measurement and learning, when fresh outcome evidence exists
```

Every handoff must name the exact revision or object, evidence scope, owner, unresolved decisions, and next gate. A downstream stage may return work to an earlier owner; it must not silently redefine product intent or waive a missing gate.

The diagram describes possible gates, not a requirement to invoke every agent.
Each gate has its own lead request class. Skip Product when intent and acceptance
criteria are unchanged; skip Architecture when no structural decision exists;
skip Senior Engineering when no implementation diagnosis/change exists; skip
Review when no immutable change exists; engage QA, Brand/UI, Documentation/DX,
or Reliability only for their distinct affected evidence; engage Engineering
Assurance only when combined evidence must be judged for advancement. Record why
a material gate is skipped.

The detailed role and deduplication rules live in
`skills/optiak-change-control/references/engineering-engagement-contract.json`.

### Minimum handoffs

1. Product hands an immutable intent/PRD revision and measurable acceptance criteria to the next required gate; Architecture is not mandatory when no structural question exists.
2. Architecture hands an explicit decision, invariants, risks, migration and rollback expectations to the implementation owner when engaged.
3. Implementation hands an immutable diff or PR revision plus focused verification to an independent reviewer.
4. Independent review hands one verdict and unresolved findings to the affected specialist gates; approval does not merge.
5. QA, Brand/UI, Documentation/DX and Reliability each provide only their distinct affected evidence, including exclusions and blocked cases. They do not restate each other's reports.
6. Engineering Assurance indexes those artifacts and identifies gaps without rerunning them. Only the Board may authorize release or another governed action.
7. Product and Engineering compare fresh measured outcomes with the original decision and create follow-up work without rewriting history.

## Intake and routing

- The Director classifies the request by desired decision, affected domain, evidence authority, urgency, environment, and risk.
- The Director or Engineering Assurance selects one of the ten request classes, one lead question and one canonical output before assigning specialists. Each consultation must have a different narrower question and expected evidence delta. Blanket fanout is invalid.
- Product & PRD Lead owns questions about why, for whom, priority, outcome, acceptance criteria, and public product intent.
- Engineering Assurance Lead owns how work crosses technical domains, which gates apply, and whether evidence is sufficient for a Board decision.
- The domain's responsible specialist performs the work; the accountable owner resolves cross-domain coordination without producing a parallel specialist report.
- Engineering Assurance consumes Architecture, Review, QA and Reliability artifacts by reference. It identifies missing gates and risk; it does not rerun their work.
- `fixtures/product-engineering-routing.json` is the regression set. A routing case is valid only when every named agent exists, one accountable owner is explicit, and authored technical changes have a different independent reviewer.

## When to create another agent

Do not create an agent merely because the operating model has a heading. A proposed agent must satisfy all of these gates:

1. A recurring queue exists and has been observed across at least three separate work items or two operating cycles.
2. The work has a stable source of truth.
3. The role produces a bounded, testable deliverable.
4. It needs materially different tools, permissions, context, or review independence from the current owner.
5. The reporting line, accountable owner, handoffs, reviewer, budget, and escalation path are explicit.
6. A fixture-only smoke and a paused import path exist before live activation.
7. Splitting the role reduces a measured bottleneck or control risk; it is not organizational decoration.

The first likely specialization is Data Platform & AI Quality, but it remains a candidate until those gates are met. Until then, Engineering Assurance is accountable, Architecture owns model and pipeline design, and QA owns eval/benchmark execution evidence.

## Change control

Changes to domain names, accountability, the feature pipeline, or agent-creation gates require Product and Engineering review plus Board acceptance. Changes to a responsible specialist or handbook chapter custodian may be proposed within the existing structure, but they must remain versioned and cannot broaden tools, sources, or external mutation authority.
