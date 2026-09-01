# Offline product-triage fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-product-triage-fixture/v1",
  "items": [
    {
      "id": "finding-001",
      "sourceType": "staging_observation",
      "persona": "application_admin",
      "problem": "One-time credential visibility is unclear",
      "expectedDisposition": "candidate"
    },
    {
      "id": "idea-002",
      "sourceType": "unsupported_assumption",
      "problem": "Build a general chatbot designer",
      "expectedDisposition": "board_decision"
    }
  ]
}
```
