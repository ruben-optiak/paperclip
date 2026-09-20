# Security and autonomy

## Non-negotiable boundaries

- Production-product mutation is denied. The only separately designed external
  write is Board-approved creation of unassigned operational backlog issues in
  Linear team `OPT`; it is not deployment, runtime or customer authority.
- Merge, deploy, rollback, infrastructure and secret administration are denied.
- Authors do not approve their own work.
- Unidentified environment or revision fails closed.
- Missing data is reported as missing, never inferred from fixtures or old snapshots.
- Customer data, sensitive prompts, provider payloads, credentials, and raw tokens never enter findings.
- Repository, backlog, Notion knowledge, browser, API, and observability connections use separate least-privilege identities.
- Notion uses the official hosted MCP with OAuth DCR/PKCE. Its live token stays
  in Paperclip's company secret store. The observed consent inherits the
  authorizing user's access and does not select pages, so hard Product &
  Engineering isolation requires a dedicated restricted identity or enforcing
  proxy. Paperclip allows three exact read/capability actions, turns the other
  42 actions off, binds only the ten current agents, and quarantines new tools.
- Localhost is an environment location, not proof that its tenant or data are
  disposable. Keep local writes denied until the exact tenant is classified as
  dedicated and synthetic.
- Never prove production denial by sending a request to production. Enforce and
  inspect exact host policy before the test.
- Do not add `privileged`, `CAP_SYS_ADMIN`, unconfined seccomp/AppArmor, or danger-full-access to the Paperclip control-plane container to make Bubblewrap start. Move agent execution to a dedicated boundary first and apply `runbooks/sandbox-migration.md`.

## Evidence hygiene

- Redact authorization headers, cookies, keys, user identifiers, sensitive prompts, and provider responses.
- Prefer hashes, correlation ids approved for sharing, aggregate counts, and synthetic fixtures.
- Screenshots must be inspected for secrets and personal data before attachment.
- Logs and traces must be bounded by environment, time, request, and redaction policy.

## Approval is not authority expansion

A Paperclip approval authorizes only the exact reviewed action. It does not make an unknown tool safe, grant a broader credential, or override connector and platform denials.

For the Linear publisher, every call needs a new gateway action approval over
the complete signed arguments. The connector kill switch, team restriction,
idempotency journal and uncertain-outcome stop remain mandatory after approval.
Never convert one approval into a trust rule.
