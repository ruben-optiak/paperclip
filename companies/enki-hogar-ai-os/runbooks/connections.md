# Connection setup

Create exactly these active connections. Names are part of the drift contract; do not improvise aliases.

| Name | Endpoint | Authentication held by Paperclip |
| --- | --- | --- |
| `Enki WooCommerce Read Only` | `http://enki-woocommerce-mcp:8020/mcp` | Bearer `WOO_MCP_TOKEN` |
| `Enki Google Ads Read Only` | `http://enki-google-mcps:8010/mcp` | Bearer `GOOGLE_MCP_TOKEN` |
| `Enki Google Analytics Read Only` | `http://enki-google-mcps:8011/mcp` | Bearer `GOOGLE_MCP_TOKEN` |
| `Enki Search Console Read Only` | `http://enki-google-mcps:8012/mcp` | Bearer `GOOGLE_MCP_TOKEN` |

For each connection select API-key authentication and bind the secret as the `Authorization` header with the `Bearer ` prefix. Paperclip stores and projects that connection bearer. Do not put it in an agent adapter environment or task. `policies/desired-state.yaml` is the machine-readable contract for exact catalogs, six default-deny profiles, six agent-scoped gateways, zero connection installs, and the global block policy.

## WooCommerce

1. Create a dedicated WooCommerce REST API key with permission **Read**.
2. Put its values only in the untracked Compose environment.
3. Create a Paperclip MCP connection for `http://enki-woocommerce-mcp:8020/mcp` with Bearer `WOO_MCP_TOKEN`.
4. Assign only the five aggregate/product tools in `policies/tool-allowlist.yaml`. v0.1.x permits zero customer-level tools or PII.
5. Verify that the observed catalog contains no write operation.

The inventory call is deliberately bounded: use `max_pages: 10` for the Enki
smoke test. `woo_low_stock` requests only inventory-safe fields and reports
raw rows, unique IDs and WooCommerce's declared total after stable ID-ordered
pagination and defensive deduplication. It reports exact-quantity and
status-only (`outofstock`) matches separately. A missing
parent quantity is never converted to zero. Variation-level quantities are not
available through the top-level product listing and must remain visibly
partial.

Paperclip marks a remote connection unhealthy after a tool timeout and then
removes that connection's tools from subsequent gateway listings. After fixing
the underlying latency, use **Refresh catalog** on the existing connection to
restore health; do not install or recreate the connection. Catalog definition
changes are expected to enter quarantine. Review the changed schema,
annotations and read-only classification, promote only the known
`woo_low_stock` entry, and re-run the deny-by-default drift check.

## Google Ads and GA4

Use one OAuth 2.0 **Desktop app** owned by the selected Google Cloud project. Keep the downloaded client JSON in a private directory outside Git. The same client may be used to generate the combined ADC file and the separate Search Console token, but those two generated credential files remain distinct.

Enable Google Ads API, Google Analytics Admin API, Google Analytics Data API, and Google Search Console API in the project. The Google account used for ADC must already have access to the required Google Ads account and GA4 property.

```sh
gcloud services enable \
  googleads.googleapis.com \
  analyticsadmin.googleapis.com \
  analyticsdata.googleapis.com \
  searchconsole.googleapis.com \
  --project=<google-cloud-project-id>
```

Generate a dedicated ADC file outside the container with these exact scopes:

```text
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/adwords
https://www.googleapis.com/auth/cloud-platform
```

The official Google Ads API has no read-only OAuth scope. `adwords` is therefore required even though Enki exposes only three query tools. The compensating controls are the fixed read-only tool config, the strict Paperclip catalog/profile allowlists, zero direct installs, agent-scoped gateways, and connector-only credentials.

Run the ADC login with an isolated gcloud configuration directory and the downloaded OAuth client JSON:

```sh
export ENKI_GOOGLE_PRIVATE_DIR=<private-google-directory>
mkdir -p "$ENKI_GOOGLE_PRIVATE_DIR/gcloud" "$ENKI_GOOGLE_PRIVATE_DIR/gsc"
chmod 700 "$ENKI_GOOGLE_PRIVATE_DIR" "$ENKI_GOOGLE_PRIVATE_DIR/gcloud" "$ENKI_GOOGLE_PRIVATE_DIR/gsc"

CLOUDSDK_CONFIG="$ENKI_GOOGLE_PRIVATE_DIR/gcloud" \
  gcloud auth application-default login \
  --client-id-file="$ENKI_GOOGLE_PRIVATE_DIR/oauth-client.json" \
  --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/adwords,https://www.googleapis.com/auth/cloud-platform

chmod 600 "$ENKI_GOOGLE_PRIVATE_DIR/gcloud/application_default_credentials.json"
```

