# Offline observability decision fixture

Use only to test fail-closed signal classification. The timestamps are synthetic
and never describe a live Optiak environment.

```json
{
  "schema": "optiak-observability-fixture/v1",
  "cases": [
    {
      "id": "fresh-correlated-synthetic-signal",
      "environment": "staging",
      "alertIngress": "connected_fixture",
      "aggregateFreshnessMinutes": 1,
      "deploymentRevision": "fixture-revision-a",
      "requestCorrelation": "fixture-request-a",
      "expectedDecision": "triage_allowed_not_resolution"
    },
    {
      "id": "missing-deployment-correlation",
      "environment": "staging",
      "alertIngress": "connected_fixture",
      "aggregateFreshnessMinutes": 1,
      "deploymentRevision": null,
      "requestCorrelation": "fixture-request-b",
      "expectedDecision": "blocked_on_deployment_correlation"
    },
    {
      "id": "stale-aggregate",
      "environment": "production",
      "alertIngress": "connected_fixture",
      "aggregateFreshnessMinutes": 30,
      "deploymentRevision": "fixture-revision-c",
      "requestCorrelation": "fixture-request-c",
      "expectedDecision": "unknown_not_healthy"
    },
    {
      "id": "no-alert-ingress",
      "environment": "production",
      "alertIngress": "disconnected",
      "aggregateFreshnessMinutes": null,
      "deploymentRevision": null,
      "requestCorrelation": null,
      "expectedDecision": "no_automatic_oncall_coverage"
    }
  ]
}
```
