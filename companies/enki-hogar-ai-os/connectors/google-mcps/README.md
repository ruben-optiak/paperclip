# Pinned Google MCP runtime

Container runtime for three query-only catalogs:

| Service | Upstream pin | Public path |
| --- | --- | --- |
| Google Ads | `googleads/google-ads-mcp` commit `88f0467b9e536c562941fa52a94dd02b193c8fa4` | `:8010/mcp` |
| GA4 | `googleanalytics/google-analytics-mcp` commit `a8ca729d4a8fa99bffe87962c17c0539c6aa9da7` | `:8011/mcp` |
| GSC | `@jlnkrth/gsc-mcp-server@1.1.0` | `:8012/mcp` |

FastMCP is fixed at `3.3.1`. Python transitive dependencies are frozen in `uv.lock`; Node dependencies are frozen in `package-lock.json`. The services run on loopback ports inside the container and are exposed through bearer-authenticated proxies. The public MCP proxies run in stateless mode because Paperclip refreshes catalogs and invokes tools with direct JSON-RPC requests rather than retaining an MCP session. This applies to both `tools/list` and `tools/call`. `/health` is unauthenticated and returns only service/version/upstream readiness.

The tool catalog is allowlisted in `policies/tool-allowlist.yaml`. Ads uses its own fixed read-only tool config. GA4 upstream exposes reporting/account reads; known tools outside the approved list are disabled at the proxy and profile layers. In particular, `list_google_ads_links` is disabled because its upstream response includes `creator_email_address`, which violates Enki's zero-PII boundary even though the operation is read-only. Do not re-enable it without a connector-side sanitizer and a regression test proving that no email field or value reaches Paperclip. The selected GSC package exposes list/search/inspect/list-sitemaps and has no indexing operation. Any upstream catalog drift remains quarantined until manual review.

ADC must have `analytics.readonly`, `adwords`, and required cloud scopes. GSC uses a separately mounted OAuth Desktop client plus a token generated outside the running container. FastMCP intentionally filters sensitive variables when it spawns stdio providers. At startup, `render-runtime-configs.mjs` therefore creates provider-specific configs with mode `600` inside the container's `/tmp` tmpfs: Ads receives ADC, project, developer token, tools config, and optional MCC; GA4 receives only ADC and project. `gsc-auth-wrapper.mjs` reads the mounted client and projects its credentials only into the GSC child process. Secrets are connector-side only, disappear with the container, and must never be added to an agent environment.
