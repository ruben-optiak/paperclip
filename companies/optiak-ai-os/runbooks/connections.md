# Connection rollout

Connections are instance state and secret bindings; they are not exported in this package. Add one phase at a time.

## Phase 0 — public documentation

- Allow only the reviewed `docs.optiak.dev` source map.
- Record retrieval time and failure explicitly.
- No publishing or whole-site mirroring.

## Phase 1 — local and staging validation

Follow `test-environment.md` and the canonical contract in
`optiak-e2e-validation/references/test-environment-contract.json`.

### Phase 1.1 — local reachability

- Exact loopback endpoints only.
- Credential-free `GET` health and public-entry checks only.
- Local source revisions must be recorded and re-probed for every run.
- HTTP reachability is not browser, authentication, inference, staging, or
  release evidence.
- Local writes remain denied while tenant data classification is unknown.

### Phase 1.2 — connected synthetic validation

- Approve either one dedicated local tenant or one dedicated staging tenant;
  never relabel local as staging.
- Provision synthetic admin, member, outsider, and application-client personas.
- Connect the browser to the exact approved control-plane host.
- Keep browser session, application credential, and provider credential in
  separate least-privilege boundaries.
- Approve and externally enforce the initial USD 1, twelve-request, 128-output-
  token, zero-retry ceiling.
- Use exact synthetic naming, inventory, cleanup owner, abort conditions, and
  production-host denial.
- Enable Yellow writes only for exact reviewed test tools after manual
  approval. Orange and Red operations remain unavailable.

### Phase 1.3 — staging evidence

- Record an immutable deployed version, not only a branch name.
- Repeat every target, persona, budget, catalog, cleanup, and denial gate.
- Only a fully approved staging run can produce staging or release evidence.

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

### Phase 2.2 — GitHub source, pull requests, and checks

Board decision recorded on 2026-09-02:

- Approved repositories: `optiak/optiak` and `optiak/optiak-frontend` only.
- Everything else, including `optiak/optiak-tests`, infrastructure, ML, and
  newly created repositories, is denied by default.
- Initial identity: a GitHub fine-grained personal access token.
- Initial audience: `independent-code-reviewer` only.
- Canonical policy: `skills/optiak-pr-review/references/repository-authority.yaml`.

Use GitHub's provider-hosted remote MCP endpoint
`https://api.githubcopilot.com/mcp/readonly`. Configure both the endpoint's
read-only path and header `X-MCP-Readonly: true`. Limit the catalog with
`X-MCP-Toolsets: repos,pull_requests,actions`. Read-only mode is the security
boundary; the selected toolsets reduce context and exposed surface.

Create a fine-grained token with:

1. Resource owner `optiak` and repository access **Only select repositories**.
2. Select exactly `optiak` and `optiak-frontend`.
3. Set expiration to at most 30 days for the local smoke.
4. Grant repository permissions Actions, Checks, Commit statuses, Contents,
   Issues, and Pull requests as read-only. Metadata remains the automatic
   read-only permission.
5. Grant no organization or account permissions and no write permission.
6. If the Optiak organization requires approval, wait for the token to become
   active before creating the Paperclip connection.

Connection contract:

1. Name it `GitHub — Optiak Core Review Read Only`.
2. Use bearer-token authentication and paste the token only into Paperclip's
   credential field; do not put it in `.env` or an agent secret.
3. Set the endpoint and both headers exactly as above.
4. Install the connection only for Independent Code and PR Reviewer.
5. Keep every newly discovered tool quarantined until manual review.
6. Reject any write-capable catalog entry even if GitHub or Paperclip later adds
   it to a selected toolset.

Smoke gate before the Reviewer may use GitHub evidence:

1. Connection health succeeds and its check time is recorded.
2. The effective catalog contains only read operations; create, update,
   comment, review submission, branch, workflow, merge, release, and deployment
   tools are absent or disabled.
3. A bounded metadata read succeeds for both approved repositories.
4. One exact file or commit can be read by immutable SHA from each approved
   repository.
5. For one known pull request, resolve and record base SHA, head SHA, diff, and
   checks/statuses for that same head. If there is no suitable pull request,
   record that gap rather than inventing a pass.
6. Confirm policy refuses `optiak/optiak-tests` and every unlisted repository.
   Do not probe unrelated private repositories merely to demonstrate denial.
7. Do not attempt a mutation as a negative test; the read-only endpoint,
   catalog inspection, token permissions, and policy denial are the proof.
8. Inspect the Paperclip audit record, then verify the token can be revoked
   independently.

Until all eight checks pass, keep `gitProvider` and `repositories` pending,
keep the Reviewer paused outside the bounded smoke, and do not issue a live PR
verdict. A later production credential should use a dedicated GitHub App rather
than extending this personal token indefinitely.

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
