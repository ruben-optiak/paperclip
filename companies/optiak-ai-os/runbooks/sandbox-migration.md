# Codex sandbox migration

## Current decision

`OAI-011` is blocked, not complete. Keep `features.use_legacy_landlock=true` on all ten agents until every migration gate in `runtime/compatibility.lock.json` passes.

The local Quickstart topology runs the Paperclip control plane and its `codex_local` child processes in the same container. Codex `0.151.0` prefers Bubblewrap on Linux. Docker's built-in seccomp profile rejects the user-namespace setup before the sandboxed command starts. The bounded probe recorded on 2026-09-02 produced:

- legacy read: exit `0`;
- legacy attempted write under `read-only`: exit `2`, permission denied, no artifact;
- modern Bubblewrap read: exit `1`, user namespace unavailable.

Removing the legacy flag now would remove the warning but make agent shell commands fail. That is not a migration.

## Why the obvious Docker workaround is rejected

OpenAI's secure development-container example relaxes Docker seccomp/AppArmor and adds capabilities so Bubblewrap can build its inner sandbox. That profile is scoped to a container dedicated to Codex. Applying `privileged`, `CAP_SYS_ADMIN`, `seccomp=unconfined`, `apparmor=unconfined`, or danger-full-access to the current Paperclip container would broaden the same process boundary that owns the control plane, database access, authentication state, and secrets. Do not do that.

The safe target is a dedicated agent execution boundary: for example a separately governed sandbox provider or runner container. Any Docker relaxations required by Bubblewrap must apply only there, after a threat-model review, with no control-plane database or secret mounts.

## Repeatable checks

Static contract validation runs as part of the package check:

```sh
./companies/optiak-ai-os/scripts/check.sh
```

Run the live compatibility probe inside the Paperclip Linux container:

```sh
docker exec paperclip-optiak-paperclip-1 \
  node /app/companies/optiak-ai-os/scripts/check-sandbox-compat.mjs --live --json
```

For the present lock, exit `0` means the script reproduced the expected blocked state and verified the fallback; inspect `migrationReady`, which must remain `false`. It does **not** mean the migration is ready.

After provisioning a dedicated execution boundary, run the same script there with `--require-ready`:

```sh
node companies/optiak-ai-os/scripts/check-sandbox-compat.mjs \
  --live --require-ready --json
```

Only an exit `0` from `--require-ready` permits the next stage. If the modern probe starts passing while the lock still says `blocked`, the script deliberately fails so the observed change cannot bypass review.

## Removal sequence

1. Back up the instance and pause all agents and routines.
2. Provision a dedicated execution boundary with no Paperclip database, session-secret, connector-secret, or unrestricted host mounts.
3. Pass `--live --require-ready` there.
4. Configure the exact network destinations needed by Codex, Paperclip, and managed MCP. Verify direct access outside that set fails.
5. Remove `features.use_legacy_landlock=true` from all ten package agents and change the compatibility lock to `ready_for_live_regression`.
6. Preview and import the exact package with agents still paused.
7. Run one bounded regression that proves read access, write denial, a denied governed action, an approved-once action, audit attribution, and absence of the legacy warning.
8. Run the regression for the remaining agents, return all ten to `paused`, and confirm zero active routines.
9. Only then mark `OAI-011` `DONE` and record immutable evidence in the backlog.

Failure of any gate restores the previous package and execution boundary. Never make the shared control-plane container more privileged as rollback.
