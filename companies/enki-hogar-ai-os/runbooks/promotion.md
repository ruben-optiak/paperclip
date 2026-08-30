# Production promotion gate

No infrastructure provider is selected in v1. Promotion is permitted only when the target supplies:

- Paperclip and connector images pinned by immutable version or digest.
- Managed PostgreSQL and persistent Paperclip file storage.
- TLS, authenticated deployment, least-privilege operator access, and private MCP networking or governed HTTPS.
- A secret manager with rotation and audit, never Git or plain deployment manifests.
- Tested database and file backups with retention and restore evidence.
- Monitoring for health, auth failures, tool-catalog drift, PII leakage, and unexpected egress.
- An SBOM or equivalent complete transitive dependency/license report for each released connector image.

The current compatibility lock deliberately leaves release/image digests pending. Production promotion is blocked until every deployed image is resolved to an independently verified digest, the exact Paperclip release contains the per-agent managed `CODEX_HOME` import behavior, and the recorded package Git tag, commit, import ZIP SHA-256, and CI run all refer to the same source revision. Never replace a pending value with an inferred digest.

Keep the source package/tag, company exports, and instance database/file backups as separate evidence sets; follow [backup and restore evidence](backup.md). A company export is not a database or file backup.

Promotion sequence: pass the path-filtered Enki CI gate, build the reproducible import ZIP and retain its checksum, tag the validated commit, back up the target, deploy digest-pinned images, run the gateway fixture in an isolated preflight company, upload that exact raw ZIP through the Paperclip UI into a new paused company, apply connections/policies manually, run the runtime drift check and complete smoke test, activate agents individually, then routines. The v0.1.x CLI local-source path is preview-only because it does not transport every non-Markdown skill asset.

Rollback: pause agents/routines, disconnect MCPs, export incident state for redacted diagnosis, restore the previous company export and instance backups, redeploy previous immutable images, and repeat the smoke test before activation.
