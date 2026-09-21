# Offline E2E journey fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-e2e-journey-fixture/v1",
  "id": "application-credential-onboarding",
  "environment": "fixture",
  "persona": "organization_admin",
  "steps": ["create synthetic application", "create application API key", "record one-time visibility", "revoke key"],
  "mutationLevel": "yellow",
  "expectedResultWithoutConnection": "blocked"
}
```
