# Codex sandbox migration

## Current decision

`OAI-011` is deliberately deferred, not complete. The technical target remains
blocked. Keep `features.use_legacy_landlock=true` on all ten agents until the
Board resumes the work and every migration gate in
`runtime/compatibility.lock.json` passes.

## Deferred read-only phase

On 2026-09-20 the local Optiak instance installed the official Daytona
sandbox-provider manifest `0.1.7` from the exact Paperclip checkout after npm
reported that the repository package version was not published. Its initial
health and manifest validation passed. The Board then deliberately parked agent
implementation while the advisory system is refined: the plugin remains
installed but disabled and instance environment management is off. This
local-path installation is development history only; promotion requires a
pinned published artifact or immutable image/digest.

No Daytona environment, API key, sandbox lease or agent binding exists yet.
`enableNativeRunner`, runner preview ingress and the sandbox duplex bridge remain
disabled. Do not create an implementation workspace, enable Daytona, turn on
environment management, or change an agent's execution environment until the
Board explicitly resumes `OAI-011`. Agents may continue approved reads,
analysis, review and local drafts; those activities do not authorize source
changes.

The historical capability preflight confirmed that the existing `codex_local`
adapter supports the Daytona provider. If the Board resumes the migration, the
first probe preserves that adapter and changes only Senior Platform Engineer's
execution environment.

The local Quickstart topology runs the Paperclip control plane and its `codex_local` child processes in the same container. Codex `0.154.0` prefers Bubblewrap on Linux. Docker's built-in seccomp profile rejects the user-namespace setup before the sandboxed command starts. The original bounded probe on 2026-09-02 and the execution-workspace follow-up on 2026-09-20 produced:

- legacy read: exit `0`;
- legacy attempted write under `read-only`: exit `2`, permission denied, no artifact;
- legacy Git read in a Paperclip `git_worktree`: exit `128`, worktree `.git`
  permission denied;
- modern Bubblewrap read in the shared control-plane container: exit `1`, user
  namespace unavailable.

Removing the legacy flag now would remove the warning but make agent shell commands fail. That is not a migration.

## Why the obvious Docker workaround is rejected

OpenAI's secure development-container example relaxes Docker seccomp/AppArmor and adds capabilities so Bubblewrap can build its inner sandbox. That profile is scoped to a container dedicated to Codex. Applying `privileged`, `CAP_SYS_ADMIN`, `seccomp=unconfined`, `apparmor=unconfined`, or danger-full-access to the current Paperclip container would broaden the same process boundary that owns the control plane, database access, authentication state, and secrets. Do not do that.

The safe target is a dedicated agent execution boundary: for example a separately governed sandbox provider or runner container. Any Docker relaxations required by Bubblewrap must apply only there, after a threat-model review, with no control-plane database or secret mounts.

A disposable diagnostic container on 2026-09-20 mounted only a temporary
repository read-only, used the repository owner's UID, enabled
`seccomp=unconfined` for that container alone, and selected an explicit Codex
read-only profile. Bubblewrap read the exact expected Git revision, denied a
write, and left no artifact. This isolates the blocker to the shared runtime
topology, but it is not a Paperclip-connected sandbox provider and therefore is
not live migration evidence.

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

Run this sequence only after an explicit Board decision to resume `OAI-011`.

1. Back up the instance and pause all agents and routines.
2. Re-enable the reviewed provider and environment-management surface, then
   verify the plugin version and capability catalog have not drifted.
3. In `Instance settings → Environments`, create `Optiak Agent Sandbox` with
   provider `Daytona`. Paste the Daytona API key into the environment's
   secret-backed `apiKey` field; never place it in Git, `.env`, an agent config,
   an issue or a command line. Start with the provider defaults, `reuseLease:
   false`, 4 CPU, 4 GiB memory, 10 GiB disk and per-turn lifecycle.
4. Probe the saved environment. Stop on any provider, image or credential
   failure; a successful provider probe still does not authorize an agent.
5. Bind only Senior Platform Engineer to that environment while the agent stays
   paused. Do not change the other nine agents or their adapter.
6. Provision one disposable execution boundary with no Paperclip database,
   session secret, connector secret or unrestricted host mount, then run
   `scripts/check-sandbox-compat.mjs --live --require-ready` there.
7. Configure the exact network destinations needed by Codex, Paperclip, and managed MCP. Verify direct access outside that set fails.
8. Repeat the `optiak/optiak-frontend` no-edit Git smoke from a fresh issue and
   prove both worktree Git metadata reads and denied writes with no artifact.
9. Remove `features.use_legacy_landlock=true` from Senior Platform Engineer
   only, re-run the governed denial/approval and audit regression, and return
   the agent to `paused`.
10. After Board review, migrate the remaining nine agents one at a time. Only
   after all ten pass may the package remove all fallback flags and change the
   compatibility lock to `ready_for_live_regression`.
11. Confirm all ten agents are paused, zero runs and routines are active, and
    then mark `OAI-011` `DONE` with immutable evidence in the backlog.

Failure of any gate restores the previous package and execution boundary. Never make the shared control-plane container more privileged as rollback.
