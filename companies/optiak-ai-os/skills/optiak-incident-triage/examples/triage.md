# Example triage

Signal: fixture alert reports elevated 5xx for one synthetic staging application.

- Environment: staging.
- Confidence: medium; one trusted synthetic check, no corroborating telemetry.
- Severity: SEV3 staging validation failure, not a production incident.
- Next test: replay the synthetic request with correlation metadata and a fixture provider.
- Blocker: no staging connection is configured.
- Owner/action: operator connects the approved staging health source.
