# Offline product-authority fixture

Use only as synthetic evidence. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-product-authority-fixture/v1",
  "cases": [
    {
      "id": "strategy-vs-priority",
      "topic": "strategy_and_product_boundary",
      "boardDecision": "application-layer chatbot builder is out of scope",
      "linear": {"identifier": "OPT-FIXTURE-1", "priority": "urgent"},
      "expectedAuthority": "explicit_board_decision",
      "expectedOutcome": "out_of_scope"
    },
    {
      "id": "done-vs-released",
      "topic": "deployed_or_released_state",
      "linear": {"identifier": "OPT-FIXTURE-2", "status": "done"},
      "releaseEvidenceConnected": false,
      "expectedAuthority": "release_and_deployment_evidence",
      "expectedOutcome": "release_state_unavailable"
    },
    {
      "id": "docs-vs-api",
      "topic": "api_behavior",
      "publicDocsClaim": "a response field is supported",
      "versionedApiContractConnected": false,
      "expectedAuthority": "exact_versioned_api_contract",
      "expectedOutcome": "blocked_on_authority"
    },
    {
      "id": "linear-vs-demand",
      "topic": "customer_demand",
      "linear": {"matchingIssueCount": 4},
      "customerEvidenceConnected": false,
      "expectedAuthority": "approved_customer_evidence_source",
      "expectedOutcome": "demand_unknown"
    }
  ]
}
```
