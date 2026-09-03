# Offline PRD readiness cases

These compact cases are materialized against every contract gate by the test
and evaluator harness. They do not represent an accepted Optiak PRD.

```json
{
  "schema": "optiak-prd-readiness-fixture/v1",
  "prd": {
    "revision": "fixture-prd-r1",
    "title": "Synthetic platform preference"
  },
  "cases": [
    {
      "id": "complete-fixture",
      "defaultStatus": "pass",
      "overrides": {},
      "expectedVerdict": "ready_for_architecture"
    },
    {
      "id": "ambiguous-persona",
      "defaultStatus": "pass",
      "overrides": {
        "persona_outcome_and_value": "fail"
      },
      "expectedVerdict": "changes_required"
    },
    {
      "id": "missing-exact-revision",
      "defaultStatus": "pass",
      "overrides": {
        "immutable_prd_revision": "missing"
      },
      "expectedVerdict": "blocked_on_evidence"
    }
  ]
}
```
