# Example review

Proposal: route every inference request through one synchronous policy service.

Verdict: changes required.

- Invariant at risk: one policy dependency becomes a global inference failure domain.
- Missing: latency budget, timeout semantics, cached-decision safety, fail-open/fail-closed policy, audit ordering, and rollback.
- Required evidence: load profile and failure simulation using synthetic requests.
- Alternative: versioned local policy snapshot with an auditable control-plane update path.
