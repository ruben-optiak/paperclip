# Promotion

Promote the same validated Git tag to a separate Optiak Paperclip instance.

Requirements:

- pinned Paperclip image/version;
- separate managed PostgreSQL or proven persistent embedded database for the intended scale;
- separate persistent storage and secret store;
- authenticated TLS deployment;
- database, storage, and secret-key backups;
- private or governed connector networking;
- paused package import and collision-free preview;
- fixture smoke followed by one-source-at-a-time connected smoke;
- rollback through instance backup plus company export;
- no agent or routine activation until the relevant evidence gate passes.

Production access remains read-only after promotion. A later capability expansion requires a new reviewed package version and runtime policy change.
