# Engineering Handbook index

This is a custody and authority index, not a copy of Optiak's future handbook. A chapter marked `source pending` has no implementation authority until its approved versioned source is connected and reviewed.

| Chapter | Accountable | Draft / maintenance owner | Independent reviewer | Current state | Minimum contents |
| --- | --- | --- | --- | --- | --- |
| Architecture principles | Engineering Assurance Lead | Principal Platform Architect | Independent Code & PR Reviewer | source pending | Platform boundaries, tenancy, compatibility, trust boundaries, data ownership, failure and migration principles |
| ADR / RFC process | Engineering Assurance Lead | Principal Platform Architect | Product & PRD Lead for product impact; Independent Reviewer for enforceability | source pending | Decision threshold, template, authorities, alternatives, supersession, rollout and rollback |
| Development standards | Engineering Assurance Lead | Senior Platform Engineer | Independent Code & PR Reviewer | source pending | Change size, contracts, typing, error handling, migrations, observability, documentation and secure defaults |
| Testing strategy | Engineering Assurance Lead | QA & E2E Validation Engineer | Independent Code & PR Reviewer | source pending | Unit, integration, contract, E2E, permission, recovery, performance and evidence requirements |
| Release process | Engineering Assurance Lead | Reliability & Incident Response Engineer | QA & E2E Validation Engineer | source pending | Candidate identity, gates, environment evidence, change control, rollback and post-release checks |
| Engineering ways of working | Engineering Assurance Lead | Documentation & DX Steward | Product & PRD Lead | source pending | Intake, ownership, handoffs, reviews, blocking, incident collaboration and durable decisions |
| Documentation and developer experience | Product & PRD Lead | Documentation & DX Steward | QA & E2E Validation Engineer | source pending | Public claims, examples, API contract drift, deprecation and verification |
| Security engineering | Engineering Assurance Lead | Principal Platform Architect and Reliability Engineer | Independent Code & PR Reviewer | source pending | Threat modeling, secrets, permissions, abuse cases, incident response and change gates |

## Chapter lifecycle

`proposal -> owner review -> independent review -> Board acceptance when authority changes -> versioned publication -> scheduled drift review -> superseded, never silently overwritten`

Each chapter must name its source revision, effective scope, exceptions, owner, reviewer, approval evidence, last review date, and superseded revision. A handbook statement cannot override code, API, runtime, security, or governance evidence with a stronger authority class.
