# Qualified result example

```json
{
  "schema": "optiak-result-envelope/v1",
  "paperclip": {"issueDisposition": "done"},
  "report": {
    "runRef": "run-reference-from-paperclip",
    "reportRef": "comment-reference-from-paperclip",
    "purpose": "object_review",
    "state": "final",
    "canonical": true,
    "supersededBy": null
  },
  "object": {
    "type": "prd",
    "revision": "sample-1",
    "reviewKind": "prd_review",
    "verdictVocabulary": "optiak-prd-review/v1",
    "verdict": "changes_required"
  },
  "operations": {"readiness": "not_assessed"},
  "evidence": {"scope": "fixture_only", "prerequisiteState": "available"}
}
```

The issue is done because its report was persisted. The PRD still needs changes. No operational-readiness gate was run.
