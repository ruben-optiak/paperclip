---
slug: validate-connectors
name: Validar conectores y catálogos read-only
assignee: technology-manager
project: foundation-data-readiness
---

Check health for WooCommerce, GA4, GSC, and Google Ads. Record version and observed tool catalog, compare it with `policies/tool-allowlist.yaml`, and quarantine unknown or mutating tools. Do not include secrets or customer data in evidence.

Done when each connector has a health result, catalog diff, network-boundary result, and explicit pass/block decision.
