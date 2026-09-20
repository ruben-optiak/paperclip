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
| Notion OAuth grant | managed Paperclip company secret refs; no portable env name | Notion knowledge connection | official Notion MCP broker only; never agent-visible |
| Linear publisher OAuth client | `OPTIAK_LINEAR_PUBLISHER_OAUTH_CLIENT` | connector operator | publisher process only; never Paperclip or an agent |
| Linear publisher OAuth secret | `OPTIAK_LINEAR_PUBLISHER_OAUTH_SECRET` | connector operator | publisher process only; file-backed |
| Linear publisher MCP bearer | `OPTIAK_LINEAR_PUBLISHER_MCP_TOKEN` | connector and Paperclip operator | publisher process plus one Paperclip connection credential |
| Aggregate analytics read credential | `OPTIAK_ANALYTICS_READ_CREDENTIAL` | reliability connection | bounded Optiak analytics connector only |
| Metrics read credential | `OPTIAK_METRICS_READ_CREDENTIAL` | reliability connection | reviewed Prometheus query connector only |
| Exact trace read credential | `OPTIAK_TRACES_READ_CREDENTIAL` | reliability connection | ask-first exact-trace connector only |
| Error index read credential | `OPTIAK_ERROR_TRACKING_READ_CREDENTIAL` | reliability connection | redacted Sentry issue-index connector only |
| Runtime deployment read credential | `OPTIAK_RUNTIME_DEPLOY_READ_CREDENTIAL` | reliability connection | task-definition and image-digest reader only |
| Alert webhook secret | `OPTIAK_ALERT_WEBHOOK_SECRET` | Paperclip/operator | webhook verifier only |

Promotion also requires deployment-runtime secrets such as Paperclip session
and tool-action signing keys, database credentials, storage authority, and
secret-provider bootstrap. Their exact provider-specific names are selected
only with the infrastructure design. They remain operator/runtime inputs, not
company-package inputs or agent credentials.

Rules:

- Use dedicated identities and least privilege.
- Keep staging and production identities separate.
- Prefer short-lived OAuth/app credentials over personal tokens.
- Use Notion's OAuth DCR/PKCE flow. Do not create a `.env` entry, classic
  integration secret, or agent secret for the default setup. Paperclip stores
  access/refresh tokens and any DCR secret as company-secret references. Share
  only approved Product & Engineering pages/databases during consent; token
  possession does not widen the versioned role scope.
- Keep Linear read and issue-creation credentials separate. The publisher OAuth
  app uses only `read,issues:create`, has team access only to `OPT`, and its
  client secret never enters Paperclip. Paperclip stores only the independent
  publisher MCP bearer; Product never receives either credential value.
- Do not reuse one observability credential across analytics, metrics, traces,
  error tracking, runtime deployment metadata, or alert ingress. Each boundary
  must be independently scoped and revocable.
- The initial `OPTIAK_GIT_REVIEW_CREDENTIAL` is a GitHub fine-grained personal
  access token with a maximum lifetime of 30 days, selected-repository access
  only to `optiak/optiak`, `optiak/optiak-frontend`, and `optiak/iac-infra`, and
  read-only Actions, Commit statuses, Contents, Metadata, and Pull requests.
  Fine-grained PATs do not support the Checks API; missing Check Runs remain an
  explicit evidence gap until a dedicated GitHub App is approved.
- Store the GitHub token only in Paperclip's connection credential store. Never
  place it in `.env`, agent environment variables, issues, comments, command
  history, screenshots, or this package.
- Store the Daytona API key only through the saved sandbox environment's
  secret-backed `apiKey` field. It must not enter `.env`, an agent configuration,
  a task, a comment, a command line, a screenshot or this package. Start with a
  disposable lease and revoke the provider key independently if the boundary
  probe fails or the provider is removed.
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
- A database backup never substitutes for backup of the independently protected
  local encryption master key or hosted secret-provider bootstrap required to
  recover secret bindings.
