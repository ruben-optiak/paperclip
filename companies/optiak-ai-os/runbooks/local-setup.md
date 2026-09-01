# Local setup

Optiak must run in a Paperclip instance separate from Enki. Sharing this Git repository is safe; sharing the runtime database, persistent storage, secret store, ports, or Compose project is not the intended setup.

## Before import

1. Check out `integration/companies` or an approved Optiak feature branch.
2. Run `./companies/optiak-ai-os/scripts/check.sh`.
3. Build the deterministic import ZIP outside the package.
4. Create the separate Optiak Paperclip instance with its own Compose project name, host port, public URL, data directory, authentication secret, and Codex home.
5. Confirm the Enki and Optiak containers mount different host data directories.
6. Complete first-admin setup and Codex authentication only in the Optiak instance.
7. Create a database and storage backup before each material import after initial setup.

Do not store the instance environment file in this repository. When the operator is ready, use the root Docker quickstart with values equivalent to:

- Compose project: `paperclip-optiak`
- Host port: a free port different from Enki, for example `3200`
- Public URL: the matching loopback URL
- Data directory: a dedicated Optiak directory

Review the current `docker/docker-compose.quickstart.yml` before executing commands because upstream configuration may change.

## Import

1. Import preview the exact ZIP.
2. Verify ten agents, twelve skills, six projects, twenty-one tasks, and four disabled routines.
3. Confirm one root (`director-optiak`) and the expected reporting tree.
4. Apply with agents and routines paused.
5. Configure no connection during the import itself.
6. Run the fixture-only smoke test before activating the Director.
