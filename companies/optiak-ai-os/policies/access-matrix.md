# Desired access matrix

This is versioned desired state, not proof of live Paperclip bindings. Apply profiles manually in the separate Optiak instance and verify effective access before activation.

| Role | Public docs | Backlog/roadmap | Git/PR | Repositories | Staging UI/API | Observability | Production |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Director | read | read/triage | status/read | no code write | status/read | aggregate read | aggregate read |
| Engineering Assurance Lead | read | linked intent | review/status | read | read/test evidence | read | read |
| Product & PRD Lead | read | read/triage | linked intent | no | read | product aggregate | no |
| Principal Architect | read | linked intent | immutable review | read | read | read | read |
| Senior Platform Engineer | read | assigned task | branch proposal later | isolated workspace later | approved sandbox later | read | read-only diagnosis |
| Independent Reviewer | read | acceptance criteria | immutable review/comment later | read | read | read | read |
| Reliability Engineer | runbooks | incident work | deploy/revision read | read | read | read/alert | read-only diagnosis |
| QA Engineer | read | acceptance criteria | revision/check read | no source write | approved sandbox later | test/read | non-destructive read |
| Brand/UI Reviewer | read | linked intent | preview/status | no source write | browser read later | no | no |
| Documentation/DX | read | linked intent | docs diff review | docs read later | read | no | no |

No role has merge, deploy, production mutation, infrastructure mutation, secret administration, user impersonation, billing mutation, or policy-bypass authority in v0.1.
