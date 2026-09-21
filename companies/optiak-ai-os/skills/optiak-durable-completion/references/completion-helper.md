# Executable completion

The installed skill contains `scripts/complete-issue.mjs` and its validator.
No package-root checkout, npm install or third-party library is required; Node
is sufficient. Resolve the helper relative to this installed `SKILL.md`, not
relative to an imagined host workspace.

Call `prepareCompletion(input, context)` or run the CLI without flags to validate
without network access. Use `completeIssue(input, context, api)` or CLI `--submit`
only for the current checked-out task. Input JSON is passed in memory/stdin;
the CLI never prints the report body or credentials.

The server normalizes literal escaped line breaks. Use actual line breaks in
plain Markdown; the helper rejects literal backslash-n/backslash-r sequences
before sending rather than silently changing code examples. Structured ledger
strings are encoded safely so embedded JSON remains valid after normalization.
UTF-8 input is decoded only after assembling bytes, with malformed input rejected.

Context comes from `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`,
`PAPERCLIP_COMPANY_ID`, and `PAPERCLIP_AGENT_ID`. The API client uses only the
injected `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY`; it preserves bridge paths,
includes `X-Paperclip-Run-Id`, refuses redirects, and has a 15-second request
timeout. Never use host Board credentials inside the agent.

Input has exactly `body`, `envelope`, and optionally `productSample`.
`body` is Markdown (maximum 24 KB) without a second envelope. Construct:

```js
const context = {
  runId: process.env.PAPERCLIP_RUN_ID,
  issueId: process.env.PAPERCLIP_TASK_ID,
  companyId: process.env.PAPERCLIP_COMPANY_ID,
  agentId: process.env.PAPERCLIP_AGENT_ID,
};
input.envelope.report.runRef = context.runId;
input.envelope.report.reportRef = completionRef(context);
const api = createApi({
  baseUrl: process.env.PAPERCLIP_API_URL,
  token: process.env.PAPERCLIP_API_KEY,
  runId: context.runId,
});
const result = await completeIssue(input, context, api);
```

These functions are exported by `scripts/complete-issue.mjs`. The logical
`reportRef` is deterministically bound to the run and task before the server
allocates a comment ID. The verified result returns that actual `commentId`.
Do not use placeholders such as “this comment” or predict database IDs.

The helper is for `done` reports, including final prerequisite diagnoses. A
real approval/reviewer/blocker waiting path still follows the Paperclip skill;
this helper does not manufacture one or bypass execution policy. It deliberately
does not implement a server-wide idempotency lock: only one process may submit
the current run's report. It does not support concurrent writers.

## Product samples

Use `object.type: linear_backlog_sample`, `reviewKind: product_triage`,
`verdictVocabulary: optiak-product-sample/v1`, `verdict: review_complete`, and
`revision: OPT-sample@<retrievedAt>`. This verdict means the review is complete,
not that the sampled items pass. Each item carries one existing triage disposition:
`reject`, `needs discovery`, `candidate`, `scheduled`, `urgent defect`, or
`Board decision`. `scheduled` needs a real decision reference.

See `fixtures/connected-sample.md` for the exact input shape. Preserve the
distinction between observed priority/status and proposed disposition. Persist
only the bounded source ledger: identifiers, canonical Linear URLs, source time
(or explicit null when unavailable), retrieval time, rationale and next role.
Do not include assignee emails, bodies, customer needs, attachments or raw MCP
responses. Unknown structured fields and email addresses are rejected.

The initial supported sample is up to ten recent tickets and three details.
Connected freshness is checked against the process clock at submission, with a
15-minute maximum and no future timestamps. A larger or historical analysis
needs a separately scoped contract, not relaxed validation. Field checks do not
prove that queries occurred: the operator still checks the gateway audit.
Reconciliation of an identical already-persisted report is allowed after that
window; freshness is required before a new write, not to reclassify history.
