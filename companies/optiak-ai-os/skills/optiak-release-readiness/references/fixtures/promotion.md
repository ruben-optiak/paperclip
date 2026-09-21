# Offline AI OS promotion fixture

These cases exercise the promotion evaluator without infrastructure, credentials,
deployment, inference, or production access. `defaultRequiredGateStatus` is test
shorthand used only to materialize synthetic gate results.

```json
{
  "schema": "optiak-ai-os-promotion-fixture/v1",
  "candidate": {
    "package_git_commit": "1111111111111111111111111111111111111111",
    "package_zip_sha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "paperclip_version": "fixture-stable-version",
    "paperclip_image_digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    "database_migration_revision": "fixture-migration-current",
    "configuration_fingerprint": "4444444444444444444444444444444444444444444444444444444444444444"
  },
  "cases": [
    {
      "id": "local-package-only",
      "targetEnvironment": "preproduction",
      "sourceEnvironment": "local",
      "requestedStage": "paused_import",
      "defaultRequiredGateStatus": "missing",
      "gateOverrides": {
        "package_source_committed": "pass",
        "package_checks_pass": "pass",
        "package_archive_reproducible": "pass"
      },
      "expectedVerdict": "blocked_on_evidence"
    },
    {
      "id": "synthetic-preproduction-gates-only",
      "targetEnvironment": "preproduction",
      "sourceEnvironment": "local",
      "requestedStage": "paused_import",
      "defaultRequiredGateStatus": "pass",
      "gateOverrides": {},
      "expectedVerdict": "blocked_on_evidence"
    },
    {
      "id": "direct-local-to-production",
      "targetEnvironment": "production",
      "sourceEnvironment": "local",
      "requestedStage": "paused_import",
      "defaultRequiredGateStatus": "pass",
      "gateOverrides": {},
      "expectedVerdict": "deny_direct_local_to_production"
    },
    {
      "id": "failed-restore-rehearsal",
      "targetEnvironment": "preproduction",
      "sourceEnvironment": "local",
      "requestedStage": "limited_agent_activation",
      "defaultRequiredGateStatus": "pass",
      "gateOverrides": {
        "restore_rehearsal_passed": "fail"
      },
      "expectedVerdict": "not_ready"
    },
    {
      "id": "routine-evidence-missing",
      "targetEnvironment": "production",
      "sourceEnvironment": "preproduction",
      "requestedStage": "routine_activation",
      "defaultRequiredGateStatus": "pass",
      "gateOverrides": {
        "routine_dependencies_passed": "missing"
      },
      "expectedVerdict": "blocked_on_evidence"
    }
  ]
}
```
