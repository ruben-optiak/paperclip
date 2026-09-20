# Company connector candidates

## Scope and inheritance

Repository AGENTS.md applies. These modules belong only to Optiak AI OS, not
Paperclip core or another company. This file is contributor guidance, not an
importable employee definition.

## Boundaries

- `linear-privacy/` is an offline projection candidate, not a deployed MCP.
- No credentials, OAuth forwarding, HTTP server, vault access or instance DB
  access are supplied by the candidate. Do not add implicit runtime wiring.
- Raw provider bytes, errors, names and digests must not reach output/audit.
  Project before Paperclip normalizes, summarizes or logs a response.
- Metadata-only output intentionally cannot support semantic Product triage.
  Do not restore free text under the label of PII-safe metadata.
- Production promotion requires the gates in the connector README, including
  removal of any direct bypass and actual runtime sink verification.

## Quality gate

Run `./companies/optiak-ai-os/scripts/check.sh` from the repository root. The
optional core-guard/isolated-storage probe is documented in the candidate README.
It is not a replacement for a live gateway/audit test. Preserve synthetic-only
fixtures; never copy provider data into them.

## Maintenance

Update the candidate's output contract, adversarial tests and rollout limitations
together. State separately what is defined, tested offline, imported and active.
