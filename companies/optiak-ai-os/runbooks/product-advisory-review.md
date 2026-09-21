# Product advisory review

This runbook turns a bounded read-only Product task into a Board decision memo.
It does not authorize a Linear write, code change, agent delegation, workflow
activation, or implementation.

## 1. Name the decision before selecting tickets

Choose exactly one purpose:

- `freshness_scan` or `backlog_hygiene_scan`; or
- `priority_ranking`, `roadmap_sequence`, or `strategy_recommendation`.

A priority or roadmap review requires an exact current Board decision or an
approved current intent reference. If neither is available, stop as
`blocked_on_strategy` or narrow the task to hygiene and evidence gaps. Never use
Linear recency as a strategy proxy.

## 2. Bound source reads

Run the existing connection preflight first. For the Product task:

- use team `OPT` only;
- make at most two bounded list calls and three exact detail calls;
- make at most six provider calls total and never follow a cursor;
- select from an approved goal, dependency chain, explicit Board question, or
  risk signal;
- never include a ticket in the recommendation table unless its exact detail was
  read during the same fresh review;
- omit incidental identities and do not request customer needs, releases,
  comments, notifications, attachments, Git, or code.

A list-only item may appear under missing evidence as `needs_detail_read`. It is
not a recommendation.

## 3. Write for the Board

The human memo is at most 700 words and contains:

1. an executive summary of at most five lines;
2. observed facts;
3. hypotheses;
4. missing evidence;
5. at most three recommendations; and
6. at most three Board decisions with a recommendation and tradeoff.

Every recommendation includes source, observed state, proposal, reason,
confidence, missing evidence and next owner. Acceptance criteria remain draft
questions until an accepted PRD revision supplies authority. Historical evidence
must show its observation time and must never be presented as current.

The machine-readable result envelope is separate from the human memo. It remains
available for validation and durable completion without making the executive
output harder to read.

## 4. Apply the deterministic gate

Prepare `optiak-product-advisory-evidence/v1` in memory and run:

```sh
node companies/optiak-ai-os/skills/optiak-product-triage/scripts/evaluate-product-advisory.mjs < evidence.json
```

Only `ready_for_board_review` is review-ready. Other verdicts are useful
diagnoses:

- `blocked_on_strategy`: recover an exact authority or narrow the question;
- `changes_required`: fix evidence depth, bounds, output separation or write
  violations;
- `efficiency_regression`: reduce context/output/runtime before another
  connected run.

Do not expand the sample or retry automatically to make a verdict pass.

## 5. Review efficiency after the run

Targets are 25,000 uncached input tokens, 4,000 output tokens and 180 seconds.
Review maxima are 40,000, 6,000 and 240 seconds. These are post-run quality
gates, not native in-flight enforcement. When approaching the target, stop
reading, state the missing evidence and finish the bounded memo.

The historical OPT-39 run exceeded all three review maxima. Its conclusions are
therefore useful only as historical workflow evidence, not as the efficiency
baseline for another connected run.

## 6. Preserve human authority

The Board may accept, reject or revise each recommendation. Record feedback as an
immutable QA document linked to the original report. Do not add a normal comment
to a completed agent issue, edit Linear, activate another agent, or convert a
provisional principle into an accepted PRD or architecture decision.