Set `GOOGLE_ADC_HOST_PATH` to the canonical absolute path of that generated `application_default_credentials.json`. Create connections:

- Ads: `http://enki-google-mcps:8010/mcp`
- GA4: `http://enki-google-mcps:8011/mcp`

Use Bearer `GOOGLE_MCP_TOKEN`. Ads must expose only search, accessible-customers, and resource-metadata tools. GA4 must expose exactly the six tools in the allowlist. `list_google_ads_links` must remain absent: the pinned upstream returns `creator_email_address`, so v0.1.x quarantines the whole tool instead of trusting prompt-only redaction. Do not grant an Ads credential capable of account mutation through another tool path.

After rebuilding this connector, refresh the GA4 catalog in Paperclip and require an observed count of six before resuming any agent. Current Paperclip catalog refreshes update tools that are rediscovered but do not tombstone a tool that disappeared upstream. If `list_google_ads_links` was seen by an older runtime, keep every agent paused, remove its exact catalog entry from every profile and mark that one historical entry `quarantined` through an approved administrative path after a backup. Do not accept an active stale entry merely because the upstream now returns method-not-found. The GET-only drift check must return zero findings before the Director is resumed.

Use `customers_list_accessible_customers` only to select a Google Ads customer internally and never copy customer IDs into an issue or brief. If the target is ambiguous, mark Ads unavailable and ask Board to correct connector-side account scoping; do not enumerate or query multiple accounts speculatively.

`GOOGLE_ADS_DEVELOPER_TOKEN` comes from the Google Ads manager account's API Center and must have production-query access (at least Explorer for the pinned upstream). If the OAuth user reaches the target account through a manager account, set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to that manager's ten-digit ID without hyphens; otherwise leave it empty.

## Search Console

Authenticate the pinned `@jlnkrth/gsc-mcp-server@1.1.0` outside the running service with the OAuth Desktop client. The consent-screen user must have access to the Enki Search Console property; while the app is in Testing mode, add that account as a test user. The login uses the Search Console read-only scope and opens a local callback on port `3336`.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the `installed.client_id` and `installed.client_secret` fields of the downloaded OAuth client JSON, then run:

```sh
export ENKI_GOOGLE_PRIVATE_DIR=<private-google-directory>
export GOOGLE_CLIENT_ID=<desktop-oauth-client-id>
read -r -s GOOGLE_CLIENT_SECRET
export GOOGLE_CLIENT_SECRET
export GSC_TOKEN_PATH="$ENKI_GOOGLE_PRIVATE_DIR/gsc/tokens.json"

npx -y -p @jlnkrth/gsc-mcp-server@1.1.0 gsc-mcp-auth
chmod 600 "$GSC_TOKEN_PATH"
unset GOOGLE_CLIENT_SECRET GOOGLE_CLIENT_ID GSC_TOKEN_PATH
```

Do not create or edit `tokens.json` manually. Set `GSC_TOKEN_HOST_DIR` to the canonical absolute path of its parent `gsc` directory, because Compose mounts the directory read-only and the container expects `/run/secrets/gsc/tokens.json`. Set `GOOGLE_OAUTH_CLIENT_HOST_PATH` to the canonical absolute path of the Desktop OAuth JSON. The runtime mounts that JSON read-only and projects its installed client credentials only into the GSC child process; do not copy `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` into the persistent Compose environment. Connect Paperclip to `http://enki-google-mcps:8012/mcp` using the same `GOOGLE_MCP_TOKEN` bearer as the other Google connections.

The accepted catalog is list sites, search analytics, inspect URL, and list sitemaps. There is no indexing/submission tool. Any such tool appearing later is quarantined.

## Google environment inventory

The untracked Compose environment contains only values or host paths; never paste the JSON file contents into it:

| Variable | Value source | Secret |
| --- | --- | --- |
| `GOOGLE_PROJECT_ID` | Google Cloud project ID | no |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads manager API Center | yes |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | optional manager customer ID, ten digits without hyphens | no |
| `GOOGLE_MCP_TOKEN` | new random high-entropy bearer generated locally | yes |
| `GOOGLE_ADC_HOST_PATH` | absolute host path to generated ADC JSON | sensitive path |
| `GOOGLE_OAUTH_CLIENT_HOST_PATH` | absolute host path to OAuth Desktop client JSON | sensitive path |
| `GSC_TOKEN_HOST_DIR` | absolute host path to the directory containing generated `tokens.json` | sensitive path |

