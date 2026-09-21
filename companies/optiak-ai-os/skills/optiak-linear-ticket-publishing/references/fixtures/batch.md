# Portable fixture

This is format evidence only. The revision and content are synthetic.

```json
{
  "schema": "optiak-linear-ticket-batch/v1",
  "source": {
    "ref": "PRD gateway-budget-controls",
    "revisionSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "tickets": [
    {
      "key": "enforce-budget",
      "title": "Enforce application inference budget before provider dispatch",
      "problem": "An application can exceed its configured inference budget before the control plane blocks another request.",
      "desiredOutcome": "The gateway rejects over-budget requests before provider dispatch and records a decision reason.",
      "acceptanceCriteria": [
        "A request above the effective budget is rejected before provider dispatch.",
        "The response and audit record use the reviewed budget-exceeded reason code."
      ],
      "nonGoals": [
        "Changing pricing or packaging."
      ],
      "dependencies": [],
      "evidenceRefs": [
        "PRD gateway-budget-controls, immutable revision above"
      ],
      "priority": "high"
    }
  ]
}
```
