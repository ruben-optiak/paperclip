# Desired access matrix

This is versioned desired state, not proof of live Paperclip bindings. Apply profiles manually in the separate Optiak instance and verify effective access before activation.

| Role | Public docs | Backlog/roadmap | Git/PR | Repositories | Local test UI/API | Staging UI/API | Observability | Production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Director | read | read/triage | status/read | no code write | status/read | status/read | aggregate read | aggregate read |
| Engineering Assurance Lead | read | linked intent | review/status | read | read/test evidence | read/test evidence | read | read |
| Product & PRD Lead | read | read/triage | linked intent | no | read after approval | read | product aggregate | no |
| Principal Architect | read | linked intent | immutable review | read | read after approval | read | read | read |
| Senior Platform Engineer | read | assigned task | branch proposal later | isolated workspace later | approved sandbox later | approved sandbox later | read | read-only diagnosis |
| Independent Reviewer | read | acceptance criteria | immutable read/review for `optiak` and `optiak-frontend` only | exact-revision read for approved repos only | read after approval | read | read | read |
| Reliability Engineer | runbooks | incident work | deploy/revision read | read | health/read | read | read/alert | read-only diagnosis |
| QA Engineer | read | acceptance criteria | revision/check read | no source write | health only now; synthetic later | approved sandbox later | test/read | no test access |
| Brand/UI Reviewer | read | linked intent | preview/status | no source write | browser read later | browser read later | no | no |
| Documentation/DX | read | linked intent | docs diff review | docs read later | read after approval | read | no | no |

No role has merge, deploy, production mutation, infrastructure mutation, secret administration, user impersonation, billing mutation, or policy-bypass authority in v0.1.

The portable local target in v0.1.14 defaults to credential-free reachability.
No role receives an authenticated browser session, application credential, or
synthetic write until every environment-contract gate passes. Production test
access is denied; future production observability reads are a separate policy.
Local inference is deliberately deferred to a deployed inference environment
and is not required for offline package, policy, or observability-contract
validation.

Observability access is desired state, not a live grant. Reliability receives
bounded aggregate analytics first; one exact trace is ask-first. Raw events,
unstructured application logs, broad trace search, Sentry session replay,
attachments, prompts, responses, tool payloads, and customer identifiers remain
denied. No role receives automatic on-call coverage until the signed-alert
tabletop and source-specific smokes pass.

The initial GitHub grant is installed only for Independent Reviewer. It does not
grant Git access to the Director, Engineering Assurance, Architecture,
Engineering, QA, Product, Brand/UI, Reliability, or Documentation agents. The
default for every repository except `optiak/optiak` and
`optiak/optiak-frontend` is deny.

Promotion evidence may be read and evaluated offline, but no role may deploy,
import into a hosted target, restore data, activate an agent, or enable a routine.
Each stage requires an exact Board decision outside the evaluator.
