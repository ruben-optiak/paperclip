# Offline frontend implementation fixture

Use only as synthetic evidence. It does not represent a connected repository,
browser, environment, or completed change. The fenced object is machine-readable
test data.

```json
{
  "schema": "optiak-frontend-implementation-fixture/v1",
  "evidenceScope": "fixture_only",
  "repository": "optiak/optiak-frontend",
  "baseRevision": "fixture-base-sha",
  "workspace": {
    "providedBy": "paperclip",
    "mode": "isolated_workspace",
    "strategy": "git_worktree",
    "writable": true
  },
  "task": "Expose an empty state for a filtered model catalog",
  "acceptanceCriteria": [
    "The active filters remain visible",
    "The empty state explains how to clear filters",
    "Keyboard focus remains on the triggering control"
  ],
  "requiredStates": ["loading", "empty", "error", "success", "focus"],
  "expectedDisposition": "ready_for_independent_review",
  "expectedHandoffs": [
    "independent-code-reviewer",
    "qa-e2e-validation-engineer",
    "brand-ui-quality-reviewer"
  ],
  "forbiddenActions": [
    "create_nested_worktree",
    "switch_branch",
    "merge",
    "deploy"
  ]
}
```
