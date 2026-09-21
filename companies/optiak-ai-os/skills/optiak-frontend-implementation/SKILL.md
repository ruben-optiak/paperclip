---
name: optiak-frontend-implementation
description: Implement an approved Optiak console UI change inside a Paperclip-provided isolated workspace, preserving product intent, existing component patterns, accessibility, and independent review. Do not use for marketing pages, read-only UI audits, or work without an authorized optiak-frontend workspace.
---

# Optiak frontend implementation

Use this skill only for an approved implementation task in
`optiak/optiak-frontend`. A UI audit belongs to `optiak-ui-audit`; a product
decision belongs to Product & PRD Lead.

## Preconditions

Require all of the following before editing:

- explicit intent, acceptance criteria, target surface, and review owner;
- an exact starting revision;
- an isolated writable execution workspace for the approved repository,
  created and assigned by Paperclip;
- applicable repository instructions and the strongest available Optiak design
  or product reference.

If the writable execution workspace is missing, return
`blocked_on_workspace` with the required owner and action. Do not edit an agent
home, a shared checkout, or an illustrative copy and present it as repository
work. Apply the package-level `references/execution-workspace-contract.json`
and `runbooks/execution-workspaces.md`; fixture evaluation is not live workspace
evidence.

## Implementation workflow

1. Read the governing repository instructions, nearby implementation, shared
   components, tokens, tests, and relevant contracts before changing code.
2. State the screen's job and primary action. For visually led work, record a
   short visual and interaction thesis; for operational surfaces, prioritize
   orientation, status, decision value, and utility copy.
3. Reuse the existing design system and component primitives. Prefer clear
   hierarchy, deliberate spacing, restrained color, and layout over ornamental
   cards, gradients, icons, or motion.
4. Implement the smallest coherent change. Cover loading, empty, partial,
   error, success, disabled, focus, permission, overflow, and responsive states
   that the changed behavior can reach.
5. Preserve keyboard access, visible focus, labels, contrast, reduced motion,
   localization-safe layout, and meaningful feedback. Motion must clarify
   hierarchy or state rather than decorate routine product UI.
6. Run the smallest repository-defined checks that prove the affected behavior.
   Use an approved browser target for visual evidence only when its environment,
   persona, data scope, and mutation policy are explicit.
7. Hand off the exact revision, changed files, tests and results, visual
   evidence when available, known exclusions, and residual risk to Independent
   Code & PR Reviewer. User-facing behavior also goes to QA; visual changes go
   to Brand & UI Quality Reviewer.

## Workspace and authority boundaries

- Use the workspace and branch Paperclip provides. Never create a nested
  worktree, switch or rename branches, repoint the checkout, or clean up a
  workspace owned by Paperclip.
- Do not merge, publish, deploy, change repository settings, rotate secrets, or
  bypass an approval or sandbox boundary.
- A successful local test is implementation evidence for the exact revision;
  it is not deployment, staging, production, or release evidence.
- When product intent, design authority, or an external contract is ambiguous,
  preserve the competing evidence and request the responsible owner rather
  than silently choosing a new rule.

Use [the offline fixture](references/fixtures/frontend-change.md) to verify
routing and workspace behavior without a repository. See the
[example handoff](examples/delivery.md) for the required delivery shape. Source
adaptation provenance is recorded in the package-level local-skill manifest.
