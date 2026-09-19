# Synthetic connected-backlog regression

All identifiers, observations and decisions below are synthetic. Tests may change
the evidence enum with an injected comparison clock; that does not create live evidence.

```json
{
  "context": {"runId": "fixture-run", "issueId": "fixture-issue", "companyId": "fixture-company", "agentId": "fixture-agent"},
  "input": {
    "body": "Synthetic review: clarify acceptance criteria before implementation. Operational readiness was not assessed.",
    "envelope": {
      "schema": "optiak-result-envelope/v1",
      "paperclip": {"issueDisposition": "done"},
      "report": {"runRef": "fixture-run", "reportRef": "run:fixture-run/issue:fixture-issue/final", "purpose": "object_review", "state": "final", "canonical": true, "supersededBy": null},
      "object": {"type": "linear_backlog_sample", "revision": "OPT-sample@2026-01-01T10:00:00Z", "reviewKind": "product_triage", "verdictVocabulary": "optiak-product-sample/v1", "verdict": "review_complete"},
      "operations": {"readiness": "not_assessed"},
      "evidence": {"scope": "fixture_only", "prerequisiteState": "available"}
    },
    "productSample": {
      "schema": "optiak-product-sample/v1", "teamKey": "OPT", "retrievedAt": "2026-01-01T10:00:00Z", "coverage": "bounded_recent_sample_not_global_ranking",
      "items": [{"id": "OPT-101", "url": "https://linear.app/optiak/issue/OPT-101/synthetic", "updatedAt": "2026-01-01T09:00:00Z", "observedStatus": "Todo", "observedPriority": 2, "disposition": "needs discovery", "rationale": "Synthetic acceptance criteria missing", "nextRole": "product-prd-lead"}],
      "detailIds": ["OPT-101"]
    }
  }
}
```
