# Offline engagement routing fixtures

Synthetic routing cases only. They prove contract behavior, not source access,
execution, implementation or release readiness. The ten positive cases give
every current agent exactly one distinct lead class.

```json
{
  "schema": "optiak-engineering-engagement-fixtures/v1",
  "evidenceScope": "fixture_only",
  "cases": [
    {
      "id": "director-cross-domain-single-owner",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "cross_domain_coordination",
        "lead": "director-optiak",
        "question": "Which owner and next gate should handle a product and reliability conflict?",
        "consultations": [
          {"agent": "product-prd-lead", "question": "Which approved product outcome is affected?", "expectedDelta": "product outcome and unresolved decision only"},
          {"agent": "engineering-assurance-lead", "question": "Which technical gate owns the risk?", "expectedDelta": "technical gate and missing artifact only"}
        ],
        "evidenceRefs": ["board/question-fixture"],
        "excludedWork": ["no specialist analysis", "no release decision"],
        "outputs": ["prioritized_decision_brief"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "product-intent-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "product_intent_or_prd",
        "lead": "product-prd-lead",
        "question": "What outcome and acceptance criteria should govern the feature?",
        "consultations": [],
        "evidenceRefs": ["strategy/revision-fixture"],
        "excludedWork": ["no architecture approval", "no implementation"],
        "outputs": ["product_decision_or_prd_review"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "ui-quality-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "ui_brand_quality",
        "lead": "brand-ui-quality-reviewer",
        "question": "Does the settings page match the approved design and accessibility rules?",
        "consultations": [{"agent": "qa-e2e-validation-engineer", "question": "Is the focus-order observation reproducible?", "expectedDelta": "functional focus-order evidence only"}],
        "evidenceRefs": ["ui/exact-surface-fixture"],
        "excludedWork": ["no product priority", "no code review"],
        "outputs": ["annotated_ui_quality_report"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "documentation-drift-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "documentation_dx_drift",
        "lead": "documentation-dx-steward",
        "question": "Does the exact API example match the authoritative contract?",
        "consultations": [{"agent": "senior-platform-engineer", "question": "What does the immutable API contract require?", "expectedDelta": "contract field comparison only"}],
        "evidenceRefs": ["docs/url-heading-fixture", "api/revision-fixture"],
        "excludedWork": ["no live publication", "no runtime claim"],
        "outputs": ["documentation_drift_report"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "architecture-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "architecture_decision",
        "lead": "principal-platform-architect",
        "question": "Which trust boundary should own delegated identity?",
        "consultations": [{"agent": "senior-platform-engineer", "question": "What is the smallest compatible implementation seam?", "expectedDelta": "implementation seam only"}],
        "evidenceRefs": ["prd/revision-fixture"],
        "excludedWork": ["no implementation", "no release gate"],
        "outputs": ["architecture_decision_record"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "implementation-diagnosis-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "implementation_diagnosis",
        "lead": "senior-platform-engineer",
        "question": "What discriminating test identifies the smallest change surface?",
        "consultations": [{"agent": "qa-e2e-validation-engineer", "question": "Which exact failing scenario is reproducible?", "expectedDelta": "minimal failing scenario only"}],
        "evidenceRefs": ["qa/report-fixture", "source/revision-fixture"],
        "excludedWork": ["no product reprioritization", "no self-review"],
        "outputs": ["technical_diagnosis"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "independent-review-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "immutable_change_review",
        "lead": "independent-code-reviewer",
        "question": "Does the exact PR head safely satisfy its linked intent?",
        "consultations": [],
        "evidenceRefs": ["github/pr-head-fixture", "prd/revision-fixture"],
        "excludedWork": ["no implementation", "no merge or release decision"],
        "outputs": ["independent_review_verdict"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "qa-behavior-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "product_behavior_validation",
        "lead": "qa-e2e-validation-engineer",
        "question": "Does the exact target satisfy the specified positive and negative paths?",
        "consultations": [],
        "evidenceRefs": ["source/revision-fixture", "acceptance/criteria-fixture"],
        "excludedWork": ["no root-cause claim", "no release decision"],
        "outputs": ["executable_test_report"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "reliability-runtime-single-lead",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "live_incident_or_slo_risk",
        "lead": "reliability-incident-engineer",
        "question": "What fresh signal defines impact and the safest containment path?",
        "consultations": [],
        "evidenceRefs": ["runtime/fresh-signal-fixture"],
        "excludedWork": ["no generic bug report", "no production mutation"],
        "outputs": ["incident_or_reliability_brief"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "assurance-does-not-repeat-specialists",
      "expectedVerdict": "routing_ready",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "release_readiness",
        "lead": "engineering-assurance-lead",
        "question": "Are the required independent artifacts complete and consistent for this candidate?",
        "consultations": [],
        "evidenceRefs": ["qa/report-fixture", "review/report-fixture"],
        "excludedWork": ["no repeated QA", "no repeated review", "no human release decision"],
        "outputs": ["evidence_index_and_risk_disposition"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "wrong-lead-and-fanout",
      "expectedVerdict": "routing_changes_required",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "implementation_diagnosis",
        "lead": "principal-platform-architect",
        "question": "Why does the implementation fail?",
        "consultations": [
          {"agent": "qa-e2e-validation-engineer", "question": "Which case fails?", "expectedDelta": "failing case"},
          {"agent": "reliability-incident-engineer", "question": "Is production affected?", "expectedDelta": "runtime impact"},
          {"agent": "engineering-assurance-lead", "question": "Is it ready?", "expectedDelta": "release disposition"}
        ],
        "evidenceRefs": ["bug/report-fixture"],
        "excludedWork": ["no implementation"],
        "outputs": ["technical_diagnosis", "architecture_decision_record"],
        "blanketFanout": true,
        "parallelFullReports": 3,
        "repeatedAcceptedEvidence": true,
        "contributorMode": "full_report",
        "externalWrites": 0
      }
    },
    {
      "id": "duplicate-consultation-work",
      "expectedVerdict": "routing_changes_required",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "product_intent_or_prd",
        "lead": "product-prd-lead",
        "question": "What outcome should govern the change?",
        "consultations": [
          {"agent": "brand-ui-quality-reviewer", "question": "What UI evidence is missing?", "expectedDelta": "missing evidence"},
          {"agent": "brand-ui-quality-reviewer", "question": "What UI evidence is missing?", "expectedDelta": "missing evidence"}
        ],
        "evidenceRefs": ["strategy/revision-fixture", "strategy/revision-fixture"],
        "excludedWork": ["no implementation", "no implementation"],
        "outputs": ["product_decision_or_prd_review"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "consultation-repeats-lead-question",
      "expectedVerdict": "routing_changes_required",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "ui_brand_quality",
        "lead": "brand-ui-quality-reviewer",
        "question": "Does the UI match the approved rule?",
        "consultations": [{"agent": "product-prd-lead", "question": "Does the UI match the approved rule?", "expectedDelta": "second full UI opinion"}],
        "evidenceRefs": ["ui/surface-fixture"],
        "excludedWork": ["no product priority"],
        "outputs": ["annotated_ui_quality_report"],
        "blanketFanout": false,
        "parallelFullReports": 1,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    },
    {
      "id": "incident-routed-to-generic-engineering",
      "expectedVerdict": "routing_changes_required",
      "evidence": {
        "schema": "optiak-engineering-engagement-evidence/v1",
        "requestClass": "live_incident_or_slo_risk",
        "lead": "senior-platform-engineer",
        "question": "Is there a current SLO impact?",
        "consultations": [{"agent": "reliability-incident-engineer", "question": "What is the current impact?", "expectedDelta": "incident brief"}],
        "evidenceRefs": ["runtime/signal-fixture"],
        "excludedWork": ["no production mutation"],
        "outputs": ["technical_diagnosis"],
        "blanketFanout": false,
        "parallelFullReports": 0,
        "repeatedAcceptedEvidence": false,
        "contributorMode": "delta_only",
        "externalWrites": 0
      }
    }
  ]
}
```
