# Local setup

Optiak must run in a Paperclip instance separate from Enki. Sharing this Git repository is safe; sharing the runtime database, persistent storage, secret store, ports, or Compose project is not the intended setup.

## Before import

1. Check out `integration/companies` or an approved Optiak feature branch.
2. Install the publisher's exact locked dependencies with
   `npm ci --prefix companies/optiak-ai-os/connectors/linear-ticket-publisher --ignore-scripts`,
   then run `./companies/optiak-ai-os/scripts/check.sh`.
3. Build the deterministic import ZIP outside the package.
4. Create the separate Optiak Paperclip instance with its own Compose project name, host port, public URL, data directory, authentication secret, and Codex home.
5. Confirm the Enki and Optiak containers mount different host data directories.
6. Complete first-admin setup and Codex authentication only in the Optiak instance.
7. Create a database and storage backup before each material import after initial setup.

Do not store the instance environment file in this repository. When the operator is ready, use the root Docker quickstart with values equivalent to:

- Compose project: `paperclip-optiak`
- Host port: a free port different from Enki, for example `3200`
- Public URL: the matching loopback URL
- Data directory: a dedicated Optiak directory

Review the current `docker/docker-compose.quickstart.yml` before executing commands because upstream configuration may change.

The versioned helper applies those values without creating a repository `.env`:

```sh
./companies/optiak-ai-os/scripts/local-instance.sh up --build
./companies/optiak-ai-os/scripts/local-instance.sh health
./companies/optiak-ai-os/scripts/local-instance.sh ps
```

It creates `data/docker-paperclip-optiak/.better-auth-secret` on first use with mode `0600`. Both the data directory and secret are ignored by Git. The secret value is never printed. The helper composes the root quickstart with `runtime/docker-compose.paperclip.yml`, which:

- sets the instance id to `optiak`, giving its files and auth cookies a namespace separate from Enki;
- keeps authentication request-derived and explicitly trusts only the configured local public URL when host port `3200` maps to container port `3100`;
- advertises `http://localhost:3100` to agents and the managed MCP running inside the container, while the browser and host CLI continue to use `http://localhost:3200`;
- prevents local login redirects from being rewritten to the Enki instance on `3100`.

Do not point in-container `PAPERCLIP_API_URL` at host port `3200`: that port exists on the Docker host, not on the container loopback interface.

The current shared container cannot start Codex's Bubblewrap sandbox under Docker's built-in seccomp profile. Keep the versioned legacy Landlock fallback and follow `sandbox-migration.md`; removing the warning without passing its `--require-ready` probe would break agent commands. Never add broad Docker privileges to this control-plane service as a workaround.

To stop Optiak without touching Enki:

```sh
./companies/optiak-ai-os/scripts/local-instance.sh stop
```

`down` removes only the Optiak container and private network. It does not pass `--volumes`, and the persistent bind-mounted data remains in `data/docker-paperclip-optiak`.

## Import

1. Import preview the exact ZIP.
2. Verify ten agents, fifteen skills, six projects, twenty-one tasks, and four disabled routines.
3. Confirm one root (`director-optiak`) and the expected reporting tree.
4. Apply with agents and routines paused.
5. Configure no connection during the import itself.
6. Reconcile and verify the company and agent budget policies using `execution-budgets.md`.
7. Run the fixture-only smoke test before activating the Director.

For a later update that must replace already-installed package skills, use the Board import preview/apply flow and verify the exact replacement set. The existing-company CLI route is intentionally safe and rejects `collisionStrategy: replace`; do not use `rename`, because it would create duplicate skills.

For `0.1.12`, preview/apply only `agents,skills` against the existing company:
ten existing agents and thirteen skills, no new agents/skills, and no company,
project, task or routine import. The new helper scripts must appear in the
installed durable-completion skill inventory and their retrieved bytes must
match the source; a README or successful ZIP build alone does not prove that.
Verify the same live issue count before/after import, all agents paused, all
schedule triggers disabled, existing budget caps and unchanged Linear access.
Then follow `connected-review-quality.md` for one fixture-only manual smoke
and a repeated QA-document annotation. Source-control signing or live checks
left incomplete must be recorded; they do not authorize production promotion.

`0.1.13` adds an offline Linear privacy candidate. It is not a deployed connector
and importing the package cannot activate its response projection. Keep the
last validated runtime in place until the separate placement/authentication,
content-access and live-audit gates in `connectors/linear-privacy/README.md` pass.

