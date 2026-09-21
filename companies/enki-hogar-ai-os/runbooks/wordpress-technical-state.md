# WordPress technical desired state

`EAI-026` separates three owners that must not be conflated:

- WordPress live owns the running core, theme, plugins and snippets.
- Runtime configuration owns GTM, consent, cache and CDN settings.
- This repository owns only the public scanner, expected invariants, tests,
  performance budgets and change/rollback evidence.

The desired-state contract is
`references/web/wordpress-technical-desired-state.json`. It grants no deploy or
publication authority and deliberately leaves the approved baseline hash null
until Board selects an exact observed snapshot.

## Capture

Run only against the clean public HTTPS origin:

```sh
node companies/enki-hogar-ai-os/scripts/web/inspect-public-wordpress.mjs \
  https://www.enkihogar.com/
```

The scanner makes two GETs: homepage and public REST index. It records status,
explicit generator metadata, public plugin/theme slugs, REST namespaces and
selected cache/CDN headers. GTM identifiers are reduced to count plus SHA-256.
It stores no HTML, credentials, PII, cookies or private WordPress identifiers.

Absent generator metadata means the WordPress version is unknown. Asset query
strings are never promoted to plugin/core versions. Public namespaces or asset
slugs prove exposure, not activation, ownership, safety or configuration.
Snippets, consent configuration and change history remain unknown without a
separately authorized administrative source.

The first public snapshot is
`references/web/snapshots/eai-026-public-2026-09-03.json`. It observed
WordPress 7.1, `hello-elementor`, 16 public plugin asset slugs, the exposed REST
namespace set, Apache/cache headers and a redacted GTM fingerprint. It is
evidence, not the approved drift baseline: active plugin versions, snippets,
consent settings and change history are still unknown, so EAI-026 cannot be
declared complete from public access alone.

## Drift and rollback

HTTPS loss, non-2xx homepage/REST, cross-origin canonical or sensitive data is
FAIL. Plugin/theme/namespace/GTM/cache changes require review. Header/asset
count changes are informational until tied to an approved baseline.

Every proposed technical change needs an issue revision, Board decision,
before-snapshot hash, target/effect and executable rollback steps. Afterwards
attach a new snapshot, functional smoke, performance comparison, observed
effect and rollback status. Never mutate WordPress, GTM, CDN or cache from the
scanner or infer approval from a matching snapshot.
