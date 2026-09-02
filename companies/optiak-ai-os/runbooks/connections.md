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

### Phase 2.1 — Linear product authority

Board decision recorded on 2026-09-02:

- Authority location: `https://linear.app/optiak/team/OPT/`.
- Human conflict owner: Board.
- Initial access: the official Linear-hosted remote MCP server, read-only.
- Canonical policy: `skills/optiak-product-triage/references/product-authority.yaml`.

Use `https://mcp.linear.app/mcp/readonly`. Linear documents that this endpoint
only exposes read tools and supports OAuth 2.1 dynamic client registration. The
current Paperclip Linear gallery card targets the read-write `/mcp` endpoint and
asks for a customer-owned OAuth app, so this phase must use **Apps → Connect your
own MCP server** with the official `/readonly` URL until the curated card offers
an equivalent reviewed read-only method. This is still Linear's official server;
no third-party plugin or locally stored API key is involved.

Initial connection contract:

1. Name the connection `Linear — Optiak Product Read Only`.
2. Use automatic OAuth and an organization credential grant authorized by the Board account.
3. Install it only for `product-prd-lead`; do not install company-wide.
4. Authorize the Optiak workspace and keep the operational query scope on team `OPT`.
5. Enable only catalog entries classified as reads. If any create, update, comment, assignment, archive, delete, export, or admin action appears, leave it disabled and quarantined.
6. Keep every newly discovered tool quarantined until manual review.
7. Do not paste OAuth tokens, API keys, client secrets, connection IDs, or workspace IDs into Git, issues, comments, screenshots, or agent environment variables.

Smoke gate before Product may use the source:

1. Health check succeeds and records its check time.
2. Catalog refresh exposes zero write-capable tools from the `/readonly` endpoint.
3. A bounded read identifies the Optiak workspace and team `OPT`.
4. One exact known issue can be read by identifier without PII or a bulk listing.
5. A request outside the approved team is denied or the agent refuses it under the source policy.
6. No Linear mutation is attempted as a negative test; absence/quarantine of write tools is the proof.
7. Revocation behavior and Paperclip audit entries are inspected before wider installation.

Until all seven checks pass, keep `roadmapBacklog` as
`authorized_pending_oauth` or `connected_pending_smoke`, keep Product paused, and
report backlog state as unavailable. After the smoke, change it to
`connected_read_only` and run the existing Product task manually before enabling
any routine.

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
