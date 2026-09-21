# Example case

Case: unauthenticated synthetic Chat Completions request.

- Target: fixture only; no live endpoint called.
- Expected class: authentication error with no provider invocation.
- Required evidence when connected: sanitized status/body schema, request-history absence or denied audit entry according to the approved contract, and no secret echo.
- Current result: blocked until sandbox API contract and credentials are connected.
