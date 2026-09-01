# Connection rollout

Connections are instance state and secret bindings; they are not exported in this package. Add one phase at a time.

## Phase 0 — public documentation

- Allow only the reviewed `docs.optiak.dev` source map.
- Record retrieval time and failure explicitly.
- No publishing or whole-site mirroring.

## Phase 1 — staging validation

- Dedicated staging tenant and synthetic personas.
- Browser read profile first.
- Sandbox application API key with bounded provider spend.
- Synthetic naming, cleanup owner, abort conditions, and production-host denial.
- Enable writes only for exact reviewed staging test tools after manual approval.

## Phase 2 — product and Git read paths

- Backlog/roadmap read access for Product.
- Immutable PR/diff/check reads for reviewers.
- No merge, branch write, issue mutation, or repository write initially.

## Phase 3 — isolated implementation

- Connect only approved repositories.
- Use an isolated workspace/branch for Senior Platform Engineer.
- Require independent reviewer and tests before any human merge decision.
- Keep merge and deploy outside the agent tool catalog.

## Phase 4 — observability and alerting

- Read-only metrics, logs, traces, deploy/status metadata, and alert ingestion.
- Redaction, query limits, tenant/environment scoping, freshness, deduplication, and auditable wake paths.
- Run an incident tabletop before claiming on-call coverage.

## Phase 5 — targeted governed actions

Only after stable read paths: exact staging test mutations, review comments, or branch proposals may be considered. Every capability needs connector kill switch, idempotency where applicable, approval policy, audit, rollback/cleanup, and revocation proof.

Any new tool discovered in a connector remains quarantined until reviewed against `policies/tool-allowlist.yaml`.
