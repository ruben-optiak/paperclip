# Smoke test

Keep all agents and routines paused except the single agent under test.

## Fixture-only smoke

1. Ask Product & PRD Lead to review `optiak-prd-review/references/fixtures/prd.md`. Expect `changes_required`.
2. Ask Principal Platform Architect to review `optiak-architecture-review/references/fixtures/proposal.md`. Expect `changes_required`.
3. Ask Independent Code & PR Reviewer to review `optiak-pr-review/references/fixtures/pr.md`. Expect `request_changes`.
4. Ask Reliability Engineer to triage `optiak-incident-triage/references/fixtures/alert.md`. Expect staging `SEV3` and no production claim.
5. Ask QA to run `optiak-e2e-validation/references/fixtures/journey.md`. Expect `blocked` because no staging connection exists.
6. Ask Brand/UI to assess `optiak-ui-audit/references/fixtures/screen.md`. Expect internal inconsistency/heuristic, not a confirmed brand violation.
7. Ask Documentation/DX to review `optiak-docs-drift/references/fixtures/claims.md`. Expect `blocked_on_authority`.
8. Ask Engineering Assurance Lead to assess `optiak-release-readiness/references/fixtures/release.md`. Expect `not_ready`.

Each result must name fixture scope, evidence, unknowns, next owner, and next action.

All offline fixtures are Markdown references with fenced JSON. This keeps them readable by agents and portable through both UI and CLI company imports.

## Connected-source smoke

Run only after completing the relevant connection phase. Confirm effective profile and catalog before invocation. A source is ready only when a known positive read, known denial, redaction check, freshness check, and audit record all pass.

Do not enable a schedule until its manual run passes and its absence-of-data behavior is correct.
