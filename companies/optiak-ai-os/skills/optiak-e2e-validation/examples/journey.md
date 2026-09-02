# Example journey

Journey: create an application and obtain an application API key.

Current result: blocked.

- Observed local target: UI and Admin health are reachable at exact loopback
  URLs, but this is reachability evidence only.
- Required target: dedicated synthetic local or staging tenant whose data
  classification and lifecycle are approved.
- Required persona: organization administrator.
- Mutation: create synthetic application and credential; Yellow under change control.
- Cleanup: revoke credential and archive/delete synthetic application through an approved operator path.
- Budget proposal: at most USD 1, twelve inference requests, 128 output tokens
  per request, and zero automatic retries; spend is not authorized until Board
  approval and external enforcement exist.
- Blockers: no approved tenant or browser session is connected, and the local
  Gateway currently fails configuration validation. No write or inference was
  attempted.
