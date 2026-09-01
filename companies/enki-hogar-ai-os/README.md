# Enki Hogar AI OS

Portable `agentcompanies/v1` package for running a read-first, approval-gated Enki Hogar operating team with narrowly governed publishing in Paperclip.

## What is versioned

- Six `codex_local` agents and their execution contracts.
- Four initial projects, eleven bootstrap tasks, and two paused routines.
- Twelve domain skills with examples and offline fixtures, including decision-gated editorial planning and human-governed learning.
- Curated, non-secret Enki knowledge with an allowlisted sync process.
- A pinned, networkless catalogue runtime with a small geometry core, four snapshot-scoped brand adapters, strict positional Woo reconciliation, idempotent local change sets and post-import drift audit; immutable sanitized regressions; a read-only WooCommerce MCP with live parent/variation inspection; pinned Google MCP runtime; audited Telegram gateway plugin; isolated PostgreSQL/pgvector product-support projection; and a governed WordPress/Facebook/Instagram publisher.
- Desired connection policy, six agent-scoped managed gateways, security controls, tests, and promotion runbooks.

Instance data, Paperclip database rows, Codex homes, OAuth material, API credentials, customer data, and real `.env` files are intentionally not versioned.

## Organization

| Agent | Reports to | Primary skills |
| --- | --- | --- |
| Director de Operaciones de Enki | organizational root | daily brief, change control, unit economics, support coverage, editorial planning and learning governance |
| Ecommerce & Catalogue Manager | Director | catalogue QA and technical product support, brand guardian, editorial candidate validation, daily brief, change control |
| Growth Manager | Director | SEO/SEM, editorial research, shortlist, 7/28/90-day learning, technical product support, brand guardian, WordPress and social publishing requests |
| Finance & BI Manager | Director | unit economics, daily brief |
| Technology Manager | Director | change control, connector diagnosis and support coverage, daily brief, brand guardian when drafting customer-facing text |
| Customer Experience Manager | Director | customer care, technical product facts, brand guardian, change control |

The workflow is hub-and-spoke with no Chief of Staff layer and with direct Board assignment: all five specialists report to the Director, specialists return evidence-backed work products, and the user may assign an issue directly to any specialist. Ecommerce governs catalogue and Merchant evidence; Growth discovers acquisition and SEO opportunities and hands catalogue implications to Ecommerce.

## Safe local path

1. Copy `.env.example` to an untracked environment file outside Git, generate the independent Paperclip tool-action signing secret with the provided helper, and fill only connector-side credentials. Keep publishing in `disabled` mode until its separate smoke gate passes. Leave all embedding fields empty unless intentionally configured. Store the Telegram token as a Paperclip Secret, never in `.env`.
2. Follow [local setup](runbooks/local-setup.md), beginning with a company export backup.
3. Install the locked workspace and offline-test dependencies, then run `./companies/enki-hogar-ai-os/scripts/check.sh` before starting integrations. This also builds and tests the Telegram plugin.
4. Build the import archive with `./companies/enki-hogar-ai-os/scripts/build-import-zip.sh /tmp/enki-hogar-ai-os-v0.12.0.zip` and preview that exact ZIP with the current Paperclip CLI or UI before applying it.
5. Keep all agents and routines paused while configuring connections and the six disabled agent-scoped gateways; never use connection installs for Enki. Reconcile the publisher with `scripts/reconcile-content-publisher.mjs --apply` only while its independent write mode is `disabled`.

For a new disposable company, preview the generated ZIP rather than the source directory:

```sh
npx paperclipai company import /tmp/enki-hogar-ai-os-v0.12.0.zip \
  --target new \
  --new-company-name "Enki Hogar AI OS preflight" \
  --dry-run
```

The current CLI sends a `.zip` through the byte-exact transfer path, preserving
the vendored JSON/YAML contracts and restricted helper scripts. Its directory
source path still uses the legacy portable-file filter, so do not use the
directory as the apply source. The Paperclip UI is an equivalent raw-ZIP path.
In either client, inspect the preview before applying and keep automations paused.

