# Isolated implementation workspaces

This runbook governs `OAI-042`. It does not itself create a workspace, grant
repository access, activate an agent, merge a branch or deploy anything.
`references/execution-workspace-contract.json` is the machine-readable desired
state and `scripts/evaluate-execution-workspace.mjs` is its fail-closed gate.

The first live lifecycle proof on 2026-09-20 created an issue-scoped
`optiak/optiak-frontend` worktree at the exact recorded `origin/main` revision,
kept it clean with zero commits ahead, and archived both worktree and branch
through Paperclip. The agent-side Git smoke did not pass: the shared
control-plane container's legacy read-only Landlock fallback denied the
worktree `.git` indirection before Git could inspect the repository. `OAI-042`
is deliberately deferred with `OAI-011` during the advisory/read-only phase;
workspace lifecycle success is not implementation authority. Do not create or
assign another implementation workspace until the Board explicitly reopens the
two items.

## Boundary

Only Senior Platform Engineer may receive a writable implementation workspace.
The exact repository must be one of:

- `optiak/optiak`
- `optiak/optiak-frontend`
- `optiak/iac-infra`

Independent Code & PR Reviewer keeps the separate remote GitHub MCP connection
read-only. A writable Engineer workspace must never be reused as the Reviewer's
authority or vice versa.

Every implementation issue must identify its project, exact repository, exact
starting revision, acceptance criteria and review owner. Missing information
returns `blocked_on_workspace` or `blocked_on_authority`; it never falls back to
the primary checkout, an agent home or a sibling repository.

## Desired Paperclip policy

Register each repository as a distinct project workspace. Database IDs and local
paths are instance state and must stay outside Git. Use this policy on the
applicable project or exact issue:

```json
{
  "enabled": true,
  "defaultMode": "isolated_workspace",
  "allowIssueOverride": false,
  "workspaceStrategy": {
    "type": "git_worktree",
    "baseRef": "origin/main",
    "branchTemplate": "{{issue.identifier}}-{{slug}}"
  }
}
```

Do not configure runtime services or additional network egress in the first
smoke. Paperclip owns worktree creation, branch selection, lifecycle and cleanup.
The agent must not create a nested worktree, switch or rename branches, reset the
base, clean an existing user checkout, merge, push, deploy or access production
credentials.

## Preflight

Before the first live workspace for a repository:

1. Confirm the registered remote resolves to the exact approved repository and
   its default remote branch is `origin/main`.
2. Record the immutable base revision. A branch name alone is insufficient.
3. Confirm no credentials or runtime services are copied from the operator's
   checkout into the workspace.
4. Create a disposable Paperclip issue assigned to Senior Platform Engineer and
   bind the exact project workspace.
5. Keep the agent paused until the issue and workspace preview show
   `isolated_workspace` plus `git_worktree`.
6. Run a no-edit smoke first: inspect cwd, repository, revision, branch and
   cleanliness. Do not run project setup, dependency installation or network
   commands during this proof.
7. Capture sanitized evidence in the shape consumed by
   `scripts/evaluate-execution-workspace.mjs` and require
   `ready_for_controlled_smoke`.
8. Pause the agent again and archive the disposable workspace through Paperclip.

## Runtime boundary gate

Do not repeat a live repository smoke in the shared control-plane container.
Do not work around the failure with `privileged`, `CAP_SYS_ADMIN`,
`seccomp=unconfined`, `apparmor=unconfined`, danger-full-access, or an
issue-scoped sandbox bypass on that container. It holds the Paperclip control
plane, database access, authentication state and connector secrets.

Provision a dedicated execution boundary first. It must:

1. expose only the assigned repository workspace and run-scoped Paperclip
   bridge, never the control-plane database or persistent secret store;
2. run Codex with Bubblewrap and an explicit least-privilege permission
   profile, without `features.use_legacy_landlock=true`;
3. let the assigned agent read both the worktree `.git` indirection and its
   common Git metadata;
4. deny a write under a read-only smoke and leave no artifact;
5. keep network and managed MCP access limited to the exact task contract.

A disposable diagnostic container with only a synthetic repository mount
proved that `seccomp=unconfined` can let Bubblewrap read the expected Git SHA
while a write is denied with no artifact. That diagnostic had no Paperclip run
binding and does not authorize live agent execution. The relaxation belongs
only in a separately governed runner or sandbox provider, never in
`runtime/docker-compose.paperclip.yml`.

After the boundary passes `runbooks/sandbox-migration.md`, rerun the no-edit
smoke for `optiak/optiak-frontend` from a fresh Paperclip issue. Evidence must
set `runtimeBoundarySeparated`, `gitMetadataReadableByAgent` and
`controlPlaneSecurityRelaxed` explicitly. Only then continue with the other two
repositories.

Fixture-only evaluation demonstrates the contract but never proves a live
workspace. The offline cases are in
`references/fixtures/execution-workspace-readiness.json`.

## First controlled implementation

After one no-edit smoke per repository, select a small reversible issue. Require
focused tests, a clean diff, exact revision and a handoff to Independent Code &
PR Reviewer. Human review remains mandatory before merge; deployment remains a
separate Board decision. Source in `iac-infra` proves declared intent only, not
applied cloud state.

## Rollback

Pause Senior Platform Engineer, cancel the run, preserve its logs and work
product, and archive the execution workspace through Paperclip. Do not delete or reset the operator's primary checkout. Revoke any temporary repository
credential independently if one was introduced during a later approved phase.
