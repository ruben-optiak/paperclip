# Local setup and import

Run commands from the Paperclip repository root. Do not delete volumes or run `docker compose down -v`.

## 1. Back up the current company

In Paperclip, select the existing Enki company and use **Company settings → Export**. Save the archive outside this repository and record its timestamp. Confirm the company currently has no agents before relying on a zero-collision preview.

## 2. Validate source

```sh
pnpm install --frozen-lockfile
npm --prefix companies/enki-hogar-ai-os/connectors/woocommerce-readonly-mcp ci --ignore-scripts
npm --prefix companies/enki-hogar-ai-os/connectors/catalog-knowledge ci --ignore-scripts
npm --prefix companies/enki-hogar-ai-os/connectors/content-publisher ci --ignore-scripts
companies/enki-hogar-ai-os/scripts/check.sh
```

Create an environment file outside Git from `.env.example`. Generate fresh, independent bearer/database values and use a WooCommerce key whose permission is actually **Read**. Prepare ADC and the GSC OAuth token as described in [connections](connections.md). The product-support admin password, reader password and MCP bearer must all differ; leave optional embedding values empty for the initial lexical setup. Initialize Paperclip's exact-action signing secret and the independent publishing bearer without printing either value, then keep the connector disabled:

```sh
node companies/enki-hogar-ai-os/scripts/init-local-control-plane-secrets.mjs \
  --env-file /path/to/untracked-enki.env
node companies/enki-hogar-ai-os/scripts/init-local-publishing-secrets.mjs \
  --env-file /path/to/untracked-enki.env
```

The action-signing secret must differ from `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, and every connector bearer. It is projected only into Paperclip. Rotating it invalidates approvals that are still pending, so drain or reject those approvals before rotation.

Provider credentials are optional at startup. Add the WordPress/Meta values only after following the publishing section of the connections runbook; do not change `CONTENT_PUBLISH_WRITE_MODE=disabled` yet.

Set `GOOGLE_ADC_HOST_PATH`, `GOOGLE_OAUTH_CLIENT_HOST_PATH`, and `GSC_TOKEN_HOST_DIR` to canonical **absolute host paths**. Relative paths are unsafe here because Compose resolves them against the directory of the first `-f` file (`docker/` in the supported command below), not against the environment file. Refuse to start if any value is relative.

## 3. Start Paperclip and prove the gateway

Start Paperclip first, without external data connectors:

```sh
docker compose \
  -f docker/docker-compose.quickstart.yml \
  up -d --build
```

Create a separate paused preflight company and complete [the gateway preflight](gateway-preflight.md). Do not install the fixture into the Enki target company.

## 4. Start integrations

Build the versioned Telegram plugin before Compose mounts it into Paperclip:

```sh
pnpm --filter @enki-hogar/telegram-gateway build
```

Use the same Compose project by passing both files in one command:

```sh
docker compose \
  --env-file /path/to/untracked-enki.env \
  -f docker/docker-compose.quickstart.yml \
  -f companies/enki-hogar-ai-os/runtime/docker-compose.integrations.yml \
  up -d --build
```

This recreates changed services but does not remove the Paperclip data mount or unrelated Docker data. Never add `-v` to teardown commands.

Check non-sensitive health endpoints:

```sh
curl -fsS http://127.0.0.1:8020/health
curl -fsS http://127.0.0.1:8010/health
curl -fsS http://127.0.0.1:8011/health
curl -fsS http://127.0.0.1:8012/health
curl -fsS http://127.0.0.1:8030/health
curl -fsS http://127.0.0.1:8040/health
```

The extra Compose file also bind-mounts the built Telegram plugin read-only at `/plugins/enki-telegram-gateway` inside the Paperclip container. It does not receive the Telegram token through Compose. It creates the package-scoped `enki-product-support-db-data` volume for the rebuildable support projection and `enki-content-publication-journal` for idempotency evidence; both are separate from Paperclip and every unrelated Docker volume. Never run `down -v`.

## 5. Preview and import

Build a fresh archive; the script validates the package and scans it for secrets before writing anything:

```sh
companies/enki-hogar-ai-os/scripts/build-import-zip.sh /tmp/enki-hogar-ai-os-v0.6.0.zip
```

Use the generated raw ZIP as the source. The current Paperclip CLI sends `.zip`
inputs through its byte-exact transfer path, preserving non-Markdown skill
assets. The UI raw-ZIP upload is equivalent. Do not apply from the package
directory: that legacy CLI path filters some JSON/YAML contracts and helper
scripts.

For an existing company, preview first:

```sh
npx paperclipai company import /tmp/enki-hogar-ai-os-v0.6.0.zip \
  --target existing \
  --company-id <company-id> \
  --collision replace \
  --dry-run \
  --json
