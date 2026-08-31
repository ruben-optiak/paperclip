# Enki content publisher MCP

Governed publishing shim for WordPress, a Facebook Page, and an Instagram
professional account. Upstream credentials live only in this process. Paperclip
receives a separate MCP bearer and agents receive only a run-scoped governed
gateway token.

## Safety model

Two independent gates are mandatory:

1. `CONTENT_PUBLISH_WRITE_MODE` defaults to `disabled` inside the connector.
2. Paperclip keeps the three write tools on **Ask a human first**.

Supported modes:

- `disabled`: reads work when a provider is configured; every write fails before
  the idempotency journal or provider is called.
- `wordpress-drafts`: only `wordpress_upsert_post` with `status=draft` is allowed.
- `approved`: the reviewed write catalog can execute, still subject to Paperclip
  approval for each exact argument payload.

Never expose this MCP directly to an agent or the public internet. The host port
is loopback-only and `/mcp` requires `CONTENT_PUBLISHER_MCP_TOKEN`.

## Catalog

Read tools:

- `publisher_get_capabilities`
- `wordpress_list_posts`
- `wordpress_get_article`
- `facebook_list_page_posts`
- `instagram_list_media`
- `instagram_get_publishing_limit`

Ask-first write tools:

- `wordpress_upsert_post`
- `facebook_publish_page_post`
- `instagram_publish_image`

There is no delete, comment, direct-message, account-management, bulk publish,
WordPress page/plugin, or social moderation tool.

## Idempotency journal

Every write requires a stable `idempotency_key`, normally
`<issue>:<document-key>:<revision>`. Before calling the provider, the connector
stores only a SHA-256 request hash and operation metadata. A successful retry
returns the stored sanitized result. If a network failure makes the outcome
uncertain, automatic retries fail closed until an operator reconciles the
journal:

```sh
node src/admin.mjs list
node src/admin.mjs reconcile \
  --provider wordpress \
  --operation upsert_post \
  --key ENK-100:content-draft:7 \
  --outcome applied \
  --external-id 123 \
  --status draft
```

Use `--outcome not-applied` only when the live provider proves no side effect
occurred and retry is safe. Applied reconciliation requires both the external ID
and verified live status (`draft`, `pending`, `future`, `publish`, or
`published`). This administration command is not part of MCP.

## Provider notes

WordPress uses the core REST API and one revocable Application Password over
HTTPS. The tool accepts rendered HTML and supports draft, pending, scheduled and
published posts; categories/tags are IDs or names, with term creation explicit
and off by default. Media upload is intentionally absent in v0.1.0: use an
existing `featured_media` ID.

Facebook v0.1.0 publishes one Page text/link post. Instagram v0.1.0 publishes one
JPEG from a public HTTPS URL using the media-container then `media_publish`
flow. The reviewed route is Instagram API with Facebook Login: a Meta Business
app, Page, linked professional Instagram account and Page access token with
`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`instagram_basic`, and `instagram_content_publish`. Do not grant messaging or
comment permissions. The Meta Graph API version is required configuration
instead of a mutable `latest` alias.

Primary references:

- [WordPress posts REST API](https://developer.wordpress.org/rest-api/reference/posts/)
- [WordPress Application Password authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [Official Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Official Meta Facebook API collection](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api)

## Development

```sh
npm install
npm test
```

Tests use local fakes only and never call WordPress or Meta.
