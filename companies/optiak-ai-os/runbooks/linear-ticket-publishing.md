# Governed Linear ticket publishing

Status: implemented offline, disabled, not installed and not connected. This runbook does not authorize a live write.

The read-only Linear MCP remains the authority for backlog queries. Ticket publishing uses a separate connector and separate OAuth application so creation authority cannot broaden the read path.

## 1. Preconditions

- Back up the Optiak Paperclip instance and the connector journal volume.
- Keep all agents paused during setup.
- Confirm the read-only Linear connection is still healthy, installed only for Product and exposes no writes.
- Confirm the package checks pass and the connector image is built from the reviewed tag.
- Never use a personal access token, the existing read-only OAuth grant, generic `write`, or `admin`.

## 2. Create a dedicated Linear OAuth application

In Linear workspace settings, create a private OAuth application named `Optiak Paperclip Ticket Publisher`:

1. Enable client-credentials tokens.
2. Request only `read,issues:create`. `read` is needed to verify the configured team immediately before mutation; `issues:create` is Linear's narrow issue-creation scope.
3. Use the app actor. Do not request assignable, mentionable, customer, initiative, generic write, or admin scopes.
4. In the application's team access, allow only team `OPT`.
5. Copy the `OPT` team model UUID from Linear's command menu. This is runtime configuration, not repository content.

Linear's official [OAuth documentation](https://linear.app/developers/oauth-2-0-authentication)
defines the `issues:create` scope and 30-day client-credentials tokens. The
connector obtains them in memory and fetches a fresh token after expiry or a
definitive `401`; it never persists or prints them. The
[GraphQL guide](https://linear.app/developers/graphql) is the authority for
`issueCreate` and its partial-error behavior.

## 3. Create connector secret files

Initialize the directory and connector bearer token without printing it:

```sh
./companies/optiak-ai-os/scripts/local-instance.sh publisher-init
```

The command creates the ignored `.runtime-secrets/linear-ticket-publisher/` directory and `mcp-token`. Add three files there with mode `0600`:

- `linear-team-id`
- `oauth-client-id`
- `oauth-client-secret`

Use a no-echo prompt for the client secret. Do not paste any value into Git, Paperclip issues, agent instructions, screenshots or chat. The connector OAuth secret stays only in the connector process. The generated `mcp-token` is the only credential later copied into Paperclip's connection secret field.

## 4. Start disabled and inspect health

```sh
./companies/optiak-ai-os/scripts/local-instance.sh publisher-up --build
./companies/optiak-ai-os/scripts/local-instance.sh publisher-health
```

Expected health includes `status: ok`, `writeMode: disabled`, `teamKey: OPT`, and `toolCount: 1`. Health never calls Linear and returns no credential, UUID, ticket content or journal row.

## 5. Add the Paperclip MCP connection

In the Optiak instance at `http://localhost:3200`, open Apps and connect a custom MCP server:

- Name: `Linear — Optiak Ticket Publisher`
- Endpoint from the Paperclip container: `http://linear-ticket-publisher:8788/mcp`
- Transport: MCP HTTP
- Authentication: bearer token copied from the ignored `mcp-token` file into Paperclip's encrypted credential field
- Automatic inclusion of new tools: disabled / quarantine enabled

Refresh the catalog. It must contain exactly `optiak_linear_create_issue_batch`, classified write=true and destructive=false. Any other tool is a failed smoke: disable the connection and inspect the image before continuing.

Create a default-deny profile that includes exactly that tool and bind it only to Product & PRD Lead. Do not install it company-wide.

## 6. Apply policies in this order

Use `policies/linear-ticket-publisher.yaml` as desired state and create the policies through the UI:

1. Priority 5: rate limit the exact upstream tool to five batches per day per agent/tool.
2. Priority 10: require approval for the exact upstream tool and Product actor.
3. Priority 100: retain the broader block on write-capable backlog tools.

Dry-run the policy with Product as actor. The decision must be `require_approval`; another agent must be denied. Do not create a trust rule for this tool. A request-confirmation card or PRD verdict is not downstream authorization; the gateway action request is the mutation approval.

## 7. Negative smoke while disabled

Have Product prepare the synthetic fixture from `optiak-linear-ticket-publishing`. The initial call must stop at `approval_required`. After Board approves the exact synthetic arguments, the retry must return `write_disabled`, create no Linear issue and leave no publication journal row.

Inspect Paperclip audit evidence for the exact arguments hash and actor. Reconfirm the catalog contains one tool and no other agent can call it.

## 8. Enable and run one canary

Only after the negative smoke and a fresh backup:

```sh
OPTIAK_LINEAR_TICKET_PUBLISHER_WRITE_MODE=enabled \
  ./companies/optiak-ai-os/scripts/local-instance.sh publisher-up --build
```

Use a real immutable PRD revision and one low-risk ticket. Product calls the tool, Board approves the exact action request, and Product retries unchanged. Verify the returned identifier through the separate read-only Linear connection. Confirm the issue:

- belongs to `OPT`;
- is unassigned;
- uses the team's default backlog/triage state;
- has no project, labels, estimate, cycle, comment or relationship mutation;
- contains the reviewed acceptance criteria and immutable source marker.

Disable write mode immediately if any property differs.

## 9. Ambiguous outcomes

On timeout, transport loss, restart during creation, malformed response, provider 5xx or result mismatch, the journal becomes `uncertain` and the connector stops. Product must not retry.

Stop the service and list uncertain entries:

```sh
./companies/optiak-ai-os/scripts/local-instance.sh publisher-stop
docker compose --project-name paperclip-optiak \
  -f docker/docker-compose.quickstart.yml \
  -f companies/optiak-ai-os/runtime/docker-compose.paperclip.yml \
  -f companies/optiak-ai-os/runtime/docker-compose.linear-ticket-publisher.yml \
  run --rm linear-ticket-publisher node src/admin.mjs list \
  --journal /data/journal.sqlite --status uncertain
```

The operator inspects Linear manually and uses `resolve-succeeded` or `resolve-not-created` with a durable evidence reference. A not-created resolution still requires a new Paperclip action request before retry. Never delete the journal row or reuse the old approval.

## 10. Rollback

1. Set write mode to `disabled` and recreate only the publisher service.
2. Disable the Paperclip publisher connection; do not alter the read-only connection.
3. Revoke the Linear OAuth app credential or remove its team access.
4. Preserve Paperclip audit records and the connector journal.
5. Restore the journal only to a new file while the service is stopped; inspect before replacing any volume data.
6. Record created Linear identifiers and let a human decide whether to keep, close or delete them. This connector has no rollback mutation tool.

Paperclip import/export does not carry this connection, credential, policy or journal. Reapply and smoke the same reviewed package tag in every new environment.
