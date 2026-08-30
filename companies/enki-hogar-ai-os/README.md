# Enki Hogar AI OS

Portable `agentcompanies/v1` package for running a read-only, draft-only Enki Hogar operating team in Paperclip.

## What is versioned

- Six `codex_local` agents and their execution contracts.
- Four initial projects, bootstrap tasks, and two paused routines.
- Eight domain skills with examples and offline fixtures.
- Curated, non-secret Enki knowledge with an allowlisted sync process.
- A read-only WooCommerce MCP and pinned Google MCP runtime.
- Desired connection policy, six agent-scoped managed gateways, security controls, tests, and promotion runbooks.

Instance data, Paperclip database rows, Codex homes, OAuth material, API credentials, customer data, and real `.env` files are intentionally not versioned.

## Organization

| Agent | Reports to | Primary skills |
| --- | --- | --- |
| Director de Operaciones de Enki | organizational root | daily brief, change control, unit economics |
| Ecommerce & Catalogue Manager | Director | catalogue QA, brand guardian, daily brief, change control |
| Growth Manager | Director | SEO/SEM, brand guardian, daily brief, WordPress render/dry-run |
| Finance & BI Manager | Director | unit economics, daily brief |
| Technology Manager | Director | change control, connector diagnosis, daily brief, brand guardian when drafting customer-facing text |
| Customer Experience Manager | Director | customer care, brand guardian, change control |

The workflow is hub-and-spoke with no Chief of Staff layer and with direct Board assignment: all five specialists report to the Director, specialists return evidence-backed work products, and the user may assign an issue directly to any specialist. Ecommerce governs catalogue and Merchant evidence; Growth discovers acquisition and SEO opportunities and hands catalogue implications to Ecommerce.

## Safe local path

1. Copy `.env.example` to an untracked environment file outside Git and fill only connector-side credentials.
2. Follow [local setup](runbooks/local-setup.md), beginning with a company export backup.
3. Install the locked offline-test dependencies with `npm --prefix companies/enki-hogar-ai-os/connectors/woocommerce-readonly-mcp ci --ignore-scripts`, then run `./companies/enki-hogar-ai-os/scripts/check.sh` before starting integrations.
4. Build the import archive with `./companies/enki-hogar-ai-os/scripts/build-import-zip.sh /tmp/enki-hogar-ai-os-v0.1.2.zip` and import that ZIP through the Paperclip UI using preview first.
5. Keep all agents and routines paused while configuring connections and the six disabled agent-scoped gateways; never use connection installs for Enki.

For a new disposable company, the CLI can provide a partial topology preview:

```sh
npx paperclipai company import companies/enki-hogar-ai-os \
  --target new \
  --new-company-name "Enki Hogar AI OS preflight" \
  --dry-run
```

Keep `--dry-run`: the current CLI local-source reader intentionally filters out
non-Markdown skill assets, including the vendored YAML/JSON contracts and the
restricted WordPress helper. This preview is useful for inspecting agents,
projects, tasks, and collisions, but it is not an import-artifact validation and
must not be applied.

For v0.1.2, the only supported apply path is to upload the generated ZIP through
the Paperclip UI. The UI sends the raw archive, preserving every allowlisted
skill asset. Use its preview workflow for both existing and new companies so
collisions and complete file contents are validated before import.

Paperclip can assign Board work directly to any specialist even though specialists report to the Director.

## Safety boundary

Allowed in v1: approved reads, analysis, comparisons, evidence packs, and local drafts. Brand Guardian reviews customer-facing drafts but grants no publication authority. WordPress is limited to local render and `--dry-run`. Customer-level and exact-order access are absent from the connector catalog. Every external mutation is blocked. See [access matrix](policies/access-matrix.md) and [change control](skills/enki-change-control/SKILL.md).

Codex auto-approves only dispatch to Paperclip-managed MCP gateways. Paperclip remains the authorization boundary: agent-scoped default-deny profiles, the global write/destructive block, short-lived tokens, and gateway auditing still apply to every call.

El código y la documentación operativa de este paquete se distribuyen bajo MIT. El contenido de `references/` es material interno de Enki Hogar y se rige por `LicenseRef-Enki-Hogar-Internal`; no queda sublicenciado bajo MIT. Consulta `NOTICE.md`, `THIRD_PARTY_NOTICES.md` y `LICENSE-ENKI-INTERNAL.md` antes de redistribuir el paquete.

Format: [Agent Companies specification](https://agentcompanies.io/specification). Runtime: [Paperclip](https://github.com/paperclipai/paperclip). Business context: [Enki Hogar](https://www.enkihogar.com/).
