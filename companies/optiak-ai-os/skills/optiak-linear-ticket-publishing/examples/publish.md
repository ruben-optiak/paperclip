# Example

Product reviews immutable PRD revision `aaaaaaaa…`, prepares one ticket with two measurable acceptance criteria, and calls `optiak_linear_create_issue_batch`.

The first call returns `approval_required`. Product waits. The Board inspects the full signed batch and approves it. Product retries the identical call with Paperclip's action-request binding. The connector returns `OPT-321`, then Product verifies that exact identifier through the read-only Linear connection and records both creation and verification evidence.

If the connector instead returns `provider_transport_failure` with `operatorReviewRequired: true`, Product stops. An operator inspects Linear and reconciles the connector journal. Any later attempt requires a new Paperclip action approval.
