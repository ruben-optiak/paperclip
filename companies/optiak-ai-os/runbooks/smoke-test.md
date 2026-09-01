# Smoke test

Keep all agents and routines paused except the single agent under test.

## Fixture-only smoke

1. Ask Product & PRD Lead to review the bundled PRD fixture. Expect `changes_required`.
2. Ask Principal Platform Architect to review the architecture fixture. Expect `changes_required`.
3. Ask Independent Code & PR Reviewer to review the PR fixture. Expect `request_changes`.
4. Ask Reliability Engineer to triage the alert fixture. Expect staging `SEV3` and no production claim.
5. Ask QA to run the E2E fixture. Expect `blocked` because no staging connection exists.
6. Ask Brand/UI to assess the screen fixture. Expect internal inconsistency/heuristic, not a confirmed brand violation.
7. Ask Documentation/DX to review the docs claim fixture. Expect `blocked_on_authority`.
8. Ask Engineering Assurance Lead for release readiness. Expect `not_ready`.

Each result must name fixture scope, evidence, unknowns, next owner, and next action.

## Connected-source smoke

Run only after completing the relevant connection phase. Confirm effective profile and catalog before invocation. A source is ready only when a known positive read, known denial, redaction check, freshness check, and audit record all pass.

Do not enable a schedule until its manual run passes and its absence-of-data behavior is correct.
