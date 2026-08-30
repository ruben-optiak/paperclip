# Company packages

`companies/` contains private or organization-specific `agentcompanies/v1` packages. They are portable configuration and operating knowledge, not Paperclip product code.

For every package:

- Keep agents, projects, tasks, routines, skills, policies, fixtures, and runbooks inside the package directory.
- Never commit credentials, tokens, customer PII, database identifiers, machine-specific paths, or a real `.env` file.
- Keep imported agents and routines paused until the package smoke tests have passed.
- Treat connector catalogs as deny-by-default: new or mutating tools stay quarantined until a human reviews them.
- Run the package's own validation, secret scan, and tests before import or promotion.
- Update the package README and runbooks whenever its operational contract changes.
