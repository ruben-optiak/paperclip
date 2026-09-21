# Optiak Linear: opt-in metadata boundary

Status (2026-09-12): **core integration candidate with durable sample limits,
tested through authenticated MCP HTTP and a real synthetic process heartbeat;
not deployed or enabled on the Optiak instance**.
The operator authorized a scoped core change. This does not authorize moving
OAuth credentials, enabling agents, opening technical text or claiming live
privacy protection. OAI-034 remains open.

## Scope and default

`server/src/services/optiak-linear-privacy.ts` is a small fork-specific preset.
It has no production dependency on `companies/`. A test compares its output
against the portable offline candidate's fixture. Keep both contracts aligned.

The server reads `PAPERCLIP_OPTIAK_LINEAR_PRIVACY` once during app construction.
Unset/empty means disabled. Invalid nonempty JSON fails startup with a fixed
message, never the supplied value. Changing a binding requires a restart.
Only the exact bound company/connection is affected; no provider-name wildcard,
UI/API/schema migration, global redactor change or automatic connection rewrite.

The JSON shape is:

```json
{
  "companyId": "<instance Optiak company UUID>",
  "connectionId": "<existing managed Linear connection UUID>",
  "tools": {
    "get_team": {"schemaHash": "<reviewed SHA-256>", "versionHash": "<reviewed SHA-256>"},
    "list_issues": {"schemaHash": "<reviewed SHA-256>", "versionHash": "<reviewed SHA-256>"},
    "get_issue": {"schemaHash": "<reviewed SHA-256>", "versionHash": "<reviewed SHA-256>"}
  }
}
```

This is a template, not a valid activation value. Obtain the two IDs from the
target instance and the three fingerprints from the reviewed portable baseline
at `companies/optiak-ai-os/policies/linear-catalog-baseline.json`. Never approve
new fingerprints automatically. Keep instance values outside Git and outside
agent environments. There are **no credentials** in this setting. OAuth stays
in Paperclip's vault and uses the existing resolution/refresh flow.

For Docker, a host `.env` alone does not pass a new variable into the server:
an operator-owned, ignored Compose override must explicitly map the variable to
the Paperclip service. Do not put it on another company's service. No override
or real activation setting was created for this candidate.

## Execution boundary

1. Resolve the company-scoped connection, validate the pinned read-only endpoint,
   active/reviewed non-quarantined catalog, fingerprints and read-only flags.
2. Accept only exact `get_team({query: "OPT"})`, two possible `list_issues`
   argument shapes (`team: OPT`, `state: started|unstarted`, `limit: 5`,
   `orderBy: updatedAt`), and exact `get_issue({id: "OPT-<integer>"})`.
   Reject extra fields **before argument summaries, policy recording or signing**.
   Managed arguments must not broaden that payload.
3. Preserve normal authorization, policy, vault and guarded HTTP behavior.
   Check the final resolved endpoint is `https://mcp.linear.app/mcp/readonly`.
   No caller-supplied HTTP headers are forwarded. Stateful MCP initialization,
   Composio indirection and transport drift are not supported by this preset.
4. Limit the upstream response to 262144 actual streamed bytes, including
   JSON-RPC overhead; reject invalid UTF-8. The provider request deadline is
   capped at 15 seconds. The existing OAuth 401 refresh may retry transport once;
   this is not a second user-level tool invocation.
5. Project raw MCP results **before** normalization and both elicitation handlers.
   Reject provider errors, resources, ambiguity, foreign scope, archived rows,
   future dates and known state contradictions. Unknown custom statuses remain
   `unknown`. Reconstruct URLs without slugs. Never emit title, description,
   people, email, attachment, cursor, provider error text or unknown fields.
6. Only projected content reaches returned content/data, invocation summaries,
   tool-call events and activity/audit results. Raw response request IDs and
   content-type header strings are not persisted. A failed protected dispatch
   returns a fixed `linear_privacy_denied` error without upstream details.

