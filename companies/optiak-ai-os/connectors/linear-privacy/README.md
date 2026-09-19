# Linear privacy boundary — offline candidate

Status: **implemented and tested offline; not deployed, connected or protective
of the current instance**. No server, credential, OAuth client, Docker service,
vault integration or new Paperclip catalog entry is included.

## Finding and placement

The inspected Paperclip gateway normalizes MCP content into a string plus a
`data` object, calls `validateToolContent`, stores `resultValidation.summary` in
the invocation and events, and returns `resultValidation.value` to the caller.
The summary includes up to 4000 characters, size and hash: do not describe every
audit row as an unbounded copy of the entire response. Identity data can still
survive in those snippets and the returned result/run output. Current secret
redaction is not a general personal-data projection.

Source: `server/src/services/tool-gateway.ts` (`normalizeMcpToolResult`, normal
and approved completion paths), `tool-content-guards.ts` (`summarizeToolValue`,
`validateToolContent`), and `server/src/redaction.ts`. This is local instance
audit/run data, not the first-party Telemetry event path.

The official [Linear MCP documentation](https://linear.app/docs/mcp), checked
2026-09-12, defines the read-only endpoint and read OAuth scope. Read-only means
no writes; it is not a promise to omit personal information from responses.

The necessary ordering is:

`authorized provider read → strict projection → Paperclip normalization/guard → agent + audit`

An agent-side helper or wrapper calling the *existing Paperclip gateway* is too
late. `projectLinearMcpResult` rejects Paperclip's `{content, data}` wrapper. It
accepts raw MCP result JSON text, not a JSON-RPC envelope or arbitrary prose.
One JSON text block is supported; matching structured content is accepted and
discarded after comparison. Images/resources/ambiguous shapes fail closed.

## Executable surface

`projection.mjs` exports:

- `normalizeRequest(toolName, args)`: three exact read tools and bounded args.
- `projectLinearMcpResult({toolName, arguments, wireText, retrievedAt})`: pure
  projection. It throws on malformed input; use the reader at an I/O boundary
  to obtain safe errors. It does not prove authorization or live freshness.
- `createProjectedLinearReader({dispatch, getCatalogEntry, baseline?, now?,
  timeoutMs?})`: one reader per future authenticated run/session. The trusted
  integration supplies catalog and provider dispatch; agents must never supply
  callbacks, baselines, credentials, clocks or timeout settings.

The reader returns only `{mcpResult, audit}`. It checks the reviewed catalog
fingerprints, uses a single in-flight slot, permits at most six dispatched
attempts, two five-item groups and three exact details from its own sample.
Unknown tools, mutations, free-text search, cursor expansion and personal-data
arguments are rejected before provider access. Archived rows and known
status/group contradictions also fail closed. An unknown
custom status stays unknown, not proof that the provider applied its group filter.
Schema drift, malformed output,
errors and timeout disable that reader; there is no fallback or automatic retry.
Default deadline is ten seconds, capped at fifteen. The production transport
must also bound response bytes while streaming and honor AbortSignal; this
module cannot stop a malicious/buggy callback or erase its process memory.

## Output contract `optiak-linear-metadata/v1`

The output contains only static markers, retrieval time, team key, up to five
items per list and these per-item fields:

| Field | Constraint |
| --- | --- |
| `identifier` | Exact `OPT-` integer identifier; details must match the request |
| `url` | Validated Optiak workspace, reconstructed without the source slug/query |
| `updatedAt` | Valid UTC timestamp or explicit null; no future value |
| `statusClass` | Fixed vocabulary derived from known statuses; custom labels become unknown |
| `priority` | Integer 0–4 or explicit null; no provider label |

Titles, descriptions, assignees, creators, names, emails, comments, labels,
customer needs, attachments, links, provider metadata, cursors and unknown
fields are not forwarded. Free text is excluded, not made safe by an email regex.
Diagnostics contain fixed reason codes and hashes of projected bytes only, never
raw hashes, exceptions or dynamic field names. Resource identifiers/time/priority
remain internal business metadata; this is minimization, **not anonymization**
or a guarantee against covert encoding by a malicious provider.

Every success says `semanticReviewAvailable: false` and
`evidenceScope: not_established_by_projection`. This is a projection contract,
not the final-report evidence enum. Product can inspect workflow metadata, but
cannot infer intent, acceptance criteria, business priority or duplicates.
A useful content-review mode needs a separate explicitly accepted data contract;
do not silently pass titles/descriptions to preserve apparent usefulness.

## Reproduce without accounts

From repository root:

```sh
node --test companies/optiak-ai-os/tests/linear-privacy.test.mjs
./companies/optiak-ai-os/scripts/check.sh
```

Optional integration probe against the installed repo, with Node supporting
`node:sqlite` (tested on 25.2.1) and workspace dependencies already installed:

```sh
node --import ./cli/node_modules/tsx/dist/loader.mjs companies/optiak-ai-os/scripts/probe-linear-privacy-core.mjs --paperclip-root .
```

It imports the **actual Paperclip content guard**, reproduces the identity-canary
gap, projects the same synthetic response and round-trips five output/receipt
shapes through an isolated in-memory SQLite database. No `DATABASE_URL`, instance
connection, credential, file database or real provider is used. SQLite's API is
documented by [Node](https://nodejs.org/api/sqlite.html). This proves the guard
and serialization boundary with fixtures, **not** routing through the running
Paperclip HTTP gateway, PostgreSQL persistence, OAuth, transport logging or
production protection. Changes to gateway normalization require rechecking the
small normalization mirror in the probe.

## Runtime gate — intentionally not implemented

Choose and approve placement before activating anything:

- A company/connection-scoped generic core hook can preserve the existing vault
  and OAuth grant, but needs a separate core change and coverage of *every*
  result/error/test/replay/logging path.
- A private MCP wrapper can preserve the no-core-change boundary, but requires
  its own reviewed provider authentication, private deployment and server auth.
  Never extract or forward Paperclip's audience-bound OAuth token to it.

For either route require: a backup; exact candidate/image identity; no raw
transport/stdout logging; no direct bypass for Product; quarantine and deny
defaults; validated workspace identity and per-session budgets; cancellation
and body-size enforcement; synthetic canaries through the actual HTTP gateway
and every persistent sink; bounded live smoke; restore/rollback rehearsal.
Existing preflight currently requires the official endpoint. Do not weaken it
to make a wrapper appear reviewed. Approve and version the replacement contract.

Importing this package alone installs **no privacy boundary**. Keep agents and
routines paused during rollout. A rollback must not silently reopen the raw
connection; halt affected reads and let the operator decide. Do not delete or
rewrite audit history. Retention/deletion is a separate operator decision.
