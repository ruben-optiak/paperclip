---
name: enki-editorial-planning
description: Planifica contenido de Enki desde evidencia hasta una decisión Board versionada, alineando shortlist, validación de Ecommerce y autorización de borrador sin confundir superficies ni identidades
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki editorial planning

Úsala para elegir qué contenido investigar o redactar, no para escribirlo ni publicarlo. Lee el [workflow v2](references/editorial-workflow-v2.json), el [contrato del brief](references/editorial-brief-v2.schema.json) y el [ledger](references/content-ledger-v1.schema.json).

## Secuencia obligatoria

1. **Research — Growth.** Fija fecha y `Europe/Madrid`; busca historial durable y ledger; consulta WordPress/Meta live y periodos explícitos de GSC, GA4, Ads y WooCommerce. Declara cobertura, frescura y `UNKNOWN`.
2. **Shortlist — Growth.** Actualiza `editorial-brief`, tipa cada superficie (`category`, `brand_landing`, `article`, `product`, etc.), puntúa con pesos declarados y registra revisión y fingerprint. Un post de WordPress nunca es un producto/SKU Woo.
3. **Candidate validation — Ecommerce.** Valida la revisión y el fingerprint exactos, sin añadir ni omitir candidatos. Woo live prueba catálogo comercial; el pack técnico prueba solo hechos estables. Evidencia inaplicable o ausente es `not_applicable`/`partial`, no PASS inventado.
4. **Board decision.** Presenta candidatos, puntuaciones recalculadas, riesgos, unknowns y decisión pedida. Solo Board decide sobre esa revisión exacta.
5. **Decision application — Director/Growth.** Crea una revisión posterior de `editorial-brief` que incorpore decisión, condiciones y siguiente acción. La decisión no abre `draft` hasta que exista esa revisión nueva.
6. **Draft → review → publish.** Growth crea `content-draft`; Ecommerce revisa esa revisión exacta; publicar sigue siendo otra aprobación Board sobre argumentos exactos e idempotencia.

No avances una etapa dependiente en paralelo. Si falta el artefacto o no coincide el fingerprint, devuelve `BLOCKED / NOT VALIDATED`. Si el informe puede cerrarse con huecos explícitos, devuelve `PARTIAL` y crea seguimiento separado.

Valida un brief antes de cada handoff:

```sh
node scripts/validate_editorial_brief.mjs fixtures/enk-24-corrected.json
```

Consulta el [ejemplo de entrega](examples/decision-ready-brief.md) y las mutaciones negativas en `fixtures/validation-cases.json`.
