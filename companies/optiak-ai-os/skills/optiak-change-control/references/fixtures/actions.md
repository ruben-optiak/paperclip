# Offline change-control fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-change-control-fixture/v1",
  "cases": [
    {"action": "read_public_docs", "environment": "public", "expectedLevel": "green"},
    {"action": "create_synthetic_staging_application", "environment": "staging", "expectedLevel": "yellow"},
    {"action": "merge_pull_request", "environment": "repository", "expectedLevel": "orange"},
    {"action": "destructive_production_test", "environment": "production", "expectedLevel": "red"}
  ]
}
```