The OAuth client JSON, ADC JSON, GSC `tokens.json`, developer token, client secret, and connector bearer remain outside Git. Agents receive none of them.

Generate `GOOGLE_MCP_TOKEN` independently from Google credentials, for example with `openssl rand -hex 32`. Store the result only in the private Compose environment and in Paperclip's secret vault as the Bearer value for the three Google connections.

## Telegram Director gateway

Telegram is a Paperclip plugin, not an MCP connection and not an agent credential. It creates ordinary audited issues/comments and has no capability to decide approvals, invoke agents directly, resume agents, update issues, or call business systems.

### 1. Create the private bot and discover IDs

In Telegram, use the official `@BotFather` account to create a dedicated bot. Disable group joining unless a group is explicitly required, keep the bot private, and send `/start` to it from the account that will operate Enki.

Do not put the BotFather token in a command argument, `.env`, issue, or file. From the repository root, read it silently and pipe it to the ID-only helper:

```sh
read -r -s ENKI_TELEGRAM_DISCOVERY_TOKEN
printf '\n'
printf '%s' "$ENKI_TELEGRAM_DISCOVERY_TOKEN" \
  | pnpm --filter @enki-hogar/telegram-gateway discover-ids
unset ENKI_TELEGRAM_DISCOVERY_TOKEN
```

Record the `userId` and private `chatId` in your password manager or deployment notes. The helper prints no message bodies and does not advance Telegram's update offset. If no update appears, send `/start` again and retry. A bot cannot initiate the first conversation.

Find the current Paperclip human user ID (`principalId`) without copying session credentials into a command:

```sh
pnpm paperclipai member list --company-id <enki-company-id> --json
```

Select the active non-viewer human member that represents you. Do not use the membership row `id`; configure its `principalId` as `paperclipUserId`. The plugin revalidates that this principal remains active and writable before every inbound command and outbound event; the Paperclip host independently verifies human-attributed comments.

### 2. Store the token and install the mounted plugin

Create a company secret in **Company settings → Secrets**, for example `enki-telegram-bot-token`, and paste the token there once. The plugin config binds the resulting secret reference. There is deliberately no `TELEGRAM_BOT_TOKEN` environment variable.

In the plugin form, select that existing secret with the picker. Do not use **Or paste a raw value**: this gateway deliberately accepts only the object-shaped Paperclip secret reference, and the API rejects a raw token before saving configuration.

Ensure the combined Compose stack is running and `dist/` was built as described in [local setup](local-setup.md). The host folder is mounted read-only inside Paperclip at `/plugins/enki-telegram-gateway`. With the already authenticated CLI:

```sh
pnpm paperclipai plugin target
pnpm paperclipai plugin install /plugins/enki-telegram-gateway --local
pnpm paperclipai plugin inspect enki-hogar.telegram-gateway
```

Read the target diagnostic before confirming the install. The path passed to the CLI is intentionally the path visible to the Paperclip server inside Docker, not a host absolute path. Plugin installation is instance-wide; its configuration and runtime state are company-scoped.

### 3. Configure the Enki company

Open **Company settings → Instance → Plugins → Enki Telegram Gateway** and set:

| Field | Value |
| --- | --- |
| Enable Telegram gateway | on only when ready to start the smoke test |
| Telegram bot token | the Paperclip Secret reference created above |
| Paperclip user ID | your active member `principalId` |
| Allowed Telegram user IDs | the exact numeric `userId` from discovery |
| Allowed Telegram chat IDs | the exact private `chatId` from discovery |
| Report destination chat ID | the same private `chatId` for v0.2.0 |
| Director agent ID | leave empty to resolve the unique Enki Director; set the runtime UUID only if resolution is ambiguous |
| Paperclip URL visible from your phone | HTTPS company-board base URL, or empty while testing locally |
| Notifications | approvals, routine reports, and Director replies enabled |

Save, open the dashboard widget, and run **Probar conexión**. Require a verified bot username, the expected Director, and a recent successful poll. `conflict` means the bot still has a webhook or another `getUpdates` poller. v0.2.0 supports exactly one active long-polling worker per bot; do not run the same token in a second Paperclip replica.

