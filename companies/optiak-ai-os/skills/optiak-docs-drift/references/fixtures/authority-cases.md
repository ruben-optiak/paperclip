# Offline documentation authority fixture

Use only to verify classification and routing. URLs are from the approved public
allowlist; their contents are not embedded and the fixture makes no live claim.

```json
{
  "schema": "optiak-documentation-authority-fixture/v1",
  "cases": [
    {
      "id": "public-only-current-behavior-claim",
      "sourceId": "applications",
      "availableAuthorities": ["publishedWording"],
      "expectedClassification": "blocked_on_authority",
      "expectedOwner": "documentation-dx-steward"
    },
    {
      "id": "source-conflict-release-unknown",
      "sourceId": "api-usage",
      "availableAuthorities": ["publishedWording", "implementation"],
      "expectedClassification": "likely_drift",
      "expectedOwner": "principal-platform-architect"
    },
    {
      "id": "released-contract-conflict",
      "sourceId": "api-keys",
      "availableAuthorities": ["publishedWording", "apiAndSchema", "releaseAvailability"],
      "expectedClassification": "confirmed_drift",
      "expectedOwner": "documentation-dx-steward"
    },
    {
      "id": "two-pages-disagree",
      "sourceId": "public-overview",
      "availableAuthorities": ["publishedWording"],
      "secondPublicSourceId": "quickstart",
      "expectedClassification": "internally_inconsistent",
      "expectedOwner": "product-prd-lead"
    }
  ]
}
```
