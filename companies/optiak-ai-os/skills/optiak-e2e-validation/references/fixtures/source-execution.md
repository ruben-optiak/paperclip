# Offline QA source-execution fixtures

Synthetic evaluator inputs only. They do not prove that a runner or repository connection exists.

```json
{
  "schema": "optiak-qa-source-execution-fixtures/v1",
  "evidenceScope": "fixture_only",
  "cases": [
    {
      "id": "frontend-safe-pass",
      "expectedVerdict": "execution_evidence_ready",
      "evidence": {
        "schema": "optiak-qa-source-execution-evidence/v1",
        "evidenceScope": "connected_ephemeral_qa",
        "agentSlug": "qa-e2e-validation-engineer",
        "repository": "optiak/optiak-frontend",
        "revision": "1111111111111111111111111111111111111111",
        "profile": "frontend_static_unit",
        "runtimeBoundary": "dedicated_ephemeral_qa_runner",
        "sharedControlPlaneUsed": false,
        "repositoryCredentialVisibleToTests": false,
        "productionCredentialsPresent": false,
        "customerDataPresent": false,
        "dockerSocketMounted": false,
        "externalWrites": 0,
        "sourceChangesPersisted": false,
        "startedAt": "2026-09-20T10:00:00Z",
        "completedAt": "2026-09-20T10:04:00Z",
        "durationSeconds": 240,
        "artifactBytes": 1024,
        "cleanup": "completed",
        "stepResults": [
          {"id": "pnpm_install_frozen", "exitCode": 0},
          {"id": "lint", "exitCode": 0},
          {"id": "unit_tests", "exitCode": 0},
          {"id": "docs_check", "exitCode": 0},
          {"id": "typecheck", "exitCode": 0}
        ]
      }
    },
    {
      "id": "backend-test-failure-is-evidence",
      "expectedVerdict": "test_failures_observed",
      "evidence": {
        "schema": "optiak-qa-source-execution-evidence/v1",
        "evidenceScope": "connected_ephemeral_qa",
        "agentSlug": "qa-e2e-validation-engineer",
        "repository": "optiak/optiak",
        "revision": "2222222222222222222222222222222222222222",
        "profile": "backend_static_unit",
        "runtimeBoundary": "dedicated_ephemeral_qa_runner",
        "sharedControlPlaneUsed": false,
        "repositoryCredentialVisibleToTests": false,
        "productionCredentialsPresent": false,
        "customerDataPresent": false,
        "dockerSocketMounted": false,
        "externalWrites": 0,
        "sourceChangesPersisted": false,
        "startedAt": "2026-09-20T10:00:00Z",
        "completedAt": "2026-09-20T10:05:00Z",
        "durationSeconds": 300,
        "artifactBytes": 2048,
        "cleanup": "completed",
        "stepResults": [
          {"id": "uv_sync_frozen", "exitCode": 0},
          {"id": "format_check", "exitCode": 0},
          {"id": "lint_check", "exitCode": 0},
          {"id": "import_check", "exitCode": 0},
          {"id": "unit_tests", "exitCode": 1}
        ]
      }
    },
    {
      "id": "shared-control-plane-blocked",
      "expectedVerdict": "blocked_on_runtime_safety",
      "evidence": {
        "schema": "optiak-qa-source-execution-evidence/v1",
        "evidenceScope": "connected_ephemeral_qa",
        "agentSlug": "qa-e2e-validation-engineer",
        "repository": "optiak/optiak-frontend",
        "revision": "3333333333333333333333333333333333333333",
        "profile": "frontend_static_unit",
        "runtimeBoundary": "shared_paperclip_control_plane",
        "sharedControlPlaneUsed": true,
        "repositoryCredentialVisibleToTests": true,
        "productionCredentialsPresent": false,
        "customerDataPresent": false,
        "dockerSocketMounted": true,
        "externalWrites": 0,
        "sourceChangesPersisted": false,
        "startedAt": "2026-09-20T10:00:00Z",
        "completedAt": "2026-09-20T10:01:00Z",
        "durationSeconds": 60,
        "artifactBytes": 100,
        "cleanup": "completed",
        "stepResults": [
          {"id": "pnpm_install_frozen", "exitCode": 0},
          {"id": "lint", "exitCode": 0},
          {"id": "unit_tests", "exitCode": 0},
          {"id": "docs_check", "exitCode": 0},
          {"id": "typecheck", "exitCode": 0}
        ]
      }
    },
    {
      "id": "branch-ref-and-incomplete-steps-invalid",
      "expectedVerdict": "invalid_execution_evidence",
      "evidence": {
        "schema": "optiak-qa-source-execution-evidence/v1",
        "evidenceScope": "connected_ephemeral_qa",
        "agentSlug": "qa-e2e-validation-engineer",
        "repository": "optiak/iac-infra",
        "revision": "main",
        "profile": "iac_static_validate",
        "runtimeBoundary": "dedicated_ephemeral_qa_runner",
        "sharedControlPlaneUsed": false,
        "repositoryCredentialVisibleToTests": false,
        "productionCredentialsPresent": false,
        "customerDataPresent": false,
        "dockerSocketMounted": false,
        "externalWrites": 0,
        "sourceChangesPersisted": false,
        "startedAt": "2026-09-20T10:00:00Z",
        "completedAt": "2026-09-20T10:01:00Z",
        "durationSeconds": 60,
        "artifactBytes": 100,
        "cleanup": "completed",
        "stepResults": [
          {"id": "fmt_check", "exitCode": 0}
        ]
      }
    }
  ]
}
```
