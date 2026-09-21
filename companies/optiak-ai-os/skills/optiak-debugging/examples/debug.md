# Example debugging note

Observation: a synthetic streaming request returns headers but no events in staging revision `fixture-r1`.

Hypotheses:

1. Gateway buffering — test with a direct fixture provider stream.
2. Provider did not stream — compare provider event timestamps.
3. Client parser rejected an event — capture redacted wire framing.

No source or telemetry is connected, so this fixture supports a diagnostic plan only, not a current root-cause claim.
