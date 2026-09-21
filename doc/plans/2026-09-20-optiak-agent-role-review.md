# Optiak AI OS — controlled ten-agent role review

Date: 2026-09-20
Reviewed package: `companies/optiak-ai-os/` version `0.1.28`
Instance: local Optiak instance on `http://127.0.0.1:3200`
Evidence scope: synthetic fixtures only

## Outcome

The ten imported agents produced the intended role-specific canonical output
without external writes, child issues, repository access, live-source claims or
automatic activation. The role boundaries introduced by `OAI-050` are coherent
as a system: Product owns intent, Architecture owns structural choice, Senior
Engineering owns diagnosis, Review owns the immutable-change verdict, QA owns
observed behavior, Reliability owns runtime/tabletop risk and Engineering
Assurance owns evidence completeness.

Nine role executions completed cleanly from a role-behavior perspective. The
Documentation/DX content also passed, but its first run posted the report without
the required final issue disposition. Paperclip correctly queued one corrective
run. This is an orchestration/completion defect, not a documentation-analysis
defect, and must be regressed before the matrix is repeated.

The Director also has two historical runs, but the first is excluded from the
role verdict: the Board created the task already assigned while the agent was
paused. Paperclip recovered the stranded assignment as designed. The valid
Director review was the later bounded on-demand run. Future controlled reviews
must create the issue unassigned, resume the single agent and only then assign it.

Final instance state is ten agents paused and zero intentional external writes.
A passing fixture review does not demonstrate a live source, repository,
runtime, implementation, deployment or production capability.

## Method

Each case used the same controls:

1. Create one unassigned fixture-only issue.
2. Resume exactly one agent.
3. Assign the issue, allowing one assignment-triggered run.
4. Require one lead class, one bounded question and one canonical report.
5. Prohibit browsing, connected sources, repository access, child issues,
   implementation, release action and external writes unless the case explicitly
   represents that evidence as an immutable fixture.
6. Inspect the persisted issue, comments and run metadata.
7. Pause the agent before starting the next case.

The first Director attempt predates step 1 and is retained as negative evidence.

## Results

`New input` is gross input minus cached input. It is a context-efficiency signal,
not a monetary cost. The account reports these runs as
`subscription_included`; that means price is unavailable, not zero.

| Agent | Issue | Canonical run | Result | Duration | New input | Output |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Director of Optiak | [OPT-66](/OPT/issues/OPT-66) | `b5f2d029` | Pass; one lead and one bounded architecture handoff | 83 s | 26,368 | 3,216 |
| Product and PRD Lead | [OPT-67](/OPT/issues/OPT-67) | `42029ae7` | Pass; `changes_required` without architecture or implementation overreach | 119 s | 35,807 | 5,457 |
| Brand and UI Quality Reviewer | [OPT-68](/OPT/issues/OPT-68) | `e09d1a13` | Pass; exact visual findings without claiming functional behavior | 51 s | 18,544 | 2,162 |
| Documentation and DX Steward | [OPT-69](/OPT/issues/OPT-69) | `c525da8f` | Pass after corrective run; first report omitted final disposition | 95 s | 42,532 | 5,856 |
| Principal Platform Architect | [OPT-70](/OPT/issues/OPT-70) | `aa4fbcad` | Pass; chose trust boundary, migration and rollback without implementing | 118 s | 26,897 | 4,430 |
| Senior Platform Engineer | [OPT-71](/OPT/issues/OPT-71) | `5dd96fb0` | Pass; isolated the minimal diagnosis and test surface | 55 s | 14,382 | 2,347 |
| Independent Code and PR Reviewer | [OPT-72](/OPT/issues/OPT-72) | `6eaf0afd` | Pass; requested changes for missing isolation tests, without fixing them | 109 s | 31,117 | 4,880 |
| QA and E2E Validation Engineer | [OPT-73](/OPT/issues/OPT-73) | `e532a23c` | Pass; 4 pass, 1 fail, fixture-bounded impact and no root-cause claim | 155 s | 19,708 | 7,298 |
| Reliability and Incident Response Engineer | [OPT-74](/OPT/issues/OPT-74) | `80724cc5` | Pass; tabletop facts, hypotheses and reversible containment stayed separate | 97 s | 40,960 | 4,340 |
| Engineering Assurance Lead | [OPT-75](/OPT/issues/OPT-75) | `845aef59` | Pass; `blocked_on_evidence` for the missing rollback drill | 85 s | 20,917 | 3,947 |

Canonical runs total 2,120,304 gross input tokens, 1,843,072 cached input
tokens, 277,232 new input tokens, 43,933 output tokens and 967 seconds.

The two non-canonical/recovery runs add 922,350 gross input tokens, 845,056
cached input tokens, 77,294 new input tokens, 6,700 output tokens and 175
seconds. Total observed execution was therefore 12 runs, 354,526 new input
tokens, 50,633 output tokens and 1,142 seconds. The recovery overhead is material
and justifies a dedicated regression rather than accepting successful final
state as sufficient.

## Gate assessment

| Gate | Assessment |
| --- | --- |
| Correct lead class | Pass for all ten canonical reports |
| One bounded lead question | Pass |
| Canonical output only | Pass for canonical reports; OPT-69 retains the first provisional report as history |
| Evidence and freshness explicit | Pass; every report labels fixture scope and time provenance |
| Excluded work explicit | Pass |
| No parallel full report | Pass; no consultations or fanout occurred |
| Distinct-delta handoff | Pass; each handoff names one owner and bounded next evidence |
| No authority overreach | Pass; no implementation, merge, deployment or release authorization |
| Stop condition | Pass for role content; completion retry required on OPT-69 |
| Proportionate context/output | Pass with follow-up: all runs stayed below 300 s, but recovery overhead and QA output merit continued budget review |

