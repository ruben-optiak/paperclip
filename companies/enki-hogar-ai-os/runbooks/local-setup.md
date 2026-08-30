# Local setup and import

Run commands from the Paperclip repository root. Do not delete volumes or run `docker compose down -v`.

## 1. Back up the current company

In Paperclip, select the existing Enki company and use **Company settings → Export**. Save the archive outside this repository and record its timestamp. Confirm the company currently has no agents before relying on a zero-collision preview.

## 2. Validate source

```sh
npm --prefix companies/enki-hogar-ai-os/connectors/woocommerce-readonly-mcp ci --ignore-scripts
companies/enki-hogar-ai-os/scripts/check.sh
```

Create an environment file outside Git from `.env.example`. Generate fresh bearer tokens and use a WooCommerce key whose permission is actually **Read**. Prepare ADC and the GSC OAuth token as described in [connections](connections.md).

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
```

## 5. Preview and import

Build a fresh archive; the script validates the package and scans it for secrets before writing anything:

```sh
companies/enki-hogar-ai-os/scripts/build-import-zip.sh /tmp/enki-hogar-ai-os-v0.1.0.zip
```

For v0.1.0, apply imports only by uploading this raw ZIP through the Paperclip
UI. Do not apply the package with `paperclipai company import`: the current CLI
local-source reader omits non-Markdown skill assets, so that path cannot install
the vendored contracts or the restricted WordPress helper completely. A CLI
`--dry-run` may be used only as a partial topology preview.

In the UI, choose import into the existing company, select the generated ZIP printed by the command, and inspect the preview. Require:

- zero collisions in the assumed empty company;
- six agents and exactly one root;
- eight company skills;
- four projects, nine tasks, and two routines;
- every agent and schedule paused.

Cancel if the target company, counts, reporting tree, or collisions differ. Import only after the preview matches. Importing does not apply connector connections or access profiles.

Immediately after import, run the instance-wide routine kill switch for this company from the Paperclip host or inside the running Paperclip container:

```sh
npx paperclipai routines disable-all --company-id <company-id> --json
```

Then run `scripts/check-runtime-drift.mjs --json` and require zero `routine_*` or `unexpected_routine` findings. Other findings are expected until connections, profiles, policies, and budgets are configured in the next step. This kill switch is defense in depth: it does not replace the bundle's paused routine status and disabled triggers, and any mismatch is a failed import gate.

## 6. Configure and activate safely

Follow [connections](connections.md), apply [the access matrix](../policies/access-matrix.md), and verify each agent's unique managed Codex home is authenticated. Keep connection installs empty. With all connections disabled and agents paused, run `scripts/reconcile-agent-gateways.mjs --apply-disabled`; this creates six agent-scoped gateways and leaves them disabled. Board must choose and configure a positive monthly hard cap for the company and for each of the six agents; this package deliberately does not invent euro values. Run the read-only desired-state drift check before activation. It requires every agent cap to be positive, `managedMcpOnly: true`, six exact active gateways with no persistent client tokens, zero installs, and both routines paused with disabled schedules. Activate one specialist's gateway and agent at a time and run [the smoke test](smoke-test.md). Activate the Director only after specialists pass. Enable the routines last, after manually executing both recurring tasks.
