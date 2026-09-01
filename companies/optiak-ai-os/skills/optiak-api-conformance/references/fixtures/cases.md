# Offline API conformance fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-api-conformance-fixture/v1",
  "cases": [
    {"id": "chat-auth-missing", "surface": "chat_completions", "auth": "missing", "expected": "authentication_error"},
    {"id": "responses-stream-cancel", "surface": "responses", "stream": true, "action": "cancel", "expected": "bounded_termination"},
    {"id": "smart-routing", "surface": "responses", "model": "smart", "expected": "eligible_model_or_documented_error"}
  ]
}
```
