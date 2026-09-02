# Incident response

An incident workflow starts from a trusted connected alert or an explicit human report. No alert connection means no automatic on-call coverage.

Use `observability-and-oncall.md` and the versioned observability source
contract for source order, freshness, correlation, redaction, and query bounds.

1. Verify signal source, environment, version, timestamp, and freshness.
2. Assign severity provisionally and name incident owner and next checkpoint.
3. Preserve a redacted timeline and affected capabilities.
4. Identify the safest evidence-gathering step and reversible mitigation proposal.
5. Escalate security/data implications immediately to the Board.
6. Delegate diagnosis or code work without transferring incident ownership.
7. Require independent review and regression validation for changes.
8. Close only with fresh recovery evidence, an explicit incident-owner decision, and durable follow-up ownership. A cleared alert is insufficient by itself.
9. Produce a blameless postmortem for material incidents.

Agents may recommend rollback or failover but may not execute production actions in v0.1.
