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

## Phase 2 — internal knowledge, product, and Git read paths

- Role-scoped Product & Engineering knowledge from Notion.
- Backlog/roadmap read access for Product.
- Immutable PR/diff/check reads for reviewers.
- No merge, branch write, issue mutation, or repository write initially.

### Phase 2.0 — Notion Product & Engineering knowledge

The portable authority and desired policy are
`skills/optiak-notion-knowledge/references/notion-authority.yaml` and
`policies/notion-readonly.yaml`. Notion remains the live source; do not export
or snapshot the workspace into this package.

Use the shipped **Notion** app and official endpoint
`https://mcp.notion.com/mcp`. The default setup uses OAuth dynamic client
registration with PKCE: no client ID, client secret, API key, `.env` entry, or
custom Notion integration is required. `http://localhost:3200` is a valid
loopback OAuth origin.

Consent and identity scope:

1. Open `/OPT/apps/connect?source=notion` in the Optiak instance.
2. Start the Notion OAuth flow with the intended identity. The live flow
   observed on 2026-09-19 selected the workspace/account but did **not** offer a
   page or database selector. The resulting token inherits everything that
   identity can access.
3. For a hard provider boundary, authorize a dedicated Notion identity that can
   access only the approved Product & Engineering parents, or place an
   enforcing proxy with an exact root allowlist in front of the provider. The
   current broad human identity may be used only while agents remain paused and
   must not be treated as proof that Finance, Fundraising, Legal/GRC, HR/People,
   Board-private, personal, secret, customer, or production-log pages are
   unreachable.
4. Select **Agents I pick** for both Always installed and Agent access, then
   select the ten current canonical agents. Never select Every/Any agent:
   future agents must receive no implicit access.

Catalog and gateway policy:

1. Set both profile and transport changed-tool behavior to
   `quarantineNewEntries: true` and set `defaultAction: deny`.
2. Refresh the catalog and record its reviewed name/schema/version hash.
3. Enable only the catalog actions **Get tool access**, **Fetch Notion
   entities**, and **Query Notion data sources**. Fetch and query must receive
   exact operator-approved IDs/URLs; they are not discovery tools.
4. Set every other current action off, including Search/AI search, private,
   shared, recent and favorite listings, workspace users/teams, attachments,
   comments, agent sessions, create, update, move, duplicate, archive, delete,
   permission, integration, admin, bulk and unknown actions. The observed
   baseline is exactly `3 Allowed / 0 Ask first / 42 Off`.
5. Add explicit deny rules for the write categories. Do not rely on Notion's S3
   default: the shipped app can otherwise allow reviewed page writes.
6. Do not add an approval override or trust rule for a Notion mutation in v0.1.

Smoke gate before any agent uses Notion evidence:

1. Health succeeds and records the check time.
2. The effective catalog contains exactly the three expected actions, zero
   ask-first actions and 42 off actions; no mutation is runnable.
3. `Get tool access` succeeds as Director over MCP HTTP without arguments.
4. Register exact approved live IDs outside Git. Director then fetches one
   approved strategy or decision page.
5. Product fetches one approved PRD by exact ID; global search remains off.
6. Architect queries or fetches one approved architecture source by exact ID.
7. One task-linked agent fetches its linked source without receiving an
   unrelated root.
8. An excluded or unshared page is refused. Do not share sensitive content just
   to manufacture a negative test.
9. Each result records page/database id or URL, source timestamp when available,
   and retrieval time. Inspect the Paperclip audit row.
10. Revoke or disable the connection and confirm tools disappear, then reconnect
   only if the production grant is still intended.

Until a hard identity/proxy boundary, exact root registry, catalog review,
effective deny policy, and positive/negative content smokes all pass, keep
`notionKnowledge` in `connected_policy_smoke_passed_root_registry_pending`.
Agents must remain paused and return `blocked_on_authority`, not infer current
internal knowledge.

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
   Verify `quarantineNewEntries: true` on both `config` and `transportConfig`,
   not only an instruction in the agent prompt. Preserve `defaultAction: deny`
   and explicit exclusions such as unreviewed notifications. Follow
   [connected review quality](connected-review-quality.md) for the executable
   preflight and reviewed name/schema/version hash baseline.
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