```

Inspect the CLI or UI preview. For a first import into the assumed empty company, require zero collisions. For a version update, require collisions only for the known Enki entities being replaced and cancel on unrelated entities. In both cases require:

- six agents and exactly one root;
- eleven company skills;
- four projects, eleven tasks, and two routines;
- every agent and schedule paused.

Cancel if the target company, counts, reporting tree, or collision set differs. Import only after the preview matches. Remove `--dry-run`, add `--yes`, and keep `--collision replace` to apply the exact reviewed ZIP; alternatively confirm the same raw ZIP in the UI. Importing does not apply connector connections or access profiles.

For a patch over a company that already contains Enki tasks and routine history,
do not apply that full preview if any bootstrap issue has action `create`.
Historical imports do not always carry a portable task identity, and replacing
the complete package can therefore duplicate the eleven bootstrap tasks. Use a
selective agent/skill patch and require `companyAction: none`, empty project and
issue plans, six known agent updates, and exactly eleven skills:

```sh
pnpm paperclipai company import /tmp/enki-hogar-ai-os-v0.6.0.zip \
  --include agents,skills \
  --target existing \
  --company-id <company-id> \
  --collision replace \
  --dry-run \
  --yes \
  --api-base http://localhost:3100 \
  --json
```

Apply the same command without `--dry-run` only after that selective preview is
clean. This preserves agent UUIDs, positive budgets and operational issue
history while replacing managed instructions and skill assignments; import
safety leaves agents paused.

Immediately after import, run the routine kill switch through the authenticated
API. This works for Quickstart Docker, pauses every non-archived routine and
also disables every enabled trigger without exposing the stored Board token:

```sh
pnpm paperclipai routines disable-all \
  --company-id <company-id> \
  --api-base http://localhost:3100 \
  --json
```

The legacy form without `--api-base` remains for installations that have a
local Paperclip `config.json`; do not use that form against Quickstart Docker.

Then run `scripts/check-runtime-drift.mjs --json` and require zero `routine_*` or `unexpected_routine` findings. Other findings are expected until connections, profiles, policies, and budgets are configured in the next step. This kill switch is defense in depth: it does not replace the bundle's paused routine status and disabled triggers, and any mismatch is a failed import gate.

## 6. Configure and activate safely

Follow [connections](connections.md), [product-support operations](catalog-knowledge.md), and the separate [Telegram gateway setup](connections.md#telegram-director-gateway), apply [the access matrix](../policies/access-matrix.md), and verify each agent's unique managed Codex home is authenticated. Keep MCP connection installs empty. With all MCP connections disabled and agents paused, run `scripts/reconcile-agent-gateways.mjs --apply-disabled`; this creates six agent-scoped gateways and leaves them disabled. Once the publisher sidecar is healthy in `disabled` mode and its bearer exists as a Paperclip Secret, run `scripts/reconcile-content-publisher.mjs --apply` with `PAPERCLIP_COMPANY_ID` and `PAPERCLIP_BOARD_TOKEN` in the operator environment. The script verifies the exact nine-tool catalog before adding permissions, installs the specific Board-approval policy ahead of the global block, quarantines future catalog drift and finishes with the full desired-state gate. Board must choose and configure a positive monthly hard cap for the company and for each of the six agents; this package deliberately does not invent euro values. Run the desired-state drift check before activation. It requires every agent cap to be positive, `managedMcpOnly: true`, six exact active gateways with no persistent client tokens, zero MCP installs, the exact publishing-approval policy before the global block, and both routines paused with disabled schedules. Activate one specialist's gateway and agent at a time and run [the smoke test](smoke-test.md). Keep `CONTENT_PUBLISH_WRITE_MODE=disabled` while validating read tools, then test `wordpress-drafts` separately before considering `approved`. Activate the Director only after specialists pass, then enable the Telegram plugin and run its dedicated smoke test. Manually executing both recurring tasks makes their schedules eligible for a later Board decision; it does not activate them. v0.6.0 deliberately keeps both routines and triggers paused, and enabling either without a matching versioned operational desired state is configuration drift.

The versioned Codex arguments deliberately select the named `enki-readonly-network` profile, which extends `:read-only`, enables network access for Paperclip/MCP calls, and sets `features.use_legacy_landlock=true`; `dangerouslyBypassApprovalsAndSandbox` remains false. Docker's default seccomp policy blocks the unprivileged user namespaces required by Bubblewrap in the Quickstart container, while current Codex cannot project `workspace-write` onto its legacy Landlock backend. The read-only profile is representable by Landlock and was verified to allow the local health/API path while denying workspace writes. Do not combine it with `--sandbox`, or replace it with `privileged`, `SYS_ADMIN`, `seccomp=unconfined`, or `danger-full-access`.

Paperclip writes each managed MCP server with `default_tools_approval_mode = "approve"`. This prevents Codex's non-interactive approval layer from rejecting the request before Paperclip can govern it; the named gateway remains default-deny and continues to block or request Board approval according to Paperclip policy.
