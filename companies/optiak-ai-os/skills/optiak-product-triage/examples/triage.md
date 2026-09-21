# Example triage

Finding: an application credential screen does not explain that the secret is shown once.

## Executive summary

The observed UI may cause an application administrator to lose or mishandle a
one-time credential. This is a product-quality candidate, not an accepted
requirement or priority decision.

## Observed facts

- Evidence type: bounded staging UI observation at the recorded observation time.
- Persona: application administrator.
- The current screen does not explain that the secret is shown once.

## Hypotheses

- The ambiguity may lead to credential loss or insecure copying.
- Application credential governance is likely within Optiak's platform scope.

## Missing evidence

- Accepted PRD revision and current product-goal reference.
- Existing design-system pattern and measured user impact.

## Recommendation

- Disposition: `candidate`, pending Product review.
- Confidence: medium.
- Draft questions: should the warning precede creation, how is the post-create
  state made unambiguous, and what must documentation and QA verify?
- Next owner: Product & PRD Lead, followed by Brand/UI and QA if accepted.

## Board decisions

None until Product supplies the current goal or an explicit decision request.

The machine envelope is produced separately from this human memo.
