# Optiak Linear ticket publisher

This is a private, deny-by-default MCP connector for one operation: create an exact batch of one to five unassigned issues in Linear team `OPT`. It does not edit, comment, assign, relate, move, close, archive, or delete issues.

The runtime is implemented but ships **disabled and uninstalled**. Importing the company package does not create a Linear OAuth app, enable writes, add a Paperclip connection, or create a policy.

## Safety model

The effective path is:

`immutable PRD → Product ticket contract → Paperclip exact-tool approval → connector kill switch → durable journal → Linear issueCreate`

- Paperclip signs and hashes the exact tool arguments. The agent's first call pauses with `approval_required`; only a Board-approved retry with identical arguments reaches this connector.
- The connector independently requires `LINEAR_TICKET_PUBLISHER_WRITE_MODE=enabled`.
- Canonical arguments are capped at 3900 bytes so the complete request fits the approval display rather than being silently summarized.
- A stable key derived from PRD revision plus ticket key prevents repeat creation after a confirmed success.
- The connector commits `creating` before calling Linear. A timeout, lost response, process restart, malformed response, or result mismatch becomes `uncertain` and is never retried automatically.
- The SQLite journal stores hashes, state and safe Linear identifiers only; it does not store titles, descriptions, credentials or provider response bodies.
- OAuth uses a dedicated app actor with scopes `read,issues:create`. Configure that app's team access to `OPT` only. Never grant generic `write` or `admin`.

Linear's official [GraphQL guide](https://linear.app/developers/graphql)
documents `issueCreate` and partial-error handling. Its
[OAuth guide](https://linear.app/developers/oauth-2-0-authentication) defines
the narrower `issues:create` scope, client credentials and app actors. The
connector treats any ambiguous mutation result as uncertain because those docs
do not define a provider-side idempotency key for `issueCreate`.

## Runtime

Use the Compose service and the operator runbook at `runbooks/linear-ticket-publishing.md`. The service exposes:

- `GET /health`: credential-free, contains only mode and fixed contract metadata.
- `POST /mcp`: bearer-protected MCP Streamable HTTP endpoint.
- one tool: `optiak_linear_create_issue_batch`.

Secrets are file-backed:

- `LINEAR_TEAM_ID_FILE`
- `LINEAR_OAUTH_CLIENT_ID_FILE`
- `LINEAR_OAUTH_CLIENT_SECRET_FILE`
- `LINEAR_TICKET_PUBLISHER_MCP_TOKEN_FILE`

The only non-secret runtime switches are shown in `.env.example`. Never create a real `.env` inside the package.

## Operator journal CLI

Run with the service stopped for backup, restore or manual reconciliation:

```sh
node src/admin.mjs doctor --journal ./runtime-data/journal.sqlite
node src/admin.mjs list --journal ./runtime-data/journal.sqlite --status uncertain
node src/admin.mjs backup --journal ./runtime-data/journal.sqlite --output ./runtime-data/journal-backup.sqlite
node src/admin.mjs restore --input ./runtime-data/journal-backup.sqlite --output ./runtime-data/restored.sqlite
```

An uncertain row can only be resolved after a human inspects Linear:

```sh
node src/admin.mjs resolve-succeeded --journal ./runtime-data/journal.sqlite \
  --key 'linear:REVISION:TICKET' --identifier OPT-NUMBER \
  --url 'https://linear.app/optiak/issue/OPT-NUMBER' \
  --evidence 'Board inspection reference'

node src/admin.mjs resolve-not-created --journal ./runtime-data/journal.sqlite \
  --key 'linear:REVISION:TICKET' --evidence 'Board inspection found no matching issue'
```

`resolve-not-created` makes the row retryable by the connector, but Paperclip must open and approve a new exact action request. The old approval must not be reused or promoted to a trust rule.

## Verification

```sh
npm ci --ignore-scripts
npm test
```

The company-level `scripts/check.sh` also runs these tests and verifies that the import archive remains reproducible.
