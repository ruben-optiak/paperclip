# Result taxonomy

Every final Optiak report must keep five independent layers explicit:

| Layer | Field | Meaning |
| --- | --- | --- |
| Paperclip work | `paperclip.issueDisposition` | Workflow state of the assigned issue; `done` means the requested report was persisted |
| Report history | `report.state` and `report.canonical` | Whether this report is final, interim, or superseded and whether it is the current result for the exact review target |
| Reviewed object | `object.verdict` | Skill-specific verdict for the exact object revision, such as `changes_required`, `pass`, or `blocked` |
| Operations | `operations.readiness` | Whether an operational or release-readiness assessment was made and its result |
| Evidence | `evidence.scope` and `evidence.prerequisiteState` | Authority level and whether the evidence required for the review existed |

Never summarize these layers with an unqualified `done`, `complete`, `PASS`, `blocked`, or `ready`. A completed issue may contain `object.verdict: changes_required`; a successful agent run may contain a failed test; a fixture pass does not imply operational readiness.

Use `optiak-result-envelope/v1`. The bundled JSON Schema is `references/contracts/result-envelope-v1.schema.json` inside this skill. In a Markdown report the same fields may be rendered as a compact labelled list; field names and values must remain exact.

New completions use the bundled validator and completion helper before writing.
The allowed evidence scopes are `missing`, `fixture_only`,
`connected_non_production`, and `production`. A connected Linear backlog review
uses `connected_non_production` and readiness `not_assessed`; this is not a claim
that staging, application behavior or production was validated. Never invent a
scope label to describe a narrow sample: record that coverage in its source ledger.

## Canonical selection

The canonical identity is the tuple `(object.type, object.revision, object.reviewKind)`.

- At most one report is canonical for that tuple.
- At most one canonical report may be emitted by one run.
- A canonical report is a final `object_review` with its evidence prerequisite available and a run-linked persisted report.
- A prerequisite diagnosis or recovery-coordination message is never the object verdict.
- When a repaired prerequisite or explicitly approved retry produces a new canonical review, preserve older reports, mark them `superseded`, and point `supersededBy` to the new report reference. Do not delete history.
- If two eligible reports disagree and provenance cannot select one, set neither to canonical and escalate the conflict to the Board.

## Repaired-prerequisite example

If an early run reports that a requested fixture path is absent and a later Board-authorized retry reviews a repaired portable fixture:

- the early report is `purpose: prerequisite_diagnosis`, `object.verdict: not_assessed`, `evidence.prerequisiteState: missing`, and later `report.state: superseded`;
- the later review is `purpose: object_review`, carries the skill-specific verdict, and may be canonical;
- Paperclip may mark the review issue `done` because the report exists, even if the reviewed object needs changes;
- operational readiness remains `not_assessed` unless that separate gate was actually run.
