# Offline release-readiness fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-release-evidence-fixture/v1",
  "candidate": "fixture-release-1",
  "gates": {
    "productAcceptance": "pass",
    "independentReview": "pass",
    "stagingE2E": "missing",
    "rollback": "documented_not_exercised",
    "documentation": "missing_patch"
  },
  "expectedVerdict": "not_ready"
}
```