## Findings and required follow-up

### F1 — Controlled assignment order must be explicit

Creating an already-assigned issue for a paused agent produces a stranded
assignment and recovery activity. The review runner must enforce:

`create unassigned -> resume one agent -> assign -> wait -> inspect -> pause`.

The negative evidence is the first OPT-66 run `474dc3f4`; the canonical role
evidence is `b5f2d029`.

### F2 — Final disposition must be part of every review case

The common `optiak-durable-completion` skill already requires one combined final
update. The controlled case template must additionally state that the canonical
report and final issue disposition are persisted in the same run. A standalone
completion comment is a failing review even when its content is correct.

The negative evidence is OPT-69 run `8cf55b94`; the corrective canonical run is
`c525da8f`.

### F3 — Regress behavior without mutating package `0.1.28`

The validated `0.1.28` ZIP and its recorded digest must remain immutable. The
assignment-order and final-disposition hardening belongs to the next package
candidate. The acceptance test is ten fixture cases, ten assignment-triggered
runs, ten final dispositions, no recovery runs, zero external writes and all ten
agents paused at the end.

## Decision

`OAI-050` is validated as a role and routing design. It does not authorize agent
activation, implementation or routines. Track the controlled-run hardening
separately, then continue `OAI-051` for the dedicated QA source-execution runner.

## OAI-053 hardened-runner regression attempt — 2026-09-21

The Board authorized ten fresh fixture-only issues and one sequential execution
per agent. The runner failed closed before any agent execution when its fixture
priority used the obsolete value `normal`; the current CLI contract accepts
`medium`. That preflight defect created no issue and resumed no agent.

After correcting priority and adding suite-scoped fixture titles, the live suite
created [OPT-76](/OPT/issues/OPT-76) unassigned, resumed only the Director,
assigned the issue and observed exactly one assignment-triggered run,
`f75791c5-e9ae-4602-8806-f5f8b113dbb6`. The run succeeded, persisted one
`ROLE_REVIEW_FINAL` comment, set the issue to `done`, left zero active or recovery
runs and returned the Director to `paused`.

The harness still rejected the case. Inspection showed two harness defects:

1. `issue runs` exposes the identifier as `runId`, while the harness read `id`.
2. Backticks around `External writes: 0` were removed while `pnpm` transported
   the prompt, so OPT-76's stored description omitted the declaration and the
   agent was never instructed to emit it.

The runner now normalizes `runId`/`id`, uses shell-safe plain text for the exact
zero-write declaration, uses current priority `medium`, exposes useful redacted
CLI diagnostics and gives each suite unique titles. Offline tests cover those
three compatibility boundaries. OPT-76 remains negative harness evidence; it is
not reclassified as a pass and no automatic recovery or repeat was issued. The
suite stopped before the other nine agents, and live parity confirmed 10/10
agents paused with zero configuration drift. The Board subsequently authorized
a fresh Director fixture followed by the nine remaining cases.

## OAI-053 completed live regression — 2026-09-21

The corrected harness completed a new sequential suite over
[OPT-77](/OPT/issues/OPT-77)–[OPT-86](/OPT/issues/OPT-86) with overall verdict
`pass`.

| Agent | Issue | Assignment run | Verdict |
| --- | --- | --- | --- |
| Director of Optiak | [OPT-77](/OPT/issues/OPT-77) | `178e4a3a` | Pass |
| Product and PRD Lead | [OPT-78](/OPT/issues/OPT-78) | `bc966a64` | Pass |
| Brand and UI Quality Reviewer | [OPT-79](/OPT/issues/OPT-79) | `390394d2` | Pass |
| Documentation and DX Steward | [OPT-80](/OPT/issues/OPT-80) | `13a90148` | Pass |
| Principal Platform Architect | [OPT-81](/OPT/issues/OPT-81) | `760cfe0e` | Pass |
| Senior Platform Engineer | [OPT-82](/OPT/issues/OPT-82) | `6b3e99d1` | Pass |
| Independent Code and PR Reviewer | [OPT-83](/OPT/issues/OPT-83) | `21d79bee` | Pass |
| QA and E2E Validation Engineer | [OPT-84](/OPT/issues/OPT-84) | `03cc5940` | Pass |
| Reliability and Incident Response Engineer | [OPT-85](/OPT/issues/OPT-85) | `848a48f4` | Pass |
| Engineering Assurance Lead | [OPT-86](/OPT/issues/OPT-86) | `4d283e2b` | Pass |

Every case independently satisfied the complete state machine:

`paused → issue created unassigned → resumed → assigned → one assignment run → ROLE_REVIEW_FINAL + done → inspected → paused`

The aggregate evidence is ten successful assignment runs, ten canonical reports
bound to their originating run, ten final `done` dispositions, ten exact
`External writes: 0` declarations, zero retries, zero recovery runs and zero
active runs after inspection. The independent parity doctor then observed all
ten expected agents, compared sixteen fields per agent and returned `pass` with
no violations or warnings.

This closes `OAI-053`. It validates only the fixture-only role-review harness and
completion behavior on the connected local instance. It does not authorize
continuous activation, connected-source access, implementation, external
writes, publication, deployment or release.

The final candidate passed 161 package tests, three QA runner tests, twelve
executed Linear publisher tests with one loopback-only test skipped, the secret
scan and deterministic-archive verification. The post-regression archive is
`/tmp/optiak-ai-os-v0.1.29-live-verified.zip` (237 files, 1,057,248 bytes),
SHA-256 `f437fa8650be5f3e48d3624bf62b4144281a247931d6a29240533fb094bacc68`.
