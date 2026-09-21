# QA source execution

This runbook defines how QA may fetch an exact Optiak repository revision and
execute an allowlisted validation profile. It is deliberately separate from the
writable implementation workspace: QA produces evidence and never authors a
patch, commits, pushes, opens a PR, deploys or changes infrastructure.

The machine-readable boundary lives in
`skills/optiak-e2e-validation/references/qa-source-execution-contract.json`.
The current package includes a reference disposable Docker runner and host
controller. Its synthetic boundary smoke passed on 2026-09-20. That proves the
container boundary and cleanup path only. Each real repository/profile remains
unproved until an exact staged revision is executed and its evidence passes the
evaluator.

## Why the shared Paperclip container is not the runner

Repository code and package lifecycle scripts execute arbitrary code. Running
them next to the Paperclip control plane could expose its filesystem, process
environment, database or Docker socket. The existing Landlock worktree finding
also shows that the shared container cannot provide the required Git boundary.
Do not solve this by granting `privileged`, mounting the Docker socket or
relaxing the control-plane sandbox.

## Required runtime shape

1. A fetch boundary obtains only one allowlisted repository at one full commit
   SHA using read-only credentials. The bundled `stage-source.mjs` accepts a
   clean local checkout and copies tracked files only; it never copies `.git`
   or a credential.
2. The credential is absent from the test runner and its child processes.
3. A fresh disposable runner receives the source snapshot read-only, copies it
   into tmpfs, writes dependencies and build output only there, and starts with
   no production or customer secrets.
4. The v1 reference runner uses `--network none` for the complete execution and
   forces offline dependency installation. A missing dependency cache is a
   valid failed step. An allowlisted bootstrap proxy is future work and must be
   proved separately before any egress is enabled.
5. The runner exposes profile IDs, not arbitrary shell commands. Each profile
   maps to the versioned argv arrays in the contract.
6. It retains only capped hashes and step exit codes. The host controller waits
   for the `--rm` container to exit before marking cleanup complete.

## Reference runner smoke

From `companies/optiak-ai-os/`, build the fixed image and run the synthetic
boundary smoke:

```sh
docker build \
  -f connectors/qa-source-runner/Dockerfile \
  -t optiak-qa-source-runner:0.1.29 \
  .
node connectors/qa-source-runner/src/controller.mjs --self-test --pretty
```

The smoke must prove a non-root read-only container, read-only source mount,
ephemeral workspace, no network, no Docker socket, a fixed profile and
controller-confirmed cleanup. It deliberately does not execute any Optiak
repository.

## Initial profiles

- `backend_static_unit`: frozen Python dependencies, formatting, lint/mypy,
  architecture imports and unit tests with `OPTIAK_ENV=test`.
- `frontend_static_unit`: exact Node/pnpm toolchain, frozen install, lint,
  Vitest, docs link checks and Nuxt typecheck.
- `iac_static_validate`: formatting plus `init -backend=false` and `validate`
  for one exact allowlisted stack. Plan, apply, destroy, state, refresh, output
  and console are excluded.

These profiles do not start the full product. Local service integration and
browser E2E require a separate synthetic harness, explicit target/personas and
the existing E2E environment contract. A source-only pass is never staging or
release evidence.

## Evidence and handoff

Record exact repository, full SHA, source-inventory digest, profile, step IDs
and exit codes, timestamps, duration, capped output hashes and cleanup. Run:

```sh
node skills/optiak-e2e-validation/scripts/evaluate-qa-source-execution.mjs < evidence.json
```

`test_failures_observed` is valid QA evidence. It is not root cause. Hand only
the failing step, reproduction evidence and explicit technical question to
Senior Platform Engineer. Engineering Assurance consumes the validated report
by reference and does not rerun the suite.

The exact staging and execution commands are documented in
`connectors/qa-source-runner/README.md`. The Board must still authorize the first
real repository execution. A runner smoke does not grant implementation,
repository-write, merge, deployment or release authority.
