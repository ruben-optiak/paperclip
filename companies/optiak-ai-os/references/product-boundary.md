# Optiak product boundary

Status: approved founding context for package `0.1.0`.

Optiak is an AI gateway platform and control plane. Teams use the control plane to configure organization-level providers, models, governance and shared capabilities, and use applications to group credentials, allowed models, guardrails, tools, data integrations, cost settings, and inference defaults. Services send inference traffic through the Optiak gateway using an application API key.

Optiak's value is central governance across providers and AI traffic: configuration, routing, protection, enrichment, observability, cost control, and team access.

## In scope

- organization and application control;
- upstream AI provider and model governance;
- OpenAI-compatible Chat Completions and Responses traffic;
- model eligibility and smart routing;
- guardrails, data enrichment, tools, costs, request history, and observability;
- platform administration, permissions, auditability, and developer experience.

## Explicitly not Optiak's layer

- general-purpose chatbot products;
- agent builders or agent orchestration products;
- end-user application builders;
- ownership of customer application UX or domain workflows.

A proposal that crosses this boundary is not automatically rejected, but it requires an explicit strategy decision rather than being smuggled into a feature or technical change.

Canonical public starting point: https://docs.optiak.dev/getting-started/overview
