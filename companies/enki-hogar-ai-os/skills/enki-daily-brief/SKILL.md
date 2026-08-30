---
name: enki-daily-brief
description: Consolida WooCommerce, GA4, GSC y Google Ads en un brief con fuente, periodo, frescura y calidad explícitas
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki daily brief

Produce un brief verificable, nunca una narración basada en memoria.

## Flujo

1. Fija `as_of`, zona horaria `Europe/Madrid` y periodo comparable.
2. Consulta solo fuentes autorizadas. WooCommerce ya devuelve `enki-evidence-envelope/v1`. No modifiques los upstream de GA4, GSC o Ads: envuelve su respuesta cruda inmediatamente en la capa Enki antes de calcular o comparar nada.
3. Rechaza cualquier fuente que no sea un envelope válido. Son obligatorios `source`, `fetched_at`, `period_start`, `period_end`, `timezone`, `currency`, `currencies`, `status`, `freshness`, `partial`, `warnings` y `contracts`; el payload crudo solo puede vivir en `data`.
4. Clasifica por separado estado (`ok`, `partial`, `unavailable`) y frescura (`live`, `stale`, `historical`, `unavailable`); no rellenes huecos con el snapshot.
5. Calcula únicamente métricas cuyas entradas estén presentes y sean compatibles según [el contrato vendorizado de métricas](references/metric-contracts.yaml).
6. Separa alertas, decisiones pendientes y propuestas. Añade confianza y propietario del handoff.

El [contexto de compañía](references/company-context.md), la [estrategia](references/analytics-strategy.md), el [baseline de tracking](references/tracking-baseline.md) y el [baseline SEO/SEM](references/seo-sem-baseline.md) son contexto histórico, no fuentes live. Etiqueta siempre su fecha y nunca los uses para rellenar una fuente caída.

## Formato obligatorio

- Corte y periodo.
- Estado de fuentes: fuente, periodo, frescura, calidad y limitación.
- Ventas y pedidos agregados.
- Adquisición y visibilidad.
- Catálogo y stock.
- Alertas priorizadas.
- Decisiones pendientes.
- Propuestas y handoffs.

Si un conector falla, emite un envelope `unavailable` con `data: null`; conserva el último dato solo como otro envelope `historical`. No conviertas ausencia de cambio en cero. Valida el formato con [el schema vendorizado](references/evidence-envelope-v1.schema.json), [el ejemplo](examples/brief.md) y los fixtures del directorio `fixtures/`.
