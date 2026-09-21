# Execution budgets and context efficiency

This runbook applies the provisional USD limits in `policies/execution-budget.yaml`. Paperclip's `costCents` field represents dollar cost. The limits are intentionally conservative while Optiak AI OS uses fixtures and disconnected sources; review them after ten priced production-like runs or thirty calendar days.

## What the token numbers mean

Paperclip records token usage across every model call made during one heartbeat run. `rawInputTokens` is therefore cumulative usage, not the size of one prompt or one context window. `cachedInputTokens` is the cached subset. Use `rawInputTokens - cachedInputTokens` as `uncachedInputTokens`, the primary context-efficiency metric.

The baseline through the Director synthesis contains seventeen successful runs, 2,814,609 raw input tokens, 2,395,008 cached input tokens, and 419,601 uncached input tokens. The apparent 382,446-token Director run was 337,536 cached plus 44,910 uncached. It was below the 48,000-token warning for a 60,000-token synthesis review capacity.

Reproduce the aggregate from a Board-authenticated host CLI without persisting raw run payloads:

```sh
npx paperclipai run list --company-id <company-id> --limit 200 --json \
  | node companies/optiak-ai-os/scripts/summarize-run-usage.mjs
```

The committed aggregate intentionally contains no database IDs, prompts, comments, logs, or credentials.

## Enforcement layers

- Monthly company and agent budgets create a warning incident at 80 percent and a hard stop at 100 percent when `cost_events.costCents` is priced.
- `maxDailyRuns` blocks a new wake before adapter execution after the UTC-day cap is reached. Started cancelled runs count; queued runs that never start do not.
- `maxDailyCostCents` blocks a new wake at the priced UTC-day cost cap.
- `timeoutSec: 300` terminates a fixture-phase run at five minutes. Review at four minutes. Temporarily raising it requires a scoped Board decision and a reason in the issue.
- Token capacities are post-run review gates because Paperclip does not currently expose an in-flight Codex token hard stop. At 80 percent, tighten or split the next run. At 100 percent, do not expand the source set further; finish safely or block with the missing owner and source.

Subscription-included Codex runs currently report `costStatus: unpriced`. In that mode monetary spend is unknown, not zero, so monthly and daily cost gates are configured but cannot fire from those runs. Daily-run caps and timeouts remain active.

## Apply after import

Agent budget values, daily caps, and timeouts live in `.paperclip.yaml`. On replacement import the current importer updates the agent budget field but does not guarantee reconciliation of the separate budget-policy record. The company budget is not part of the portable company manifest. After every material import:

1. Keep every agent and routine paused.
2. Set the company monthly budget to `15000` USD cents (`$150`) through Settings → Costs & budgets, or `paperclipai budget company:update`.
3. Reconcile each agent monthly value from `policies/execution-budget.yaml` through the same UI or `paperclipai budget agent:update <agent-id>`.
4. Confirm the budget overview reports one company policy and ten agent policies, each with warning `80`, hard stop enabled, and observed amount based only on priced events.
5. Confirm each agent still has the expected `maxDailyRuns`, `maxDailyCostCents`, `timeoutSec`, paused status, and no active run.

Example payloads:

```sh
npx paperclipai budget company:update --company-id <company-id> \
  --payload-json '{"budgetMonthlyCents":15000}'

npx paperclipai budget agent:update <agent-id> \
  --payload-json '{"budgetMonthlyCents":1500}'
```

Never put a Board token, agent key, credential, local ID, or real run export in this package.

## Context discipline

- Begin with the current issue, wake payload, and current-run comments. Do not load company-wide history by default.
- For synthesis, pass a bounded source manifest and canonical report references. Fetch a full thread only to verify a material claim, ambiguity, or contradiction.
- Read each selected source once, record its authority and freshness, and avoid repeated broad searches.
- Do not create a second truth source merely to save tokens. A compact index may point to canonical reports but must preserve provenance and freshness.
- Reports must state source count, unknowns, and omitted scope. Concision cannot remove safety gates, contradictory evidence, or approval requirements.
- Do not query usage from inside the working run. Evaluate it after Paperclip persists the final usage record.

## Multi-agent engagement budget

One engineering question has one lead, at most two consulted agents and one
canonical report. All ten current agents have a distinct lead class.
Consultation is `delta_only`: pass evidence references, one specific unanswered
question and its expected evidence delta, not the full upstream transcript.
Duplicate consultation questions, evidence references or parallel full reports
fail the routing gate. Engineering Assurance builds an evidence index and
disposition; it does not commission a second execution of already accepted
Product, UI, Documentation, Architecture, Engineering, Review, QA or Reliability
work.

Adding an agent because the issue is broadly “technical” is not a reason. Add a
specialist only when its role-specific evidence is required by the next gate.

## QA runner resources

The future dedicated QA runner is limited to one concurrent job, 1,200 seconds,
2 MiB of retained redacted artifacts and zero automatic retries. These are
resource caps, not activation authority. A timeout keeps partial evidence and
returns `blocked`; it does not restart with a broader profile. The runner remains
disconnected until the isolation smoke in `runbooks/qa-source-execution.md`
passes.
