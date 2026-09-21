# Bounded catalogue audit pilot

This runbook re-specifies `ENK-7` under `EAI-013`. It authorizes one reviewable
audit, not a catalogue sweep, import, support-database update or external
mutation.

## Start gate

Board must attach an exact mandate to the issue before Ecommerce starts. The
mandate is human-readable but must bind all of these values without wildcards:

- one `brandSlug` and one technical `domain`;
- official manufacturer source name, snapshot date and SHA-256;
- complete fresh Woo export `fetched_at`, SHA-256 and data-row count;
- adapter key, version and definition SHA-256;
- at most 25 exact entity keys and 50 exact `field.group + field.name` pairs;
- one proposed support-pack target identified by brand and domain;
- confirmation that external writes, Woo/feed imports and support-pack import
  are not authorized.

Missing or ambiguous values stop the run at `BLOCKED` preflight. The historical
EAI-021 receipt can prove positional compatibility but cannot satisfy the fresh
Woo export or current manufacturer-source requirements.

For an existing Paperclip instance, update `ENK-7` explicitly as Board instead
of using a full package import: task identity is not portable across every
historical import. Copy this checklist into the issue and replace every angle
bracket before moving it out of backlog:

```text
EAI-013 bounded catalogue audit mandate
- issue revision: <exact ENK-7 revision>
- brandSlug: <one brand>
- technical domain: <one domain>
- official source: <logical name>; snapshot <YYYY-MM-DD>; sha256 <64 hex>
- Woo export: fetched_at <timestamp with offset>; sha256 <64 hex>; rows <count>; complete true
- adapter: <key>; version <semver>; definition sha256 <64 hex>
- entity keys: <1..25 exact keys>
- field selectors: <1..50 exact group.name pairs>
- support-pack candidate: <brand>/<domain>
- authority: report only; Woo/feed/support imports false; external mutations false
```

Do not place host paths, credentials, raw rows or customer data in this mandate.
The attached source artifacts remain outside Git and are referenced through
their checksums and approved work-product metadata.

Keep the PDF/catalogue, Woo export, working directories and complete outputs
outside Git and outside the catalogue-evidence publication mount. Do not attach
raw commercial rows or source documents to agent-readable issue comments.

## Execution sequence

1. Run the immutable `catalog-regression/v1` suite and require four adapters,
   six fixtures, 21/21 pairs, coverage `1` and error `0`.
2. Confirm that the selected adapter owns the exact brand, snapshot and pages.
   A new layout requires a sanitized fixture, negative regression and a new
   adapter revision before this pilot can continue.
3. Prepare the official source with the networkless catalogue runtime and
   validate `catalog-run/v1` plus every `catalog-field-evidence/v1` record.
4. Create a new reconciliation profile bound to the complete Woo export and
   the mandate's exact entity/field allowlists. Keep
   `audit.ignoredColumns: []`.
5. Run `woo-reconcile`. It may emit only local `needs_review` differences and
   must emit no import CSV or external authority.
6. Perform field-level human QA. Report unsupported or conflicting critical
   fields as blocked fields; do not broaden scope to find a match.
7. If Board approves exact run and field revisions for agent visibility, build
   a separate `catalog-evidence-publication/v1` directory containing only the
   declared manifests, evidence and optional crops. Validate it before mount.
8. Treat the named technical support pack only as a follow-up candidate. Pack
   finalization/import remains operator-only under the product-support runbook.

## Required work product

Create one durable `catalogue-audit-report` linked to the exact issue revision.
It must contain:

- mandate revision and every input/profile/adapter checksum;
- brand, domain, exact entities and exact fields in scope;
- regression and adapter metrics;
- Woo snapshot timestamp, completeness and row count;
- totals for matched, mismatched, blocked and out-of-scope fields;
- evidence keys and coordinates/crops without raw source-file access;
- the local change-set checksum, or an explicit statement that none exists;
- evidence-publication key/checksum when Board approved one;
- support-pack candidate recommendation and missing evidence;
- `PASS`, `PARTIAL` or `FAIL`, with the reason and separate follow-up issues.

`PASS` means the requested report is complete and no critical in-scope conflict
is unresolved. `PARTIAL` means the report is complete but evidence or mappings
remain unavailable. `FAIL` means the completed audit proves a contract,
identity, quality or drift violation. All three are terminal `done` outcomes
for this reporting task. Use `blocked` only when the required mandate or input
prevents producing the report.

## Explicit non-authority

This pilot cannot create or apply a Woo import, change price or stock, update a
feed, import/reindex/purge a support pack, publish content, approve its own
evidence, or process another brand/domain/entity/field. A later operator action
requires a separate exact Board decision and, after any Woo import, the full
post-import audit defined in [Woo catalogue reconciliation](catalog-reconciliation.md).
