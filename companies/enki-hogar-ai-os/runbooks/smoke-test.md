# Manual smoke test

Run with all schedules paused and record evidence without secrets or PII.

1. Health: all four connector health endpoints return `ok`.
2. Catalog: observed tool names equal the allowlist; mutation and indexing probes are denied or absent.
3. Woo: sales/order summaries work on a bounded period; product/SKU and low-stock reads work; bulk output has no PII. The low-stock call completes inside Paperclip's 10-second remote-tool deadline, reports raw rows, unique IDs and the remote total, excludes duplicate IDs, separates exact quantities from status-only out-of-stock rows, and labels unavailable variation-level quantities as partial.
4. Zero-PII gate: customer lists and every customer-level query are absent from the connector catalog and access profiles.
5. Google: Ads search, GA4 report, and GSC analytics query run with explicit periods. The observed GA4 catalog contains exactly six approved tools and excludes `list_google_ads_links`; any reappearance is quarantined because its upstream response contains an email field. Do not use production-changing queries.
6. Brief: manually run complete, partial, stale, and outage fixtures. Missing or historical data remains visibly labelled.
7. WordPress: `render` and `sync --dry-run` work without credentials; `sync` without dry-run fails.
8. Agents: Board can assign work directly to each specialist and the reporting tree still has one Director root.
9. Gateways: there are exactly six active agent-scoped gateways, each uses its matching default-deny profile, every connection has zero installs, and there is no active `gateway_client` token. A tools-list decision matrix must equal each profile's allowlist.
10. Budgets: company and all six agent monthly hard caps are explicit and positive; record only the decision evidence, not invented values in this package.
11. Routines: desired-state drift proves exactly the daily and weekly routines are paused, both schedules are disabled, and no unexpected routine exists; manually invoke both and inspect outputs before enabling schedules one at a time.
12. Telegram: the plugin reports healthy for the Enki company; an allowlisted message creates one Director issue, a reply creates one human-attributed comment, a replay creates no duplicate, an unauthorized sender produces no issue/reply, `/approve` is denied, and approval notices contain only a UI link. A synthetic email/order/token is rejected inbound without creating work and withheld from any Director response sent outbound.
13. Portability: export the company again and inspect that no secrets, database IDs, connector host paths, managed-home paths, Telegram IDs, or bot token appear; preview a reimport in a disposable target. Plugin installation/configuration remains separate instance state.

For terminal smoke evidence, write the Board verification before the agent moves the issue to `done`, or restore the final status with a status-only update afterward. In current Paperclip behavior, a human comment on an assigned terminal issue is follow-up intent: it implicitly reopens the issue to `todo`. If the assignee is already paused, recovery can then route the stranded issue to `blocked`. Do not diagnose that transition as a failed read-only run when the latest run itself succeeded; inspect issue activity for `source=comment` followed by `recovery.reconcile_stranded_assigned_issue`, then restore the intended terminal state without adding another comment.

## Customer Experience zero-PII smoke

The v0.2.0 Customer Experience gate is **deny**, not ask-first. Use a completely
synthetic case to verify classification and a clearly labelled unsent draft.
Then verify from Board that:

- the WooCommerce catalog contains no exact-order or customer lookup tool;
- the Customer Experience profile exposes only `woo_get_product`;
- a test call to an existing order capability resolves to `off` with
  `deny_default`, no origin result and no approval request.

Those three observations are PASS: the request cannot reach WooCommerce. Do
not add an exact-order tool, use a real identifier, or expect a pending
approval merely to make the smoke pass. Sensitive ask-first order context is a
future version decision. Agents must use the MCP tools injected by Codex and
must never send `PAPERCLIP_API_KEY` directly to `/api/tool-gateway/*`; that key
identifies the agent but is not the short-lived named-gateway bearer.

## Per-agent isolation evidence

Before activating an agent, assign it a synthetic local-only task and retain only PASS/FAIL evidence:

- its workspace path and managed `CODEX_HOME` are different from those of the other five agents;
- write probes against its own workspace, Paperclip's managed scratch path, the packaged Enki definition, and a sibling agent workspace are denied and leave no file behind;
- it can persist a synthetic draft only through the assigned Paperclip issue/work-product path, without an external publication;
- its environment contains no `WOO_*`, `GOOGLE_*`, `*_MCP_TOKEN`, connector bearer, ADC or OAuth token binding; Quickstart may carry an `OPENAI_API_KEY` placeholder, which must be unset or empty (test emptiness without printing the value);
- it can reach `PAPERCLIP_API_URL`, use its governed MCP gateway, and complete a trivial Codex-authenticated run.
- its run log shows `default_permissions="enki-readonly-network"` and `features.use_legacy_landlock=true`, with no Bubblewrap namespace failure; filesystem access remains read-only while the governed API/MCP path works.
- its generated managed MCP block contains `default_tools_approval_mode = "approve"` and `http_headers`, never the ignored legacy `headers` key; the gateway audit must still show every permitted call as `profile_allows_tool` followed by `tool_completed`.

Pause immediately if any probe crosses an isolation boundary. Do not weaken sandbox flags or Docker isolation to make a failed probe pass.

## Managed gateway compatibility gate

Before activating any agent, mint a short-lived named-gateway token, call the gateway's documented MCP endpoint with `tools/list`, make one permitted read, make one call that must resolve to `deny_default`, verify the audit rows, and revoke the token. A response such as `401 Agent token did not verify` means the Paperclip HTTP authentication layer consumed the gateway bearer before the named-gateway handler. Treat that as a core compatibility blocker: keep connections, gateways, agents, and schedules disabled. Do not work around it by installing connections directly, putting connector bearers in agent environments, or bypassing the governed gateway.

## Telegram failure gate

Disable the company plugin immediately if the bot accepts a non-allowlisted sender/chat, creates duplicate issues for one update, attributes a comment to the wrong human, sends likely PII/credentials, exposes raw transport errors, or offers any approve/reject interaction. A Telegram `conflict` health code means another long poller or webhook owns the bot; keep this plugin disabled until exactly one consumer remains. Never fix this by broadening allowlists or adding approval capabilities.