Success explicitly declares `metadata_only`, `semanticReviewAvailable: false`
and `evidenceScope: not_established_by_projection`. This is minimization, not
anonymization or proof of a provider's honesty. Technical Product triage needs
a separately accepted content contract; metadata cannot establish business
intent, acceptance criteria or semantic duplicates.

## Recovery, budgets and limitations

- Replays, explicit approved retries, execute-on-approve and Test-tab approval
  status recovery are denied for the bound connection. Existing rows have no
  trustworthy projection provenance. An ask-first policy does not create a new
  unexecutable card: the call is denied. Do not loosen policies to bypass this.
- Historical audit and Board history are **not** scrubbed or deleted. Restoring
  an old agent context can still bring old text back. Activation requires a
  fresh bounded run/context after reviewing what that context imports.
- `optiak-linear-sample.ts` keeps bounded claim/settlement receipts in the existing
  `tool_call_events` table; no schema migration. Short PostgreSQL transactions
  lock the owning heartbeat row, never hold the lock across provider HTTP, and
  serialize different gateway instances/database clients.
- A running context younger than one hour may make one team read, one five-item
  list per group (`started`, `unstarted`) and at most three distinct details from
  identifiers actually returned by its accepted lists: at most six dispatches.
  Duplicate groups/details, foreign sample IDs and run-less named clients fail
  closed. A rejected request before claim does not consume a provider call.
- A successful settlement happens only after projected results and audit have
  persisted. A dispatch/persistence failure closes the sample. An unsettled claim
  also blocks it after restart; there is no lease expiry, retry or in-memory reset.
  A concurrent loser does not poison the winning call. Binding-fingerprint drift
  and pre-activation raw successes cannot become sample authority.
- Keep receipts for active runs. The one-hour age guard also prevents reopening
  old contexts after normal audit retention. This is **per run**, not a company
  spending limit or authorization to start unlimited new runs. Explicit Board
  Test-tab reads are outside the agent sample and retain operator policy controls.
- Binding one connection does not forbid an operator from creating another
  connection or supplying independent credentials. Review installed connections,
  profiles, gateway tokens and agent environments to remove direct bypasses.
  This preset does not sanitize catalog discovery, historical comments, every
  administrative endpoint, external observability configuration or process memory.

## Verification

From the repository root, with existing workspace dependencies:

```sh
pnpm exec vitest run server/src/__tests__/optiak-linear-privacy.test.ts server/src/__tests__/optiak-linear-sample.test.ts server/src/__tests__/optiak-linear-heartbeat.test.ts server/src/__tests__/tool-gateway-service.test.ts server/src/__tests__/tool-content-guards.test.ts server/src/__tests__/tool-gateway.test.ts
pnpm exec tsc --noEmit -p server/tsconfig.json
./companies/optiak-ai-os/scripts/check.sh
# Only after Docker has enough space; creates a uniquely tagged build candidate.
node scripts/smoke/optiak-linear-build.mjs
```

The tests use real loopback HTTP, authenticated named-gateway MCP routes and
fresh embedded PostgreSQL clusters. Two independent database clients prove
single-flight serialization and persistence after service reconstruction. The
heartbeat test invokes Paperclip's real `process` adapter, checks the short-lived
run token, performs six reads and rejects the seventh, then inspects actual
`heartbeat_run_events`, `stdoutExcerpt`, `resultJson` and the durable run-log file.
The terminal run token cannot reopen the sample; a run-less named token cannot
dispatch. No live company DB, OAuth credential or model inference is used.

A **test-only** bootstrap verifies the heartbeat JWT and delivers the normal
run-bound MCP token to the deterministic process. It does not prove Codex's
native MCP configuration delivery. The `remoteHttpRequest` seam directs the
approved endpoint to the fixture; it does **not** prove production DNS/SSRF,
live OAuth, Linear's current response format or deployment of this Docker image.
Canaries cover provider bodies, headers and nested identities across returned
results, invocation rows, tool-call events, access audit, activity and elicitation
cards, plus heartbeat output and run logs. Historical raw rows are deliberately
retained while replay is denied.
Other gateway and content-guard regressions run with the feature disabled.

