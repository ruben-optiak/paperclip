# Offline product-advisory quality fixtures

Use only as synthetic evidence. `opt39-efficiency-regression` preserves the
sanitized usage totals observed in the historical OPT-39 run; it is not a fresh
backlog review. The fenced object is machine-readable test data.

```json
{
  "schema": "optiak-product-advisory-fixture/v1",
  "cases": [
    {
      "id": "goal-aligned-ready",
      "evidence": {
        "schema": "optiak-product-advisory-evidence/v1",
        "evidenceScope": "fixture_only",
        "reviewPurpose": "priority_ranking",
        "strategyContext": {
          "status": "explicit_board_decision",
          "references": ["fixture-board-goal-1"]
        },
        "sample": {
          "selectionStrategy": "approved_goal_then_dependency_chain",
          "usedUpdatedAtOnly": false,
          "globalPriorityClaim": false,
          "itemCount": 5
        },
        "provider": {"calls": 5, "listCalls": 2, "detailCalls": 3},
        "recommendations": [
          {
            "sourceId": "OPT-FIXTURE-1",
            "sourceUrl": "https://linear.app/optiak/issue/OPT-FIXTURE-1/example",
            "detailRead": true,
            "proposesPriorityChange": true,
            "strategyReference": "fixture-board-goal-1",
            "observedState": "todo",
            "proposal": "board_review",
            "reason": "Blocks the approved fixture goal",
            "confidence": "high",
            "missingEvidence": [],
            "nextOwner": "product-prd-lead",
            "acceptanceCriteriaStatus": "draft_questions_until_prd_authority"
          }
        ],
        "output": {
          "wordCount": 480,
          "executiveSummaryLines": 4,
          "boardDecisionCount": 1,
          "sections": ["executive_summary", "observed_facts", "hypotheses", "missing_evidence", "recommendations", "board_decisions"],
          "machineEnvelopeSeparated": true
        },
        "usage": {"uncachedInputTokens": 22000, "outputTokens": 3200, "durationSeconds": 150},
        "externalWrites": 0
      },
      "expectedVerdict": "ready_for_board_review"
    },
    {
      "id": "strategy-missing-updated-at-ranking",
      "evidence": {
        "schema": "optiak-product-advisory-evidence/v1",
        "evidenceScope": "fixture_only",
        "reviewPurpose": "priority_ranking",
        "strategyContext": {"status": "unavailable", "references": []},
        "sample": {"selectionStrategy": "updated_at", "usedUpdatedAtOnly": true, "globalPriorityClaim": true, "itemCount": 10},
        "provider": {"calls": 5, "listCalls": 2, "detailCalls": 3},
        "recommendations": [],
        "output": {
          "wordCount": 300,
          "executiveSummaryLines": 3,
          "boardDecisionCount": 1,
          "sections": ["executive_summary", "observed_facts", "hypotheses", "missing_evidence", "recommendations", "board_decisions"],
          "machineEnvelopeSeparated": true
        },
        "usage": {"uncachedInputTokens": 12000, "outputTokens": 1800, "durationSeconds": 90},
        "externalWrites": 0
      },
      "expectedVerdict": "blocked_on_strategy"
    },
    {
      "id": "list-only-recommendation",
      "evidence": {
        "schema": "optiak-product-advisory-evidence/v1",
        "evidenceScope": "fixture_only",
        "reviewPurpose": "backlog_hygiene_scan",
        "strategyContext": {"status": "unavailable", "references": []},
        "sample": {"selectionStrategy": "updated_at", "usedUpdatedAtOnly": true, "globalPriorityClaim": false, "itemCount": 5},
        "provider": {"calls": 2, "listCalls": 2, "detailCalls": 0},
        "recommendations": [
          {
            "sourceId": "OPT-FIXTURE-2",
            "sourceUrl": "https://linear.app/optiak/issue/OPT-FIXTURE-2/example",
            "detailRead": false,
            "proposesPriorityChange": false,
            "strategyReference": null,
            "observedState": "in_review",
            "proposal": "close_after_validation",
            "reason": "Title suggests cleanup risk",
            "confidence": "medium",
            "missingEvidence": ["ticket_detail"],
            "nextOwner": "qa-e2e-validation-engineer",
            "acceptanceCriteriaStatus": "draft_questions_until_prd_authority"
          }
        ],
        "output": {
          "wordCount": 260,
          "executiveSummaryLines": 3,
          "boardDecisionCount": 0,
          "sections": ["executive_summary", "observed_facts", "hypotheses", "missing_evidence", "recommendations", "board_decisions"],
          "machineEnvelopeSeparated": true
        },
        "usage": {"uncachedInputTokens": 9000, "outputTokens": 1200, "durationSeconds": 60},
        "externalWrites": 0
      },
      "expectedVerdict": "changes_required"
    },
    {
      "id": "opt39-efficiency-regression",
      "evidence": {
        "schema": "optiak-product-advisory-evidence/v1",
        "evidenceScope": "historical_connected_non_production",
        "reviewPurpose": "backlog_hygiene_scan",
        "strategyContext": {"status": "unavailable", "references": []},
        "sample": {"selectionStrategy": "updated_at", "usedUpdatedAtOnly": true, "globalPriorityClaim": false, "itemCount": 10},
        "provider": {"calls": 5, "listCalls": 2, "detailCalls": 3},
        "recommendations": [],
        "output": {
          "wordCount": 650,
          "executiveSummaryLines": 5,
          "boardDecisionCount": 3,
          "sections": ["executive_summary", "observed_facts", "hypotheses", "missing_evidence", "recommendations", "board_decisions"],
          "machineEnvelopeSeparated": true
        },
        "usage": {"uncachedInputTokens": 54796, "outputTokens": 11587, "durationSeconds": 288},
        "externalWrites": 0
      },
      "expectedVerdict": "efficiency_regression"
    },
    {
      "id": "inline-machine-envelope",
      "evidence": {
        "schema": "optiak-product-advisory-evidence/v1",
        "evidenceScope": "fixture_only",
        "reviewPurpose": "backlog_hygiene_scan",
        "strategyContext": {"status": "unavailable", "references": []},
        "sample": {"selectionStrategy": "updated_at", "usedUpdatedAtOnly": true, "globalPriorityClaim": false, "itemCount": 5},
        "provider": {"calls": 3, "listCalls": 2, "detailCalls": 1},
        "recommendations": [],
        "output": {
          "wordCount": 220,
          "executiveSummaryLines": 3,
          "boardDecisionCount": 0,
          "sections": ["executive_summary", "observed_facts", "hypotheses", "missing_evidence", "recommendations", "board_decisions"],
          "machineEnvelopeSeparated": false
        },
        "usage": {"uncachedInputTokens": 8000, "outputTokens": 1000, "durationSeconds": 50},
        "externalWrites": 0
      },
      "expectedVerdict": "changes_required"
    }
  ]
}
```
