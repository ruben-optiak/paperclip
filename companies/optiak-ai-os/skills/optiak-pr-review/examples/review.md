# Example review

Revision: `fixture-sha-001`; author: `platform-engineer`; reviewer: `independent-reviewer`.

Verdict: request changes.

High finding: the application lookup uses an application id without proving organization ownership before loading its credential policy. Add a company-scoped lookup and cross-tenant regression test.

Medium finding: retry behavior has no test for a provider timeout after partial streaming output.
