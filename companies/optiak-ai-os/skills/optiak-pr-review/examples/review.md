# Example review

Revision: `fixture-sha-001`; author: `platform-engineer`; reviewer: `independent-reviewer`.

Evidence mode: `remote_mcp`; the reviewer created no checkout or worktree and
ran no local command.

Verdict: request changes.

High finding: the application lookup uses an application id without proving organization ownership before loading its credential policy. Add a company-scoped lookup and cross-tenant regression test.

Medium finding: retry behavior has no test for a provider timeout after partial streaming output.

Validation: the supplied happy-path result was read for the exact head; the
failure path was not demonstrated. Residual risk remains until that regression
test passes on the reviewed revision.
