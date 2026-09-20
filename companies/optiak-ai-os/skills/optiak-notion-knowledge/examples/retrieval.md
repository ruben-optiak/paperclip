# Example bounded retrieval

Question: what acceptance criteria did Product approve for application API-key
creation?

- Agent: QA and E2E Validation Engineer.
- Approved root: Product specifications.
- Query: fetch the exact linked PRD; do not search unrelated workspace content.
- Evidence: page URL/id, acceptance-criteria heading, `last_edited_time`, and
  retrieval time.
- Cross-check: use Linear only for ticket execution state and GitHub only for
  implemented behavior at the tested revision.
- Result: summarize the relevant criteria and flag any conflict. Do not copy the
  full PRD or edit the page.
