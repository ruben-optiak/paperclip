---
name: enki-seo-sem
description: Prioriza SEO y analiza SEM con trazabilidad, calidad de medición y mutaciones bloqueadas
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki SEO & SEM

Lee primero la [estrategia y backlog](references/analytics-strategy.md), el [baseline de tracking](references/tracking-baseline.md), el [baseline histórico SEO/SEM](references/seo-sem-baseline.md) y las [definiciones de métricas](references/metric-contracts.yaml). Todos son contexto interno vendorizado; no sustituyen datos live ni demuestran el estado actual de una cuenta.

## Secuencia

1. Define objetivo, periodo, comparación y métrica de éxito.
2. Valida salud de GA4, GSC y Ads y documenta diferencias de atribución.
3. Para SEO, separa rastreo/indexación, arquitectura, contenido, catálogo y autoridad.
4. Para SEM, separa inversión, clics, conversiones, valor atribuido y rentabilidad; no equipares ROAS a margen.
5. Prioriza con `impacto × confianza ÷ esfuerzo`, añadiendo riesgo y dependencia.
6. Produce propuestas o borradores, no cambios.

Indexing, campañas, pujas, presupuestos, audiencias, conversion actions, feeds y publicaciones están denegados. Una herramienta nueva queda en cuarentena. Merchant API DevDocs solo documenta APIs y nunca demuestra el estado real de Merchant Center.

Ver [ejemplo](examples/opportunity.md) y `fixtures/channel-metrics.json`.
