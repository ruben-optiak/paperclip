# Secrets matrix

No real value belongs in Git, a company package, an issue, an agent workspace, or an agent environment.

| Portable name | Consumer | Storage in local v1 | Minimum scope |
| --- | --- | --- | --- |
| `WOO_CONSUMER_KEY` / `WOO_CONSUMER_SECRET` | Woo connector only | untracked Compose environment | Woo REST API Read |
| `WOO_MCP_TOKEN` | Paperclip connection + Woo connector | UI secret and untracked Compose environment | connector bearer only |
| `GOOGLE_APPLICATION_CREDENTIALS` file | Ads/GA4 connector only | read-only host mount | `adwords`, `analytics.readonly`, required cloud identity |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Ads connector only | untracked Compose environment | Explorer/read query access |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GSC connector/auth helper | untracked host environment | Search Console OAuth client |
| GSC token file | GSC connector only | read-only host directory mount | Search Console read scope |
| `GOOGLE_MCP_TOKEN` | Paperclip connections + Google proxy | UI secret and untracked Compose environment | connector bearer only |
| `SUPPORT_DB_ADMIN_PASSWORD` | PostgreSQL + support migration/admin container | untracked Compose environment | support database administration only |
| `SUPPORT_DB_READER_PASSWORD` | PostgreSQL + support MCP | untracked Compose environment | PostgreSQL role with `default_transaction_read_only=on` |
| `SUPPORT_MCP_TOKEN` | Paperclip connection + support MCP | UI secret and untracked Compose environment | connector bearer only |
| `SUPPORT_EMBEDDING_API_KEY` | optional support MCP/admin reindex process | untracked Compose environment | embeddings only; never agent model access |
| Telegram BotFather token | Telegram plugin only | company-scoped Paperclip Secret bound by secret reference | one dedicated private Enki bot |
| Codex subscription login | Paperclip-managed, unique per-agent `CODEX_HOME` | Paperclip instance | agent execution only |
| `OPENAI_API_KEY` | no agent consumer | explicit empty plain value in every agent adapter | prevents inheritance or accidental API-key fallback |

The optional embedding provider uses only `SUPPORT_EMBEDDING_API_KEY`; never reuse or inject an agent `OPENAI_API_KEY`. The Telegram token never belongs in `.env`, Compose, a command argument, plugin state, an agent environment, or an issue. Rotate a credential if it appears in logs, source snapshots, import previews, issues, artifacts, or agent prompts. After rotation, rerun the secret scan and connector/plugin checks.
