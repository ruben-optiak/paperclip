# Offline postmortem fixture

This synthetic incident exists only to exercise completeness, certainty, and
ownership rules. It is not evidence about an Optiak environment.

```json
{
  "schema": "optiak-postmortem-fixture/v1",
  "baseEvidence": {
    "schema": "optiak-postmortem-evidence/v1",
    "evidenceScope": "fixture_only",
    "incident": {
      "reference": "fixture-incident-1",
      "severity": "SEV1",
      "material": true,
      "environment": "fixture"
    },
    "impact": {
      "summary": "Synthetic requests failed during a bounded fixture window.",
      "evidenceRefs": ["fixture://incident/impact"]
    },
    "timeline": [
      {
        "at": "2026-09-03T08:00:00.000Z",
        "event": "Synthetic alert observed.",
        "evidenceRefs": ["fixture://incident/alert"]
      },
      {
        "at": "2026-09-03T08:10:00.000Z",
        "event": "Fixture recovery signal observed.",
        "evidenceRefs": ["fixture://incident/recovery"]
      }
    ],
    "detection": {
      "source": "synthetic_fixture",
      "detectedAt": "2026-09-03T08:00:00.000Z",
      "evidenceRefs": ["fixture://incident/detection"]
    },
    "rootCause": {
      "status": "hypothesis",
      "statement": "A synthetic timeout may explain the fixture failure.",
      "evidenceRefs": ["fixture://incident/hypothesis"]
    },
    "contributingConditions": [
      {
        "category": "system_condition",
        "description": "The fixture had no retry budget.",
        "evidenceRefs": ["fixture://incident/config"]
      }
    ],
    "response": {
      "worked": ["The synthetic alert was visible."],
      "didNotWork": ["The fixture lacked a discriminating timeout metric."],
      "decisionRefs": ["fixture://incident/decision"]
    },
    "correctiveActions": [
      {
        "id": "fixture-action-detect",
        "type": "detect",
        "owner": "reliability-incident-engineer",
        "dueAt": "2026-09-10",
        "status": "proposed",
        "verification": {
          "method": "Run the bounded synthetic alert fixture.",
          "successSignal": "Timeout cause is distinguishable without payload access."
        }
      },
      {
        "id": "fixture-action-prevent",
        "type": "prevent",
        "owner": "senior-platform-engineer",
        "dueAt": "2026-09-12",
        "status": "proposed",
        "verification": {
          "method": "Run the synthetic timeout regression.",
          "successSignal": "The bounded request completes or fails with the expected typed error."
        }
      }
    ],
    "learning": [
      {
        "statement": "Detection should identify timeout class without exposing request content.",
        "evidenceRefs": ["fixture://incident/learning"]
      }
    ],
    "recurrenceRisk": {
      "level": "unknown",
      "rationale": "The root cause remains a hypothesis.",
      "evidenceRefs": ["fixture://incident/risk"]
    },
    "review": {
      "incidentOwner": "reliability-incident-engineer",
      "facilitator": "engineering-assurance-lead",
      "independentReviewer": "principal-platform-architect"
    }
  },
  "cases": [
    {
      "id": "complete-hypothesis-separated",
      "mutation": "none",
      "expectedVerdict": "ready_for_human_review"
    },
    {
      "id": "missing-impact-evidence",
      "mutation": "clear_impact_evidence",
      "expectedVerdict": "blocked_on_evidence"
    },
    {
      "id": "unsupported-root-cause-certainty",
      "mutation": "verified_root_cause_with_one_reference",
      "expectedVerdict": "changes_required"
    },
    {
      "id": "nonmaterial-sev3",
      "mutation": "mark_nonmaterial_sev3",
      "expectedVerdict": "not_required"
    }
  ]
}
```
