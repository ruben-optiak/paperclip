# Optiak QA source runner

This is the reference disposable runner for `OAI-051`. It executes only the
profile IDs in `optiak-qa-source-execution-contract/v1`. It never accepts a
shell command, repository credential, Docker socket, production credential or
customer data.

The host controller owns container creation and cleanup. The untrusted test
process runs as an unprivileged user in a read-only container with `--network
none`, no capabilities, capped CPU/memory/PIDs and two disposable tmpfs mounts.
The source snapshot is mounted read-only and copied to the disposable workspace
before any repository code runs.

## Build and boundary smoke

From `companies/optiak-ai-os/`:

```sh
docker build \
  -f connectors/qa-source-runner/Dockerfile \
  -t optiak-qa-source-runner:0.1.29 \
  .

node connectors/qa-source-runner/src/controller.mjs --self-test --pretty
```

The self-test uses a generated synthetic snapshot. It proves the container
boundary and cleanup path only; it does not prove an Optiak repository or its
tests.

## Execute an exact staged revision

First stage one clean local checkout. This trusted staging step records only Git
tracked files and never copies `.git`, ignored files or credentials:

```sh
node connectors/qa-source-runner/src/stage-source.mjs \
  --source /path/to/clean/checkout \
  --repository optiak/optiak-frontend \
  --revision <full-40-character-sha> \
  --output /tmp/optiak-frontend-snapshot
```

Then execute a fixed profile:

```sh
node connectors/qa-source-runner/src/controller.mjs \
  --source /tmp/optiak-frontend-snapshot \
  --profile frontend_static_unit \
  --revision <same-full-sha> \
  --pretty
```

Dependency installation is offline during repository execution. A missing
cache is a valid failed step, not permission to enable broad egress. A future
bootstrap service may populate versioned caches behind an allowlisted proxy;
that service is deliberately not part of this runner.

The controller has access to the host Docker API because it creates the
container. The container and every repository process inside it do not. Do not
mount `/var/run/docker.sock`, the Desktop socket, an SSH agent or any secret
directory into the runner.
