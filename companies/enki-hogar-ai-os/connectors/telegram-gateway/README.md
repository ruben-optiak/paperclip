# Enki Telegram Gateway

Company-scoped Paperclip plugin for audited communication between an allowlisted Telegram account and the Enki Director.

## Boundary

- Authorized text creates a Paperclip issue assigned to the Director; it never invokes an arbitrary tool or shell command.
- Every command/event revalidates the mapped Paperclip principal as an active non-viewer company member; replies also receive the host's independent human-attribution check.
- Director replies, completed daily/weekly reports, and pending-approval notices may be relayed to one allowlisted chat.
- Approval notices contain a Paperclip link only. The manifest deliberately lacks `approvals.respond` and `issue.interactions.respond`.
- Inbound messages that look like credentials, personal data, payment-card numbers, or exact order references are rejected before an issue/comment is created.
- Likely credentials, email addresses, phone numbers, payment-card numbers, and exact order references are withheld from outbound Telegram messages.
- The bot token is a company-scoped Paperclip Secret reference. It is resolved at request time and is never stored in this package, `.env`, plugin state, issues, or logs.
- Configuration accepts only the existing-secret picker binding; pasting a raw value into the plugin form is intentionally rejected.

## Commands

| Input | Result |
| --- | --- |
| plain text or `/director <text>` | new Director issue |
| `/brief [context]` | manual daily-brief issue |
| `/reply ENK-123 <text>` | human comment on an open Director issue |
| reply to a linked bot message | human comment on that linked issue |
| `/status ENK-123` | safe issue status |
| `/help` | command summary |

Unknown commands, including `/approve` and `/reject`, are denied. Closed issues are not reopened from Telegram.

## Development

Run from the Paperclip repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @enki-hogar/telegram-gateway check
```

The build emits `dist/manifest.js`, `dist/worker.js`, and `dist/ui/`. The local Docker runbook bind-mounts this folder at `/plugins/enki-telegram-gateway` inside Paperclip, then installs that container-visible path with the Paperclip CLI.

To discover Telegram IDs without putting the token in shell history, first send `/start` to the bot and then pipe the token on stdin to `pnpm --filter @enki-hogar/telegram-gateway discover-ids`. The helper prints only numeric user/chat IDs and chat type; it never prints message text or the token.

See [the connection runbook](../../runbooks/connections.md#telegram-director-gateway) for installation and configuration.
