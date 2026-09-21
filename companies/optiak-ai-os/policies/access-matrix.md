# Desired access matrix

This is versioned desired state, not proof of live Paperclip bindings. Apply profiles manually in the separate Optiak instance and verify effective access before activation.

| Role | Notion knowledge | Public docs | Backlog/roadmap | Git/PR | Repositories | Local test UI/API | Staging UI/API | Observability | Production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Director | strategy, roadmap intent, decisions, handbook, reliability | read | read/triage | status/read | no code write | status/read | status/read | aggregate read | aggregate read |
| Engineering Assurance Lead | linked specs, architecture, handbook, reliability | read | linked intent | review/status | read | read/test evidence | read/test evidence | read | read |
| Product & PRD Lead | product, discovery, roadmap intent, brand, docs | read | read/triage; exact issue creation ask-first after separate smoke | linked intent | no | read after approval | read | product aggregate | no |
| Principal Architect | linked specs, architecture, handbook, reliability | read | linked intent | immutable review | read | read after approval | read | read | read |
| Senior Platform Engineer | task-linked specs, ADRs, handbook, runbooks | read | assigned task | branch proposal later | isolated workspace later | approved sandbox later | approved sandbox later | read | read-only diagnosis |
| Independent Reviewer | task-linked specs, ADRs, handbook | read | acceptance criteria | immutable read/review for the three approved repositories only | exact-revision read for approved repos only | read after approval | read | read | read |
| Reliability Engineer | architecture, handbook, runbooks, postmortems | runbooks | incident work | deploy/revision read | read | health/read | read | read/alert | read-only diagnosis |
| QA Engineer | task-linked specs, ADRs, test/release standards, runbooks | read | acceptance criteria | revision/check read | exact-revision profile execution pending dedicated runner; no source write | source static/unit pending runner; synthetic later | approved sandbox later | test/read | no test access |
| Brand/UI Reviewer | relevant specs, discovery, brand/design/UX | read | linked intent | preview/status | no source write | browser read later | browser read later | no | no |
| Documentation/DX | relevant specs, architecture, handbook, docs/DX | read | linked intent | docs diff review | docs read later | read after approval | read | no | no |

No role has merge, deploy, production mutation, infrastructure mutation, secret administration, user impersonation, billing mutation, or policy-bypass authority in v0.1.

During the current advisory/read-only phase, every cell marked `later` is an
explicit denial rather than latent authority. Senior Platform Engineer may
analyze and draft from approved read sources but may not receive an isolated
implementation workspace or create repository changes until the Board resumes
`OAI-011` and `OAI-042`.

The portable local target in v0.1.29 defaults to credential-free reachability.
No role receives an authenticated browser session, application credential, or
synthetic write until every environment-contract gate passes. Production test
access is denied; future production observability reads are a separate policy.
Local inference is deliberately deferred to a deployed inference environment
and is not required for offline package, policy, or observability-contract
validation.

QA has a separate source-execution contract for the three approved repositories.
It permits only named static/unit profiles at a full commit SHA inside a fresh
dedicated runner. The live runner is not connected yet, so the desired grant is
currently denied rather than silently falling back to the Paperclip container
or a developer checkout. Repository credentials must disappear before tests
execute; production credentials, customer data, arbitrary shell, Docker socket,
push, PR creation, deployment and Terraform plan/apply/destroy/state remain
denied. This capability produces test evidence only and never grants Senior
Engineering an implementation workspace.

Observability access is desired state, not a live grant. Reliability receives
bounded aggregate analytics first; one exact trace is ask-first. Raw events,
unstructured application logs, broad trace search, Sentry session replay,
attachments, prompts, responses, tool payloads, and customer identifiers remain
denied. No role receives automatic on-call coverage until the signed-alert
tabletop and source-specific smokes pass.

The initial GitHub grant is installed only for Independent Reviewer. It does not
grant Git access to the Director, Engineering Assurance, Architecture,
Engineering, QA, Product, Brand/UI, Reliability, or Documentation agents. The
default for every repository except `optiak/optiak`,
`optiak/optiak-frontend`, and `optiak/iac-infra` is deny. Access to the IaC
repository is immutable read/review only and does not grant Terraform, cloud,
state, plan, apply, secret, deployment, or runtime authority.

Product's optional Linear publisher is a separate connection from the read-only
backlog source. It exposes one batch-create tool, starts disabled, is bound only
to Product, requires an exact gateway action approval on every call and may not
be converted into a trust rule. It creates only unassigned issues in team `OPT`;
all issue edits, comments, assignments, relationships, state changes, archives,
deletes and generic GraphQL remain denied.

Promotion evidence may be read and evaluated offline, but no role may deploy,
import into a hosted target, restore data, activate an agent, or enable a routine.
Each stage requires an exact Board decision outside the evaluator.

The Director remains the only organizational root but uses the non-privileged
`general` role. It may assign tasks only through the explicit portable
`tasks:assign` grant. `agents:create` is forbidden both as a stored permission
and as a principal grant; agent creation remains Board-only.

Notion access is read-only and logically root-scoped. The observed hosted OAuth
flow inherits the authorizing user's access and offers no page selector, so the
current user grant is not by itself a hard content boundary. Paperclip binds the
connection to the ten current agents and allows only exact fetch/query plus
capability discovery; global search, listings, user data and every write are
off. Before agent activation, use a dedicated restricted Notion identity or an
enforcing root allowlist proxy and register exact approved page/data-source IDs
outside Git. All ten agents carry the retrieval contract and are limited to the
role-specific logical roots in
`skills/optiak-notion-knowledge/references/notion-authority.yaml`. Notion is
authority for approved intent and knowledge, Linear for current execution state,
GitHub for implementation at an immutable revision, and Paperclip for AI-work
coordination and approvals. Conflicts are reported with provenance and a human
owner; no source is silently overwritten or merged.
