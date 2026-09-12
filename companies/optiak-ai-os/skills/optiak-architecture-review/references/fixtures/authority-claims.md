# Offline architecture authority fixture

Use only to verify source selection and fail-closed behavior. No case describes
the current Optiak implementation or a deployed environment.

```json
{
  "schema": "optiak-architecture-authority-fixture/v1",
  "cases": [
    {
      "id": "public-page-describes-api-field",
      "domain": "api_compatibility_and_versioning",
      "availableSources": ["public_documentation"],
      "expectedDecision": "blocked_on_contract_authority"
    },
    {
      "id": "source-code-without-deployment-proof",
      "domain": "deployed_topology_and_revision",
      "availableSources": ["exact_source_revision"],
      "expectedDecision": "deployment_state_unknown"
    },
    {
      "id": "health-only-readiness-claim",
      "domain": "slo_capacity_latency_and_cost",
      "availableSources": ["fresh_runtime_evidence"],
      "runtimeEvidenceKind": "health_endpoint_only",
      "expectedDecision": "blocked_on_slo_or_runtime_evidence"
    },
    {
      "id": "exact-contract-and-source",
      "domain": "api_compatibility_and_versioning",
      "availableSources": ["versioned_api_or_data_contract", "exact_source_revision"],
      "expectedDecision": "authority_sufficient_for_revision_scoped_review"
    }
  ]
}
```
