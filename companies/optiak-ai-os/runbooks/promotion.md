# Promotion

This runbook promotes the Optiak AI OS package and its Paperclip control plane.
It does not release the Optiak gateway, Admin API, MCP gateway, frontend, or
documentation. Apply the machine-readable contract at
`skills/optiak-release-readiness/references/ai-os-promotion-contract.json`.

The current state is offline design only. No infrastructure provider has been
selected, no deployed Paperclip target exists, and this runbook grants no
deployment, rollback, agent-activation, or production authority.

## Non-negotiable path

`local authoring → preproduction paused import → preproduction selected-agent
smokes → rollback rehearsal → preproduction soak → production paused import →
production selected-agent activation → separately approved routines`

A direct local-to-production path is denied. Local health or fixture results are
never preproduction, deployment, restore, inference, or release evidence.

## 1. Freeze the candidate

Record these six values together:

- exact package Git commit;
- deterministic package ZIP SHA-256;
- Paperclip version;
- immutable Paperclip registry image digest;
- database migration revision expected by that image;
- redacted configuration fingerprint.

The configuration fingerprint includes provider kinds, public-origin settings,
package version, connection/policy identifiers, and paused state, but never
secret values. Mutable tags such as `latest`, `beta`, or a branch name are not
candidate identity. Use a stable Paperclip release unless the Board explicitly
accepts a beta candidate.

Run:

```sh
./companies/optiak-ai-os/scripts/check.sh
./companies/optiak-ai-os/scripts/build-import-zip.sh /tmp/optiak-ai-os-candidate.zip
```

Evaluate a prepared evidence JSON without performing any action:

```sh
node companies/optiak-ai-os/scripts/evaluate-promotion-readiness.mjs < promotion-evidence.json
```

The evaluator returns advice only. `ready_for_board_decision` is not permission
to deploy or activate anything. Fixture-only evidence always remains blocked;
preproduction readiness requires `connected_non_production` evidence and
production readiness requires evidence collected against production.

## 2. Provision an isolated preproduction target

The provider is deliberately unspecified. Whatever platform is chosen must
provide:

- a Paperclip image pinned by immutable digest;
- a unique instance identity and auth namespace, never Enki's;
- authenticated deployment mode behind one canonical HTTPS origin;
- persistent PostgreSQL suitable for the intended scale;
- durable attachments/artifact storage and required workspace persistence;
- a healthy secret provider with strict secret references;
- private or governed connector networking;
- audit, backup-freshness, resource, and service-health visibility.

Do not place real `.env` files, database URLs, signing secrets, provider keys, or
storage credentials in Git or the company package.

## 3. Prove backup and restore before import

A database dump alone is incomplete. Inventory and checksum one recoverable set
containing:

1. logical database dump, migration journal, and plugin schemas;
2. attachments and artifact storage;
3. registered workspace data needed for recovery;
4. secret metadata plus the separately protected local master key or hosted
   provider bootstrap needed to decrypt/resolve values;
5. redacted instance configuration;
6. secret-free company export;
7. retention, owner, restore location, and instructions.

Restore the set into a disposable isolated target. Verify migration state,
administrator login, company/entity counts, attachments, secret-provider
health, and audit writes. Record recovery time. Either half of a database plus
master-key pair is insufficient. Never test a downgrade in place; restore a
compatible backup under the selected older image.

## 4. Preview and import paused

Preview the exact frozen ZIP. Confirm:

- ten agents, thirteen skills, six projects, twenty-one tasks, and four routines;
- one `director-optiak` root and the expected reporting tree;
- an explicit and explained collision strategy;
- no credential, local path, database id, or connection instance state;
- all agents paused and all routine triggers disabled.

Apply only after an exact Board decision for this candidate, environment, and
`paused_import` stage. Reconcile the imported counts and effective policy. Abort
if anything starts running, a collision is unexplained, or the candidate hash
changes.

## 5. Preproduction smokes

Keep routines disabled. Validate the control plane first: authenticated login,
database persistence across restart, artifact upload/download, audit write,
secret-provider health, and fresh backup health.

Then activate one selected agent at a time only after its own prerequisites
pass:

- exact Codex runtime and sandbox boundary;
- source-specific read-only connection smoke;
- effective access matrix and budget limits;
- fixture run, then a bounded connected run when that role needs one;
- one durable result and return to paused.

Provider-backed Optiak inference, streaming, costs, credential revocation, and
request correlation belong here, not in local development. They are governed by
`OAI-014` and `OAI-024`; absence of those signals cannot become a pass.

## 6. Rehearse rollback and soak

Before production, exercise rollback or restore in preproduction with the exact
candidate. Reverify data, attachments, secret-provider health, agent paused
state, and audit continuity. Define:

- last known good candidate and its compatible backup;
- rollback owner and decision deadline;
- abort signals and maximum tolerated impact;
- whether recovery is config reversal, package reimport, forward fix, or full
  restore.

Record a declared soak window plus incidents, regressions, and accepted risks.
A successful CI workflow, mutable image tag, or package import alone is not soak
or runtime evidence.

## 7. Production paused import

Production must receive the exact candidate fingerprint that passed
preproduction, with no rebuild. Take and verify a fresh complete pre-change
backup in an independent restore location. Repeat the collision preview and
apply paused after a new exact Board decision.

Production access remains read-only and source-scoped. Activate only named
agents whose prerequisites and manual smokes pass against the production-safe
read paths. Never run synthetic mutations against production.

## 8. Routine activation

Routine activation is not implied by company or agent readiness. For each exact
routine, require its source dependencies, a successful manual run, deduplication
and budget evidence, schedule/timezone review, owner, disable path, and a fresh
Board decision. Enable one trigger and inspect its first scheduled run before
considering another.

## Abort and rollback

Stop before the next action if candidate identity changes; origin or target is
ambiguous; backup/restore is stale, missing, or failed; migrations are ahead of
the image; secrets appear in evidence; an unapproved agent/routine starts; or
audit, storage, budgets, or rollback ownership is unhealthy.

Pause execution first. Preserve evidence. The Board chooses the documented
rollback path. Agents may diagnose and recommend but cannot deploy, roll back,
rotate secrets, activate execution, or declare recovery without fresh proof.
