# Offline debugging fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-debug-fixture/v1",
  "environment": "fixture",
  "version": "fixture-r1",
  "symptom": "Streaming response has headers but no client events",
  "observations": ["HTTP status is 200", "No event timestamp is available"],
  "secretsRedacted": true,
  "expectedOutcome": "ranked_hypotheses_not_root_cause"
}
```
