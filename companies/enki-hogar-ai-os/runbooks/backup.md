# Backup and restore evidence

Treat these as three different artifacts. None replaces another:

1. **Source package**: the reviewed Git tag plus the reproducible import ZIP and its `.sha256`. This defines desired agents, skills, tasks, policies, and runbooks; it is not live state.
2. **Company export**: a Paperclip export of the Enki company taken immediately before and after an import or promotion. It captures portable company state, but not connector credentials, manually applied access state, the instance database, or persistent files.
3. **Instance backup**: a consistent PostgreSQL/database backup plus the Paperclip persistent-file backup from the same recovery point. This is the disaster-recovery artifact.

Store all backups outside this repository in encrypted, access-controlled storage. Record UTC time, environment, Paperclip version or commit, database/storage recovery-point IDs, company-export SHA-256, operator, retention, and restore owner. Never put credentials, backup locations, customer exports, or database identifiers in Git.

Before import or promotion:

- pause Enki agents and routines;
- export the current company and verify that the archive opens;
- take database and persistent-file backups at one documented recovery point;
- calculate and retain checksums outside Git;
- confirm the restore procedure and previous immutable image references;
- never run `docker compose down -v` or remove a volume as part of backup.

A backup is accepted only after a restore drill in an isolated target proves database startup, file availability, company visibility, authentication, and a paused-agent smoke test. Record redacted evidence and recovery time. Rollback restores database and files from the same point, redeploys the previous immutable images, re-applies manually managed connections/policies if needed, and keeps all agents and schedules paused until smoke tests pass.
