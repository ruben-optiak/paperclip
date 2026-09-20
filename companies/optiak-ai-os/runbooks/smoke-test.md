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

Each result must name fixture scope, evidence, unknowns, next owner, and next action. It must also preserve the qualified `optiak-result-envelope/v1` layers: issue disposition, report state/canonicality, object verdict, operational readiness, and evidence state. A bare overall `done`, `complete`, `PASS`, `blocked`, or `ready` fails the smoke.

All offline fixtures are Markdown references with fenced JSON. This keeps them readable by agents and portable through both UI and CLI company imports.

## Connected-source smoke

Run only after completing the relevant connection phase. Confirm effective profile and catalog before invocation. A source is ready only when a known positive read, known denial, redaction check, freshness check, and audit record all pass.

For UI/API validation, run the static and live loopback probes in
`runbooks/test-environment.md` first. Reachable UI, Admin, or MCP endpoints do
not compensate for an unavailable Gateway, disconnected browser, unclassified
tenant, missing personas, unapproved provider spend, or missing cleanup path.
Use the versioned golden-journey matrix only after every readiness gate passes;
otherwise return one explicit `blocked` or `not_tested` result per case without
attempting the Yellow action.

For the initial Notion smoke, follow `runbooks/connections.md` Phase 2.0 and
`skills/optiak-notion-knowledge/references/notion-authority.yaml`. Verify both
installation and access target the ten current agents, not future agents. The
effective catalog must show exactly `3 Allowed / 0 Ask first / 42 Off`: `Get
tool access`, `Fetch Notion entities`, and `Query Notion data sources` only.
Run capability discovery first. Because the observed OAuth flow inherits the
authorizing user's access and has no page picker, do not claim root isolation
from OAuth success. Register exact approved IDs outside Git and use a dedicated
restricted Notion identity or enforcing proxy before the content smoke. Then
fetch one known page for Director, Product, Architect, and one task-linked
specialist; record source and retrieval timestamps. Prove an excluded page is
unavailable through identity/proxy policy or a known unshared reference, never
by sharing sensitive content for the test.

For the initial GitHub smoke, use only `optiak/optiak`,
`optiak/optiak-frontend`, and `optiak/iac-infra` through Independent Code and
PR Reviewer. Capture the
exact commit or PR head SHA, recheck it before verdict, and verify checks belong
to the same revision. For the initial fine-grained PAT, evidence is limited to
Actions runs and commit statuses; Check Runs may be unavailable and must block
the verdict when required. The catalog must expose reads only; policy must refuse
`optiak/optiak-tests` and all unlisted repositories. Do not attempt a write to
prove it is blocked. Follow `runbooks/connections.md` Phase 2.2 and
`skills/optiak-pr-review/references/repository-authority.yaml`.

Do not enable a schedule until its manual run passes and its absence-of-data behavior is correct.
