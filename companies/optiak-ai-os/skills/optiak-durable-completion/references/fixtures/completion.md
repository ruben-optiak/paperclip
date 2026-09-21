# Offline durable-completion fixture

Use only as synthetic evidence. The evidence timestamp belongs to the fixture and is not the agent's execution time. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-durable-completion-fixture/v1",
  "issue": {
    "id": "fixture-issue-durable-completion",
    "initialStatus": "in_progress",
    "expectedStatus": "done"
  },
  "run": {
    "id": "fixture-run-durable-completion"
  },
  "evidence": {
    "observedAt": "2026-09-02T09:15:00Z",
    "timestampSource": "fixture",
    "timezone": "UTC"
  },
  "expected": {
    "payloadStorage": "memory",
    "dispositionRequests": 1,
    "standaloneReportPosts": 0,
    "reportsCreated": 1,
    "statusTransitionsRequested": 1,
    "createdByRunId": "fixture-run-durable-completion",
    "executionTimestampSource": "paperclip_comment_metadata",
    "ambiguousWritePolicy": "refetch_before_retry"
  }
}
```