### Phase 2.1b — governed Linear issue creation

This is a separate connection, credential and capability from Phase 2.1. Its
implementation ships offline at `connectors/linear-ticket-publisher` and its
full operator procedure is `linear-ticket-publishing.md`.

- Use a dedicated private Linear OAuth app actor with only `read,issues:create`
  and team access restricted to `OPT`.
- Keep the official `/readonly` MCP connection unchanged for Product queries.
- Start the publisher with its connector-side write mode disabled.
- Install its one tool only for Product with a default-deny profile.
- Place the exact-tool rate limit and `require_approval` policy ahead of the
  broader write block. Test Product as `require_approval` and every other agent
  as denied.
- Never create a trust rule. Each batch needs a fresh action request over the
  complete signed arguments.
- Pass the disabled negative smoke, then one Board-approved canary and exact-ID
  read-back before normal use.
- Treat timeout, lost response, restart, 5xx, malformed response or result
  mismatch as uncertain. Stop for operator reconciliation; never auto-retry.

Importing a package or seeing the tool in a catalog is not connection evidence
and does not enable this phase.

### Phase 2.2 — GitHub source, pull requests, and checks

Board decision recorded on 2026-09-02:

- Approved repositories: `optiak/optiak`, `optiak/optiak-frontend`, and
  `optiak/iac-infra` only.
- Everything else, including `optiak/optiak-tests`, every other infrastructure
  repository, ML, and newly created repositories, is denied by default.
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
2. Select exactly `optiak`, `optiak-frontend`, and `iac-infra`.
3. Set expiration to at most 30 days for the local smoke.
4. Grant repository permissions Actions, Commit statuses, Contents, and Pull
   requests as read-only. Metadata remains the automatic read-only permission.
   Grant no Issues permission. GitHub currently does not support the Checks API
   with fine-grained PATs; record this as a credential limitation.
5. Grant no organization or account permissions and no write permission.
6. If the Optiak organization requires approval, wait for the token to become
   active before creating the Paperclip connection.

Connection contract:

1. Name it `GitHub — Optiak Core Review Read Only`.
2. Use **Connect your own MCP server**, not the curated GitHub card: the generic
   flow is required to set all three headers. If Paperclip offers `Use GitHub`,
   ignore that shortcut.
3. Select **Advanced authentication → Custom headers** and store exactly:
   `Authorization: Bearer <fine-grained PAT>`, `X-MCP-Readonly: true`, and
   `X-MCP-Toolsets: repos,pull_requests,actions`. Paste the PAT only into the
   secret-backed header value; do not put it in `.env`, Git or an agent secret.
4. Immediately replace the generic flow's company-wide default installation
   with Independent Code and PR Reviewer only. Set the app profile to
   `defaultAction: deny` and confirm no other agent has effective reach.
5. Set `quarantineNewEntries: true` on both `config` and `transportConfig`.
   The generic flow defaults this to false, so successful connection setup is
   not evidence that quarantine is enabled.
6. Review the initial catalog. The verified read-only baseline exposes nineteen
   tools. Enable only these fourteen repository-scoped reads:
   `actions_get`, `actions_list`, `get_commit`, `get_file_contents`,
   `get_job_logs`, `get_latest_release`, `get_release_by_tag`, `get_tag`,
   `list_branches`, `list_commits`, `list_pull_requests`, `list_releases`,
   `list_tags`, and `pull_request_read`.
7. Leave `list_repository_collaborators`, `search_code`, `search_commits`,
   `search_pull_requests`, and `search_repositories` off. They are broader than
   the initial review workflow and do not carry the same explicit owner/repo
   shape.
