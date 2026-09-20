# Offline pull-request fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-pr-review-fixture/v1",
  "evidenceMode": "remote_mcp",
  "repository": "optiak/optiak",
  "baseRevision": "fixture-base-sha",
  "headRevision": "fixture-sha-001",
  "author": "platform-engineer",
  "reviewer": "independent-reviewer",
  "changes": ["Load application policy by application id", "Add provider retry"],
  "tests": ["happy path routing"],
  "commandsRunByReviewer": [],
  "worktreeCreatedByReviewer": false,
  "expectedVerdict": "request_changes"
}
```
