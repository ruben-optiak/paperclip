# Security and change-control runbook

- Keep connector ports bound to loopback on the host and use the private Compose network from Paperclip.
- Store source credentials only in connector processes. Agents receive MCP capabilities, never upstream credentials.
- Keep FastMCP provider handoff configs mode `600` inside the connector's `/tmp` tmpfs. They must contain only the minimum environment for that provider and disappear when the container is removed.
- Require actual read-only upstream roles in addition to tool filtering.
- Protect every `/mcp` route with a bearer token; `/health` contains no account identifiers, tool output, credential status, or customer data.
- Give Paperclip an independent `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET`; never reuse `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, or a connector bearer. Drain or reject pending approvals before rotating it because rotation invalidates their signatures.
- Compare the observed tool catalog against `policies/tool-allowlist.yaml` after builds and upgrades.
- Keep `list_google_ads_links` disabled at both proxy and profile layers; read-only operations that return PII are still prohibited.
- Keep every customer-level access path absent from the v0.1.x connector catalog.
- Keep the product-support database off host ports. The MCP receives a read-only role with `SELECT` only on retrieval tables; audit and purge-preview tables, the admin password, and the lifecycle CLI remain operator-only.
- Reject support packs containing customer/credential data, absolute machine paths, commercial fields or unapproved sources. Persist only stable approved technical/support knowledge and crosswalks; current commercial truth stays in WooCommerce.
- Correct knowledge by activating a new complete approved pack. Permit physical deletion only for a whole superseded pack after backup, unchanged impact preview and one-time token; never expose row/entity deletion to agents.
- Redact names, email, phone, address, IDs, and raw payloads from logs and routine briefs.
- Stop agents and routines on credential leakage, unknown tools, unredacted PII, unexpected writes, or target-environment ambiguity.
- Keep connection installs empty. Deliver tools through exactly one agent-scoped named gateway per agent, backed by that agent's `catalog_entry` allowlist; never create a persistent `gateway_client` token.
- Keep Telegram on one dedicated private bot and one active long poller. Require exact sender and chat allowlists plus an active Paperclip human-member mapping.
- Treat Telegram input as an instruction to create/comment on Paperclip work, never as authority to run a shell command, invoke/resume an agent, mutate business data, or decide an approval.
- Keep the Telegram plugin free of `approvals.respond`, `issue.interactions.respond`, `agents.invoke`, `agents.resume`, and `issues.update`; package validation and tests fail if those capabilities appear.
- Do not send PII, exact-order context, credentials, approval rationale, raw errors, or tool output to Telegram. The outbound relay withholds likely sensitive content and links back to the authenticated UI.
- Keep `CONTENT_PUBLISH_WRITE_MODE=disabled` by default. Enable `wordpress-drafts` or `approved` only for a bounded smoke/release window after the Paperclip approval policy and exact nine-tool catalog pass drift checks.
- Give only Growth the three publication tools. Require the exact reviewed draft/review revision, Board approval and a stable idempotency key for every call; never repeat an `uncertain` journal entry until an operator reconciles it against the live provider.
- Keep provider credentials in the content-publisher process, its MCP bearer in Paperclip, and its journal in the named persistent volume. Back up the journal with the deployment because losing it weakens retry safety.
- Run exactly one content-publisher writer replica per journal volume. Horizontal scaling requires a separately reviewed transactional idempotency store and distributed lock; a shared filesystem file is not that design.
- Keep media upload, pages/plugins, deletes, comments, DMs, reels, stories, carousels and bulk publication absent. An unreviewed catalog addition is an incident, not an implicit capability upgrade.

## Residual outbound-network risk

Codex uses the named `enki-readonly-network` profile: the filesystem extends `:read-only`, while network access remains enabled because the agent must reach `PAPERCLIP_API_URL` and its governed MCP endpoint. Agent deliverables are written through Paperclip issue comments/work products, not directly into the workspace. This still leaves residual direct-egress capability inside the agent process. The compensating controls in v0.5.x are: agents receive neither MCP bearer tokens nor upstream/database credentials, connector credentials exist only in connector processes, Paperclip brokers governed MCP calls through short-lived run tokens and agent-scoped gateways, the three publication calls require Board approval plus an independent connector kill switch and journal, all other active catalogs are strict/read-only, and drift/audit checks are mandatory.

Managed Codex MCP entries use `default_tools_approval_mode = "approve"`. This approves only dispatch from Codex to the Paperclip-managed gateway; it does not approve the upstream operation. Paperclip remains the authorization boundary and still applies the agent-scoped default-deny profile, global write/destructive block policy, approval workflow, audit log, and short-lived run token. Keep `approval_policy="never"` for the non-interactive Codex process so it fails closed instead of waiting on an unavailable CLI prompt.

Treat this as an accepted local-v0.5 risk, not a complete egress boundary. Before wider production autonomy, validate Paperclip's `networkScope=allowlist` path with bwrap and migrate agents to an allowlist containing only Paperclip's control-plane endpoint. Do not claim destination-level egress isolation until that test has passed.

For a Telegram incident: disable the plugin for the company, revoke/rotate the bot token through BotFather, review plugin/issue activity and the allowlists, then rerun the plugin smoke test before enabling it. For a connector or agent incident: pause agents/routines, disconnect the affected MCP, preserve only redacted evidence, rotate credentials, review access logs, rerun tests/catalog checks, and obtain human approval before reconnection.