8. Apply the policy chain in ascending priority for the fourteen enabled tools:
   - priority 39: for Independent Reviewer, missing both `owner` and `repo`
     requires approval. This keeps `tools/list` discoverable but parks an
     unscoped invocation before it can reach GitHub;
   - priority 40: allow only Independent Reviewer when `owner == optiak` and
     `repo` is one of `optiak`, `optiak-frontend`, or `iac-infra`;
   - priority 50: block every remaining call for the same connection and tools.
9. Reject any write-capable catalog entry even if GitHub or Paperclip later adds
   it to a selected toolset. Keep every newly discovered tool quarantined until
   manual review.

Smoke gate before the Reviewer may use GitHub evidence:

1. Connection health succeeds and its check time is recorded.
2. The effective catalog contains only read operations; create, update,
   comment, review submission, branch, workflow, merge, release, and deployment
   tools are absent or disabled.
3. A bounded metadata read succeeds for all three approved repositories.
4. One exact file or commit can be read by immutable SHA from each approved
   repository.
5. For one known pull request, resolve and record base SHA, head SHA, diff,
   Actions runs, and commit statuses available for that same head. If there is
   no suitable pull request, record that gap rather than inventing a pass. If a
   required result exists only through the unsupported Checks API, record
   `blocked_on_evidence` rather than treating it as passed.
6. Confirm policy refuses `optiak/optiak-tests` and every unlisted repository.
   Do not probe unrelated private repositories merely to demonstrate denial.
7. Do not attempt a mutation as a negative test; the read-only endpoint,
   catalog inspection, token permissions, and policy denial are the proof.
8. Inspect the Paperclip audit record, then verify the token can be revoked
   independently.

For `optiak/iac-infra`, the smoke is limited to repository metadata and an exact
file or commit read. Do not retrieve Terraform state, plan output or secrets;
do not call cloud APIs or execute Terraform. Repository source proves declared
intent, not applied infrastructure.

Until all eight checks pass, keep `gitProvider` and `repositories` pending,
keep the Reviewer paused outside the bounded smoke, and do not issue a live PR
verdict. The local 2026-09-19 smoke passed health, bounded reads, exact-SHA
reads, policy denial, audit, pull-request detail/diff, Actions and commit-status
checks. Full Check Runs remain unavailable with the initial fine-grained PAT,
so any verdict requiring them must still return `blocked_on_evidence`. A later
production credential should use a dedicated GitHub App rather than extending
this personal token indefinitely; that migration is required before claiming
complete Check Runs coverage.

## Phase 3 — isolated implementation

- Connect only approved repositories.
- Use an isolated workspace/branch for Senior Platform Engineer.
- Require independent reviewer and tests before any human merge decision.
- Keep merge and deploy outside the agent tool catalog.

## Phase 4 — observability and alerting

- Apply `runbooks/observability-and-oncall.md` and the machine-readable contract
  at `skills/optiak-incident-triage/references/observability-source-contract.json`.
- Connect bounded aggregate analytics first, then deployment proof, reviewed
  metrics, exact ask-first traces, redacted error indexes, and finally signed
  alert ingestion. Use separate read-only identities.
- Keep raw events, application stdout logs, broad trace search, attachments, and
  Sentry session replay denied until a separately reviewed contract exists.
- Verify redaction, query limits, tenant/environment scoping, freshness,
  deduplication, acknowledgement, credential revocation, and auditable wake paths.
- Run the fresh, partial, stale, and disconnected tabletop cases before claiming
  on-call coverage. No inference or observability connection is required for the
  offline contract checks; connected proof waits for a deployed environment.

## Phase 5 — targeted governed actions

Only after stable read paths: exact staging test mutations, review comments, or branch proposals may be considered. Every capability needs connector kill switch, idempotency where applicable, approval policy, audit, rollback/cleanup, and revocation proof.

Any new tool discovered in a connector remains quarantined until reviewed against `policies/tool-allowlist.yaml`.
