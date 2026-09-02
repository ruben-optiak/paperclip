# Security and autonomy

## Non-negotiable boundaries

- Production mutation is denied.
- Merge, deploy, rollback, infrastructure and secret administration are denied.
- Authors do not approve their own work.
- Unidentified environment or revision fails closed.
- Missing data is reported as missing, never inferred from fixtures or old snapshots.
- Customer data, sensitive prompts, provider payloads, credentials, and raw tokens never enter findings.
- Repository, backlog, browser, API, and observability connections use separate least-privilege identities.
- Do not add `privileged`, `CAP_SYS_ADMIN`, unconfined seccomp/AppArmor, or danger-full-access to the Paperclip control-plane container to make Bubblewrap start. Move agent execution to a dedicated boundary first and apply `runbooks/sandbox-migration.md`.

## Evidence hygiene

- Redact authorization headers, cookies, keys, user identifiers, sensitive prompts, and provider responses.
- Prefer hashes, correlation ids approved for sharing, aggregate counts, and synthetic fixtures.
- Screenshots must be inspected for secrets and personal data before attachment.
- Logs and traces must be bounded by environment, time, request, and redaction policy.

## Approval is not authority expansion

A Paperclip approval authorizes only the exact reviewed action. It does not make an unknown tool safe, grant a broader credential, or override connector and platform denials.
