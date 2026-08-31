# Production promotion gate

No infrastructure provider is selected in v1. Promotion is permitted only when the target supplies:

- Paperclip and connector images pinned by immutable version or digest.
- Managed PostgreSQL and persistent Paperclip file storage, plus an isolated managed product-support database with pgvector support.
- TLS, authenticated deployment, least-privilege operator access, and private MCP networking or governed HTTPS.
- A secret manager with rotation and audit, never Git or plain deployment manifests.
- Tested Paperclip and support database/file backups with retention and restore evidence.
- Monitoring for health, auth failures, tool-catalog drift, PII leakage, and unexpected egress.
- An SBOM or equivalent complete transitive dependency/license report for each released connector image.
- A version-pinned private npm artifact or immutable plugin bundle for `enki-hogar.telegram-gateway`; production must not depend on a mutable developer bind mount.
- Durable encrypted storage and tested backup/restore for the content-publisher idempotency journal; deploy the connector with writes disabled and preserve the journal across restarts/rollbacks.
- Exactly one content-publisher writer replica unless a later version replaces the file journal with a reviewed transactional distributed store.
- Exactly one active Telegram long-polling worker per bot token, or a separately reviewed HTTPS webhook/leader-coordination design before running multiple Paperclip replicas.

The current compatibility lock deliberately leaves release/image digests pending. Production promotion is blocked until every deployed image is resolved to an independently verified digest, the exact Paperclip release contains the per-agent managed `CODEX_HOME` import behavior, and the recorded package Git tag, commit, import ZIP SHA-256, and CI run all refer to the same source revision. Never replace a pending value with an inferred digest.

Keep the source package/tag, company exports, and instance database/file backups as separate evidence sets; follow [backup and restore evidence](backup.md). A company export is not a database or file backup.

Promotion sequence: pass the path-filtered Enki CI gate, build the reproducible import ZIP and Telegram plugin artifact and retain both checksums, tag the validated commit, back up the target, deploy digest-pinned images with content publishing disabled, migrate the isolated support database and import only reviewed approved support packs, run the gateway fixture in an isolated preflight company, preview and import that exact raw ZIP through the current Paperclip CLI transfer path or the UI into a new paused company, install/configure the exact Telegram plugin artifact with the company channel disabled, apply connections/policies manually, run the runtime drift check and complete MCP/support/Telegram smokes, then pass the WordPress draft and separate Meta canaries before changing the publishing kill switch. Activate agents individually, enable Telegram, then make a separate Board decision on routines. Never apply from the source directory because its legacy CLI representation omits non-Markdown skill assets.

Rollback: set content publishing to `disabled`, disable Telegram, pause agents/routines, disconnect MCPs, export incident state for redacted diagnosis, preserve/reconcile the publication journal, restore the previous company export and instance backups, redeploy previous immutable images/plugin, rotate affected credentials, and repeat the smoke test before activation.
