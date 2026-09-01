# Offline pull-request fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-pr-review-fixture/v1",
  "headRevision": "fixture-sha-001",
  "author": "platform-engineer",
  "reviewer": "independent-reviewer",
  "changes": ["Load application policy by application id", "Add provider retry"],
  "tests": ["happy path routing"],
  "expectedVerdict": "request_changes"
}
```
