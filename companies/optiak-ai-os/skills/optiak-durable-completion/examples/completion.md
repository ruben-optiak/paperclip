# Example completion

After checkout and the requested fixture analysis, the agent holds this report in memory:

```md
## Complete

- Scope: synthetic completion fixture only.
- Result: the expected disposition is `done`.
- Evidence time: `2026-09-02T09:15:00Z`, supplied by the fixture; this is not the execution time.
- Execution time: recorded by Paperclip on this comment.
- External actions: none.
```

It sends one final update whose conceptual payload is:

```json
{
  "status": "done",
  "comment": "<the in-memory Markdown report above>"
}
```

It does not post the report separately. If the response is ambiguous, it reads the issue and comments and matches the current run id before deciding whether any reconciliation write is necessary.
