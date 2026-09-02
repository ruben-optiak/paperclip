# Secret and credential matrix

No real secret belongs in Git, this package, an issue, an agent workspace, a screenshot, or an agent-authored response.

Future declarations are created only when their connection is approved:

| Purpose | Suggested portable name | Owner | Exposure |
| --- | --- | --- | --- |
| Local synthetic browser session | `OPTIAK_LOCAL_TEST_BROWSER_SESSION` | operator | approved browser connection only |
| Local synthetic application API key | `OPTIAK_LOCAL_TEST_APP_API_KEY` | QA connection | exact loopback API test tools only |
| Staging browser session | `OPTIAK_STAGING_BROWSER_SESSION` | operator | browser connector only |
| Staging application API key | `OPTIAK_STAGING_APP_API_KEY` | QA connection | exact sandbox API tools only |
| Test provider credential | `OPTIAK_TEST_PROVIDER_CREDENTIAL` | Optiak runtime operator | backend runtime only; never Paperclip or an agent |
| Git provider read token/app | `OPTIAK_GIT_REVIEW_CREDENTIAL` | repository connection | review connector only |
| Backlog read credential | `OPTIAK_BACKLOG_READ_CREDENTIAL` | product connection | backlog connector only |
| Observability read credential | `OPTIAK_OBSERVABILITY_READ_CREDENTIAL` | reliability connection | telemetry connector only |
| Alert webhook secret | `OPTIAK_ALERT_WEBHOOK_SECRET` | Paperclip/operator | webhook verifier only |

Rules:

- Use dedicated identities and least privilege.
- Keep staging and production identities separate.
- Prefer short-lived OAuth/app credentials over personal tokens.
- The initial `OPTIAK_GIT_REVIEW_CREDENTIAL` is a GitHub fine-grained personal
  access token with a maximum lifetime of 30 days, selected-repository access
  only to `optiak/optiak` and `optiak/optiak-frontend`, and read-only Actions,
  Checks, Commit statuses, Contents, Issues, Metadata, and Pull requests.
- Store the GitHub token only in Paperclip's connection credential store. Never
  place it in `.env`, agent environment variables, issues, comments, command
  history, screenshots, or this package.
- Application API keys are scoped to a synthetic sandbox application with a bounded provider budget.
- Browser cookies remain in the approved browser connection. Application keys
  remain in an exact API connector or in the human operator's manual smoke
  process. Provider credentials remain inside the Optiak runtime. None of these
  three secret classes may be copied into another boundary for convenience.
- The initial provider-spend proposal is USD 1, twelve requests, 128 output
  tokens per request, and zero automatic retries. It remains unauthorized until
  the Board approves it and a provider-side cap or bounded connector enforces
  it; an Optiak visibility-only application budget is insufficient.
- Secret metadata may be visible; values never enter prompts unless a governed connector requires them internally.
- Revoke each test credential independently and record provider-side revocation evidence.
