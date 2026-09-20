# Optiak pull-request review rubric

Use this rubric for non-trivial diffs, shared contracts, security or data
boundaries, performance-sensitive paths, infrastructure, or changes that rely
on external APIs. It refines review judgment; it does not expand repository or
execution authority.

## Finding standard

Report actionable findings supported by the exact reviewed revision. Prefer a
small number of high-confidence defects over broad commentary. A finding must
name the affected path or contract, plausible execution path, impact, evidence,
and smallest credible fix direction.

Prioritize:

1. correctness, data loss, security, privacy, authentication, authorization,
   tenant isolation, secrets, and irreversible operations;
2. runtime failures, API/schema drift, migrations, backward compatibility,
   concurrency, retries, and idempotency;
3. performance on real hot paths, large data paths, rendering paths, repeated
   I/O, capacity, or cost;
4. tests missing the changed behavior or realistic failure modes;
5. repository-pattern mismatches that create risk, duplication, or brittle
   ownership;
6. bounded improvements that materially reduce complexity or operational risk.

Do not report personal style preferences, hypothetical failures without a
plausible path, or large rewrites when a local fix resolves the defect. When a
conclusion depends on unavailable intent or authority, return a question or
`blocked_on_evidence` instead of presenting uncertainty as fact.

## Behavior and contract checks

Trace affected flows beyond the changed lines. Check relevant callers,
callees, UI/API journeys, persistence, background work, feature flags,
imports/exports, and operational paths for:

- null, empty, partial, default, time-zone, locale, currency, and precision
  behavior;
- async ordering, cancellation, stale state, retries, deduplication,
  idempotency, and races;
- validation, network, provider, fallback, and error behavior;
- client/server schemas, public endpoints, events, migrations, and stored-data
  compatibility;
- user, organization, company, tenant, and permission scoping;
- secret handling, unsafe input/output, logging, telemetry, and audit effects;
- loading, empty, error, permission, responsive, and accessibility behavior for
  changed UI paths.

Compare with existing implementations in the same repository before declaring
a convention defect. Tests must exercise the intended contract and risky
branches rather than merely mirror the implementation or prove only the happy
path.

## Performance checks

Look for repeated work per render, request, row, watcher, or polling cycle;
unbounded loops or allocations; N+1 and waterfall I/O; excessive invalidation;
broad reactive dependencies; unstable keys; blocking server work; poor query
shape or pagination; missing backpressure; and retained subscriptions, timers,
listeners, or caches.

Performance becomes a finding only when tied to expected scale, a real hot
path, or a structurally unavoidable cost. State the assumption when impact
depends on unavailable runtime evidence.

## External contract checks

When behavior depends on a framework, SDK, provider, protocol, browser API, or
standard, use only an approved current primary source. Verify version,
signature, default, lifecycle, deprecation, error, rate-limit, and security
semantics. Cite the source when it materially supports the verdict. If that
source is unavailable, mark the behavior unverified.

## Validation evidence

In remote MCP mode, inspect the exact diff, bounded surrounding files, commit
status, and available Actions evidence. Do not claim commands were run.

In a Paperclip-provided execution workspace, run only repository-defined,
policy-permitted targeted checks. Never edit the review object, create another
worktree, switch branches, or clean up Paperclip's workspace. Record every
command and result, separating pre-existing failures from review findings.

## Output order

1. Findings ordered by `critical`, `high`, `medium`, then `low`.
2. Open questions or assumptions that affect confidence.
3. Tests and validation actually observed or run.
4. External documentation checked.
5. Residual risk and unreviewed surfaces.

Each finding uses:

```text
- [severity] path:line — concise defect
  Impact: concrete failure or regression.
  Evidence: exact-revision evidence.
  Fix: smallest credible correction direction.
```

If no issue is found, say `No issues found` and still report validation coverage
and residual risk. An `approve` verdict never merges or releases the change.