On 2026-09-12 the six listed Vitest suites passed **143/143** tests, the company
package passed **136/136** tests plus secret/static/reproducible-ZIP checks, and
the local server TypeScript check passed. No repo-wide PR-ready typecheck, test
or build claim is made; browser suites were not needed for this non-UI change.

The existing Dockerfile supplies checksum-verified rustup and the runner's pinned
Rust 1.97.1, resolving the host's missing `cargo` without installing it on the host.
An isolated build completed UI, plugin SDK, runner (including replay snapshots)
and server compilation, but **image export failed: `no space left on device`**.
Docker's 126 GB internal filesystem was at 100%; no validated image was produced
or deployed. The compiled snapshot digest was
`8f6eab8d82a810e2321bb1f8ce8a4e15769d766f2a769699678db7de6b4d7cc3`;
the final-source attempt also failed and does not upgrade that evidence.

The helper copies only selected Git-tracked/nonignored source into a temporary
context, excludes company/instance state and credential filenames, rejects
symlinks and unexpected npm configuration, and never overwrites an active tag.
It prints the source digest, unique tag, temporary context and build-log path.
Source is currently dirty: no commit stamp is invented. Its target is `build`,
not the production image or deployment. Temporary source contexts/build cache
remain local. No Docker prune, image/volume removal or service restart was run.
Resolve capacity with the operator before another build; **do not use a global
prune or delete volumes** to unblock this check.

Capacity follow-up (2026-09-12): the operator approved inspection/removal of
dispensable build cache only, explicitly excluding service images, containers and
volumes. During read-only inspection, cache dropped from 207 to 100 records
without an assistant-issued prune; free Docker space recovered to about 8 GiB
(94% used). Only 38.93 MB remained private; the other 16.19 GB was shared with
images. Shared-cache removal does not release layers still needed by images.
[Docker cache accounting](https://docs.docker.com/reference/cli/docker/buildx/du/)
documents this distinction. No manual removal or new build was performed.

Before/after inventories matched: 18 containers with unchanged image IDs,
running state and start time, 55 unique image IDs and 44 volumes. Optiak health
was `ok`, ten agents remained paused, zero runs were active and all four routine
triggers stayed disabled. The current Desktop disk limit is 128 GiB. Proposed
next step: raise it to 144 GiB to leave build headroom, **subject to separate
operator approval**, including any Docker restart/service interruption. This
inspection neither completes image verification nor authorizes deployment.

## Remaining rollout gates and rollback

1. Resolve Docker capacity with operator approval, rebuild the final source and
   pin its Git revision and resulting image. Durable sample and synthetic heartbeat
   proof are complete; image export is not. A ZIP cannot install this core hook.
2. Agree any chosen content-review contract and review direct bypasses; keep
   schedules and agents paused. Metadata-only is not semantic Product triage.
3. Export the company; back up DB, files and operator connection/profile settings.
   Record the currently working image. Do not overwrite the v0.1.13 offline ZIP.
4. Review all direct paths and narrow Product's desired access to the reviewed
   tools. Bind only the existing Optiak connection, preserving its OAuth grant.
5. Repeat the synthetic proof in the final deployment image/configuration and
   inspect configured log exporters; the source test has already covered local
   PostgreSQL, authenticated MCP and process/run logs. Then do a separately scoped live read on Optiak with
   fresh context, agents otherwise paused. Verify catalog, OAuth and content shape.
6. Confirm the live environment binding and postconditions before any activation.
   No inference budget or broad Product automation is approved by a unit test.

On failure, first pause the affected agent/triggers and revoke its connection
access. Keep exports and audit evidence. Roll back the image/settings with the
connection denied; **unsetting the filter while leaving direct access allowed
reopens raw results**. Re-enable only after the boundary is verified again.

The active local instance was not restarted, reconfigured or imported during
this core-candidate implementation. GitHub remains on hold; Enki is untouched.
