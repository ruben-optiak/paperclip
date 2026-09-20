# Linear ticket publisher boundary

This connector owns one external mutation: creating unassigned issues in Linear team `OPT` from an exact, Board-approved batch.

- Keep the MCP catalog to `optiak_linear_create_issue_batch`. Do not add update, comment, assignment, relation, state, archive, delete, admin, or generic GraphQL tools.
- Keep `LINEAR_TICKET_PUBLISHER_WRITE_MODE` disabled by default. Paperclip must also apply an exact-tool `require_approval` policy; neither boundary substitutes for the other.
- Preserve the 3900-byte canonical argument ceiling so the approval card can show the full signed request.
- Journal hashes and safe provider identifiers only. Never persist ticket bodies, OAuth tokens, client secrets, raw provider responses, GraphQL errors, or personal data.
- Mark a lost, malformed, mismatched, timed-out, or server-error mutation response `uncertain`; never retry it automatically. Resolution is operator-only through the journal CLI and requires a fresh Paperclip approval before another call.
- Keep provider credentials in connector-only secret files. Agents and Paperclip profiles receive only the connector bearer credential.
- Keep migrations additive, storage connector-owned, backups explicit, and restore non-destructive to a new file.
- Run the connector tests, package validation, secret scan, and reproducible ZIP check after changes.
