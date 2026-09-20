# Offline authority cases

```json
{
  "schema": "optiak-notion-knowledge-fixture/v1",
  "evidenceScope": "fixture_only",
  "cases": [
    {
      "id": "qa-linked-prd",
      "agent": "qa-e2e-validation-engineer",
      "requestedRoot": "product-specifications",
      "connectionState": "connected_read_only",
      "requestedOperation": "Fetch Notion entities",
      "pageShared": true,
      "lastEditedTime": "2026-09-18T12:00:00.000Z",
      "expectedDisposition": "read_allowed"
    },
    {
      "id": "reviewer-finance-page",
      "agent": "independent-code-reviewer",
      "requestedRoot": "finance",
      "connectionState": "connected_read_only",
      "requestedOperation": "Fetch Notion entities",
      "pageShared": false,
      "lastEditedTime": null,
      "expectedDisposition": "blocked_on_authority"
    },
    {
      "id": "product-page-update",
      "agent": "product-prd-lead",
      "requestedRoot": "product-strategy",
      "connectionState": "connected_read_only",
      "requestedOperation": "Update Notion page",
      "pageShared": true,
      "lastEditedTime": "2026-09-18T12:00:00.000Z",
      "expectedDisposition": "denied_mutation"
    },
    {
      "id": "architect-disconnected",
      "agent": "principal-platform-architect",
      "requestedRoot": "architecture-decisions",
      "connectionState": "disconnected",
      "requestedOperation": "Fetch Notion entities",
      "pageShared": true,
      "lastEditedTime": "2026-09-18T12:00:00.000Z",
      "expectedDisposition": "blocked_on_connection"
    },
    {
      "id": "status-conflict",
      "agent": "director-optiak",
      "requestedRoot": "roadmap-goals",
      "connectionState": "connected_read_only",
      "requestedOperation": "Fetch Notion entities",
      "pageShared": true,
      "lastEditedTime": "2026-09-17T12:00:00.000Z",
      "linearState": "cancelled",
      "notionStatement": "planned",
      "expectedDisposition": "report_authority_conflict"
    }
  ]
}
```
