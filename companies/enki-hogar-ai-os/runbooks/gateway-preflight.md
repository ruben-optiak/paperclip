# Paperclip gateway preflight

Prove the access gateway before connecting production data. Use Paperclip's bundled `safe-read-only-todo-kv` fixture: it is local and synthetic, so it needs no WooCommerce or Google credentials. Its smoke test must prove all three checks: a read is allowed, a write is denied, and the decision is audit-visible.

The fixture installer creates Paperclip state. Create a separate disposable or permanently paused preflight company in the UI and use that company ID; do **not** install it into the Enki company, because Enki's drift gate correctly rejects unexpected active connections and profiles.

## Recommended: use the UI

In the paused preflight company open **Tools & Access → Examples → Safe read-only Todo / KV fixture**, choose **Install**, then **Smoke**. Accept only `ok: true` for `allow_read_tool`, `deny_write_tool`, and `audit_written`. This is the recommended local path because it needs no Board token handling in the shell.

## Scripted alternative

Create a one-day Board key from the Paperclip host/container. The JSON response includes confidential token material: display it only in the operator terminal, do not redirect or log it, and retain the non-secret key ID only long enough to revoke it.

```sh
npx paperclipai token board create \
  --company-id <preflight-company-id> \
  --name enki-preflight \
  --ttl-days 1 \
  --json
```

Enter the returned token with silent shell input so it never appears in command history, then run:

```sh
export PAPERCLIP_API_URL=http://localhost:3100
export PAPERCLIP_COMPANY_ID=<preflight-company-id>
read -r -s PAPERCLIP_BOARD_TOKEN
export PAPERCLIP_BOARD_TOKEN

companies/enki-hogar-ai-os/scripts/gateway-preflight.mjs --install
```

`--install` is the only mutating mode and is explicit. Subsequent checks omit it:

```sh
companies/enki-hogar-ai-os/scripts/gateway-preflight.mjs
```

The script sends the token only in the Authorization header and never prints it. Stop if any expected check is missing or false. Preserve only the redacted PASS/FAIL result, Paperclip version/commit, UTC time, and preflight company identifier in the operational evidence store. Never substitute a direct connector call for this test: the purpose is to exercise Paperclip's allow/deny/audit path.

Revoke the Board key immediately, even though it has a one-day TTL:

```sh
npx paperclipai token board revoke <key-id>
unset PAPERCLIP_BOARD_TOKEN PAPERCLIP_COMPANY_ID
```