When upgrading an already populated Enki company, import only `agents,skills`
unless the preview proves that every bootstrap task and routine will update in
place. Current task identity is not portable across all historical imports, so
a full replace preview can legitimately plan those tasks as new and would
duplicate operational history. The reviewed patch path is:

```sh
npx paperclipai company import /tmp/enki-hogar-ai-os-v0.12.0.zip \
  --include agents,skills \
  --target existing \
  --company-id <company-id> \
  --collision replace \
  --dry-run \
  --yes \
  --api-base http://localhost:3100 \
  --json
```

Paperclip can assign Board work directly to any specialist even though specialists report to the Director.

Paperclip issues, comments, documents and work products are durable operational history, but they are not all injected into each heartbeat. Editorial work therefore uses explicit company search, a versioned content ledger, a seven-stage brief contract, exact feedback and publication retrospectives. Growth, Ecommerce and Board stay aligned on one candidate fingerprint; Board decisions must be applied in a newer brief before drafting, and lessons require a separate Board promotion. WordPress/Meta remain live publication truth. See [context and editorial memory](runbooks/context-memory.md).

There are three intentionally separate product data paths. WooCommerce live is the sole authority for what is currently sold, its parent/variation structure, price and stock. Bulk audits use fresh complete Woo exports in the external Enki pipeline; official PDFs are prepared reproducibly with the [versioned catalogue runtime](runbooks/catalog-pipeline.md), then evaluated only by an exact [brand/snapshot adapter](runbooks/catalog-adapters.md) and represented through strict per-run and per-field evidence. [Woo reconciliation](runbooks/catalog-reconciliation.md) binds each comparison to the exact export position, emits only a local pending change set and audits a later full export for any out-of-scope drift. Before a replay, both the [sanitized cross-brand regression](runbooks/catalog-regression.md) and adapter gate must pass. Historical CSVs migrate under the [lossless migration runbook](runbooks/catalog-contract-migration.md). The separate database is only a rebuildable projection of approved technical facts, explicit compatibility, configuration semantics, support text and SKU crosswalks, queried through eight read-only tools. See [product-support operations](runbooks/catalog-knowledge.md).

The Telegram plugin is installed separately at instance level after the company import. It converts authorized messages into ordinary audited issues/comments; it does not bypass Paperclip or expose approval decisions. See [connection setup](runbooks/connections.md#telegram-director-gateway).

## Safety boundary

Allowed in v1: approved reads, analysis, comparisons, evidence packs, local drafts and three narrowly governed publication calls. Brand Guardian reviews customer-facing drafts but grants no publication authority. Growth may request a WordPress post upsert, a Facebook Page post or one Instagram image only after the exact draft/review handoff; Paperclip asks Board and the connector enforces its own kill switch plus idempotency journal. Customer-level and exact-order access remain absent. Every other external mutation is blocked. See [access matrix](policies/access-matrix.md) and [change control](skills/enki-change-control/SKILL.md).

Codex auto-approves only dispatch to Paperclip-managed MCP gateways. Paperclip remains the authorization boundary: agent-scoped default-deny profiles, the exact three-tool approval policy evaluated before the global write/destructive block, short-lived tokens, and gateway auditing still apply to every call.

El código y la documentación operativa de este paquete se distribuyen bajo MIT. El contenido de `references/` es material interno de Enki Hogar y se rige por `LicenseRef-Enki-Hogar-Internal`; no queda sublicenciado bajo MIT. Consulta `NOTICE.md`, `THIRD_PARTY_NOTICES.md` y `LICENSE-ENKI-INTERNAL.md` antes de redistribuir el paquete.

Format: [Agent Companies specification](https://agentcompanies.io/specification). Runtime: [Paperclip](https://github.com/paperclipai/paperclip). Business context: [Enki Hogar](https://www.enkihogar.com/).