### 4. Smoke test

1. Send `/help`; confirm it states that approvals stay in Paperclip.
2. Send a harmless request such as `Resume las prioridades abiertas sin ejecutar cambios`.
3. Confirm one issue with origin `plugin:enki-hogar.telegram-gateway`, assigned to the Director and attributed to your Paperclip user.
4. Reply to the bot acknowledgement; confirm one human-attributed comment appears on that issue.
5. Replay or resend the same Telegram update in a test fixture and confirm no duplicate issue.
6. Create a harmless pending approval in Paperclip; confirm Telegram receives only its type and UI link, with no approval/reject control.
7. Send a synthetic email/order reference inbound; confirm the bot rejects it and Paperclip creates no issue/comment.
8. Confirm the same synthetic content is replaced by the protected-content notice on outbound relay.

If the Director is paused or budget-blocked, the request is still registered but the bot states that it could not start. This is expected and does not authorize the plugin to resume the Director. Resolve the condition in Paperclip and send a new message.

Telegram is not suitable for secrets, customer PII, exact orders, payment data, or approval rationale. Use the authenticated Paperclip UI for those workflows. To stop the channel immediately, disable the company plugin config and rotate/revoke the bot token in BotFather; keep the issue history for audit.

## Codex

For every imported `codex_local` agent, verify the managed home is authenticated in the instance. A host Codex login is not automatically the login of an isolated managed home unless it is mounted or bootstrapped according to Paperclip's supported flow. Never copy a token into this package.

## Agent-scoped gateways

Do not use **Finish/Install** for these connections and do not call `PUT /tool-connections/:id/installs`. Paperclip's install flow creates a connection-wide profile, which is broader than the Enki per-agent allowlists. Enki instead uses one named gateway per agent, bound to that agent's exact `catalog_entry` profile. `codex_local` receives only a short-lived Paperclip gateway token for its own run; it never receives the connector bearer.

After the six profiles and their agent bindings exist, keep every agent paused and every connection disabled. Reconcile the gateways in fail-closed state with a short-lived Board key:

```sh
export PAPERCLIP_API_URL=http://localhost:3100
export PAPERCLIP_COMPANY_ID=<enki-company-id>
read -r -s PAPERCLIP_BOARD_TOKEN
export PAPERCLIP_BOARD_TOKEN

companies/enki-hogar-ai-os/scripts/reconcile-agent-gateways.mjs --apply-disabled
unset PAPERCLIP_BOARD_TOKEN PAPERCLIP_COMPANY_ID
```

The mutating mode refuses active connections, non-paused agents, runtime installs, non-catalog profile entries, duplicate slugs, and unexpected gateways. It creates no static gateway token. Activate a gateway only after its profile catalog is exact, its connector is healthy, budgets are positive, and the smoke test is ready. Keep `runtime.managedMcpOnly: true` for every agent.

With zero installs, current Paperclip versions may emit a `permitted_connections_not_installed` diagnostic before injecting the applicable named gateway. This is known audit noise in v0.1.x, not a missing gateway, provided the named-gateway check and the real agent smoke test pass.

## Audit desired state

After configuring connections, catalogs, profiles, bindings, policies, and agent gateways, create a short-lived Board key and follow the silent-input/revocation procedure in [gateway preflight](gateway-preflight.md). Audit the gateways and then run the GET-only drift check:

```sh
export PAPERCLIP_API_URL=http://localhost:3100
export PAPERCLIP_COMPANY_ID=<enki-company-id>
read -r -s PAPERCLIP_BOARD_TOKEN
export PAPERCLIP_BOARD_TOKEN

companies/enki-hogar-ai-os/scripts/reconcile-agent-gateways.mjs
companies/enki-hogar-ai-os/scripts/check-runtime-drift.mjs
unset PAPERCLIP_BOARD_TOKEN PAPERCLIP_COMPANY_ID
```

The checks fail on missing or unhealthy connections, endpoint drift, catalog growth, any customer-level tool, broadened or unexpected profiles/policies/agents/gateways, runtime installs, persistent gateway-client tokens, unexpected active connections, Codex adapter/sandbox drift, a non-empty API key, a missing/shared managed `CODEX_HOME`, a non-positive company or agent budget, routine schedule drift, active routines/triggers, or any unexpected routine. Without `--apply-disabled`, both scripts perform only GET requests and never print the token. Keep agents and routines paused until they pass.
