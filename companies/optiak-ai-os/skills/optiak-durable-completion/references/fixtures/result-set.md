# Result-integrity fixture

This synthetic history models a missing prerequisite, a recovery handoff, and a later valid review. It contains no live Optiak or Paperclip identifiers.

```json
{
  "schema": "optiak-result-set-fixture/v1",
  "results": [
    {
      "schema": "optiak-result-envelope/v1",
      "paperclip": {
        "issueDisposition": "done"
      },
      "report": {
        "runRef": "fixture-run-current",
        "reportRef": "fixture-report-current",
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
      "operations": {
        "readiness": "not_assessed"
      },
      "evidence": {
        "scope": "fixture_only",
        "prerequisiteState": "available"
      }
    },
    {
      "schema": "optiak-result-envelope/v1",
      "paperclip": {
        "issueDisposition": "blocked"
      },
      "report": {
        "runRef": "fixture-run-missing-1",
        "reportRef": "fixture-report-missing-1",
        "purpose": "prerequisite_diagnosis",
        "state": "superseded",
        "canonical": false,
        "supersededBy": "fixture-report-current"
      },
      "object": {
        "type": "prd",
        "revision": "sample-1",
        "reviewKind": "prd_review",
        "verdictVocabulary": "optiak-prd-review/v1",
        "verdict": "not_assessed"
      },
      "operations": {
        "readiness": "not_assessed"
      },
      "evidence": {
        "scope": "missing",
        "prerequisiteState": "missing"
      }
    },
    {
      "schema": "optiak-result-envelope/v1",
      "paperclip": {
        "issueDisposition": "blocked"
      },
      "report": {
        "runRef": "fixture-run-missing-2",
        "reportRef": "fixture-report-missing-2",
        "purpose": "prerequisite_diagnosis",
        "state": "superseded",
        "canonical": false,
        "supersededBy": "fixture-report-current"
      },
      "object": {
        "type": "prd",
        "revision": "sample-1",
        "reviewKind": "prd_review",
        "verdictVocabulary": "optiak-prd-review/v1",
        "verdict": "not_assessed"
      },
      "operations": {
        "readiness": "not_assessed"
      },
      "evidence": {
        "scope": "missing",
        "prerequisiteState": "missing"
      }
    },
    {
      "schema": "optiak-result-envelope/v1",
      "paperclip": {
        "issueDisposition": "in_progress"
      },
      "report": {
        "runRef": "fixture-run-recovery",
        "reportRef": "fixture-report-recovery",
        "purpose": "recovery_coordination",
        "state": "interim",
        "canonical": false,
        "supersededBy": null
      },
      "object": {
        "type": "prd",
        "revision": "sample-1",
        "reviewKind": "prd_review",
        "verdictVocabulary": "optiak-prd-review/v1",
        "verdict": "not_assessed"
      },
      "operations": {
        "readiness": "not_assessed"
      },
      "evidence": {
        "scope": "missing",
        "prerequisiteState": "missing"
      }
    }
  ],
  "invalidAggregates": [
    {
      "status": "done"
    },
    {
      "status": "PASS"
    },
    {
      "status": "blocked"
    },
    {
      "status": "ready"
    },
    {
      "status": "complete"
    }
  ],
  "expected": {
    "canonicalReportRef": "fixture-report-current",
    "canonicalRunRef": "fixture-run-current",
    "canonicalReportCount": 1,
    "canonicalObjectVerdict": "changes_required",
    "canonicalIssueDisposition": "done",
    "canonicalOperationalReadiness": "not_assessed",
    "supersededReportCount": 2
  }
}
```
