# Example journey

Journey: create an application and obtain an application API key.

Current result: blocked.

- Required target: dedicated staging tenant.
- Required persona: organization administrator.
- Mutation: create synthetic application and credential; Yellow under change control.
- Cleanup: revoke credential and archive/delete synthetic application through an approved operator path.
- Blocker: no staging tenant, browser session, or governed write profile is connected.
