# Example decision

Action: create a synthetic application in a dedicated staging tenant.

- Classification: Yellow.
- Evidence: tenant identity and test-data marker recorded.
- Preconditions: staging allowlist, bounded application name, cleanup owner, no provider credential mutation.
- Decision: prepare the request; do not execute until the Board-approved staging profile exists.
- Abort: any production hostname, real customer identifier, or unreviewed tool catalog.
