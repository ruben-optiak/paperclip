# Quality and evidence model

Every material finding must include:

- stable finding id and exact target revision;
- source, environment, retrieval/observation time, and freshness;
- persona, route/endpoint/component/contract, and prerequisites;
- expected and observed behavior;
- exact reproduction or review method;
- redacted evidence and evidence location;
- severity, confidence, reproducibility, and blast radius;
- product, architecture, security, docs, cost, and operational impact as applicable;
- recommended next owner and verification action;
- explicit unknowns and exclusions.

## Severity

- Critical: confirmed severe security, cross-tenant, data integrity, or platform-wide production risk.
- High: likely material correctness, compatibility, availability, or governance failure.
- Medium: meaningful product, accessibility, operability, test, documentation, or maintainability defect.
- Low: bounded improvement with limited current impact.

Severity describes impact, not certainty. Confidence and reproducibility are separate fields.

## Evidence strength

From strongest to weakest:

1. reproduced against an identified immutable release/environment;
2. immutable code/schema plus focused executable test;
3. correlated trusted telemetry or trace evidence;
4. direct UI/API observation with exact environment;
5. internally consistent public documentation;
6. local fixture;
7. hypothesis or heuristic.

Fixtures prove the workflow, not the current product.

## Result layers and history

A successful run, a completed issue, a final report, an object verdict, and operational readiness are different claims. Every final report follows the common contract in `skills/optiak-durable-completion/references/result-taxonomy.md` and its bundled `optiak-result-envelope/v1` schema.

- Paperclip `done` means the requested report was persisted; it does not approve the reviewed object.
- A skill-specific `pass`, `fail`, `blocked_on_evidence`, or `changes_required` applies only to the named object revision and review kind.
- `operations.readiness` remains `not_assessed` unless the operational or release gate actually ran.
- Prerequisite diagnoses and recovery messages are historical reports, not object verdicts.
- Only one run-linked report is canonical for an exact object revision and review kind. A repaired retry supersedes earlier prerequisite diagnostics without deleting them.
