# Example triage

Finding: an application credential screen does not explain that the secret is shown once.

- Evidence type: observed staging UI finding.
- Persona: application administrator.
- Problem: a user may lose the only copy or handle it insecurely.
- Alignment: application credential governance is core platform scope.
- Disposition: candidate, high risk-reduction value.
- Acceptance: warning appears before creation, post-create state is unambiguous, docs match, and QA verifies both paths.
- Next owner: Product & PRD Lead, then Brand/UI and QA.
