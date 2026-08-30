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
4. Assign only the five aggregate/product tools in `policies/tool-allowlist.yaml`. v0.1.0 permits zero customer-level tools or PII.
5. Verify that the observed catalog contains no write operation.

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

Use Bearer `GOOGLE_MCP_TOKEN`. Ads must expose only search, accessible-customers, and resource-metadata tools. GA4 must match the allowlist. Do not grant an Ads credential capable of account mutation through another tool path.

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

With zero installs, current Paperclip versions may emit a `permitted_connections_not_installed` diagnostic before injecting the applicable named gateway. This is known audit noise in v0.1.0, not a missing gateway, provided the named-gateway check and the real agent smoke test pass.

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