`0.1.14` changes no agent count, reporting line, adapter, skill behavior,
project, task, routine, connection, or runtime permission. It versions the
six-domain Product & Engineering operating model, updates instructions for the
existing ten agents, and advances the package identity embedded in the
release-readiness promotion contract. For an existing company, preview
replacement of the ten agents and `optiak-release-readiness`; if the import UI
cannot select one skill independently, replace the existing thirteen skills
after confirming the preview creates none. Keep all agents paused and verify
that projects, issues, connections, policies, and routine triggers are
unchanged. Importing the package does not create the Data Platform & AI Quality
candidate role or grant access to a source.

`0.1.15` adds one Product skill and an offline Linear ticket-publisher runtime.
For an existing company, preview replacement of Product & PRD Lead and the
fourteen existing skills; if selective replacement is unavailable, replace the
ten existing agents and fourteen skills only. Create no project, issue, routine
or company copy. The import must not create or modify any connection, policy,
credential, OAuth grant, Docker service or journal. Keep the publisher disabled
until every step in `linear-ticket-publishing.md` passes.

`0.1.17` adds no agent, skill, project, task, routine or connector. It records
the verified GitHub connection procedure and its three-policy chain after the
local smoke exposed unsafe generic defaults: company-wide installation and no
catalog quarantine. No agent or skill content changes from `0.1.16`, so an
existing instance does not need another agent/skill import solely for this
runbook release. The package still creates no live connection, credential or
policy; apply the runbook manually and keep the Reviewer paused outside bounded
smokes until a deliberate Board activation.

`0.1.18` adds `optiak-frontend-implementation`, updates
`optiak-pr-review`, and updates Senior Platform Engineer and Independent
Reviewer instructions. For an existing company, preview replacement of those
two agents and `optiak-pr-review`, plus creation of exactly one skill. If the UI
cannot select that exact subset, replace all ten existing agents and fourteen
installed package skills, and create only `optiak-frontend-implementation`.
Keep every agent paused. The preview must create no project, issue, routine,
connection, policy, credential or repository workspace. Importing the skill
does not connect a writable repository; frontend implementation remains
`blocked_on_workspace` until a separately approved Paperclip execution
workspace is configured.

`0.1.19` adds `optiak-notion-knowledge` to all ten agents and versions the
Notion authority, access matrix, connection runbook, and default-deny policy.
For an existing company, preview replacement of all ten agents and the fifteen
installed package skills, plus creation of exactly one skill. Create no company,
project, issue, routine, connection, policy, credential, OAuth grant, page copy,
or workspace. Keep every agent paused. Importing the package does not grant
Notion access; complete Phase 2.0 of `connections.md` separately.

`0.1.20` corrects the connection contract after live validation. The hosted
OAuth flow inherits the authorizing user's workspace access and exposes no page
selector. Replace only `optiak-notion-knowledge` when upgrading an instance that
already imported `0.1.19`; agent definitions are unchanged. Reapply the manual
connection profile so both access selectors name the ten current agents and the
catalog reads exactly `3 Allowed / 0 Ask first / 42 Off`. Keep all agents paused
until a dedicated restricted identity or enforcing proxy and an exact approved
root registry pass the content smoke.

`0.1.26` keeps the mandatory read-only parity check after preview/apply and before
any agent resume. Export the live agent list through the authenticated Board CLI
and stream it to the checker; do not put an API key on the command line or save
the raw snapshot in Git:

```sh
paperclipai agent list \
  --api-base http://localhost:3200 \
  --company-id <optiak-company-id> \
  --json \
  | node companies/optiak-ai-os/scripts/check-live-agent-parity.mjs \
      --snapshot - --pretty
```

The only passing verdict is `pass`. `drift` blocks activation and requires a
Board-reviewed repair followed by another clean check. The checker never repairs
or activates agents. It reconciles by the stable package agent name, reports
portable slugs, and emits no
database IDs, local instruction paths, metadata or credentials.

Then prove the Director's effective authority with the Board CLI already
authenticated. The proof reads the live agent detail, creates one short-lived
agent API key, calls a read-only endpoint protected by `agents:create`, requires
the real API to return `403`, and revokes the key in a `finally` block. It never
prints the key, creates an agent, or activates anything:

```sh
node companies/optiak-ai-os/scripts/prove-director-authority.mjs \
  --api-base http://localhost:3200 \
  --company-id <optiak-company-id> \
  --pretty
```

The only passing result has `roleIsNonLegacyRoot`,
`taskAssignmentUsesExplicitGrant`, `forbiddenGrantsAbsent`,
`agentCreationDenied`, and `ephemeralKeyRevoked` all set to `true`. Any other
result blocks activation. If cleanup fails, revoke the key named
`oai-043-proof-*` from the Director before retrying.

The same release defines, but does not configure, isolated implementation
workspaces. Follow `runbooks/execution-workspaces.md` when `OAI-042` is resumed.
Importing `0.1.26` must not create a repository workspace, branch, sandbox environment or persistent credential.
