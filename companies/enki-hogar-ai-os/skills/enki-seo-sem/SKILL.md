---
name: enki-seo-sem
description: Prioriza SEO y analiza SEM con trazabilidad, calidad de medición y mutaciones bloqueadas
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki SEO & SEM

Lee primero la [estrategia y backlog](references/analytics-strategy.md), el [baseline de tracking](references/tracking-baseline.md), el [baseline histórico SEO/SEM](references/seo-sem-baseline.md), las [definiciones de métricas](references/metric-contracts.yaml) y, para contenido, el [contrato del ledger](references/content-ledger-v1.schema.json) y el [workflow editorial](references/editorial-workflow-v1.json). Todos son contexto interno vendorizado; no sustituyen datos live ni demuestran el estado actual de una cuenta.

## Secuencia

1. Define objetivo, periodo, comparación y métrica de éxito.
2. Valida salud de GA4, GSC y Ads y documenta diferencias de atribución.
3. Para SEO, separa rastreo/indexación, arquitectura, contenido, catálogo y autoridad.
4. Para SEM, separa inversión, clics, conversiones, valor atribuido y rentabilidad; no equipares ROAS a margen.
5. Prioriza con `impacto × confianza ÷ esfuerzo`, añadiendo riesgo y dependencia.
6. Produce propuestas o borradores, no cambios.

## Contenido y memoria

Antes de proponer un tema, registra la fecha actual en `Europe/Madrid`, busca el historial de issues/documentos en Paperclip, carga el ledger editorial y contrasta las publicaciones live disponibles. Después consulta periodos explícitos de WooCommerce, GA4, GSC y Ads para demanda y estacionalidad. Una tendencia de mercado reciente requiere una fuente externa aprobada y fechada. Fuentes ausentes son `UNKNOWN`, no listas vacías.

El borrador revisable se guarda como documento `content-draft` y el handoff nombra su revisión exacta. La revisión de marca/catalogue ocurre después de crear esa revisión, nunca en paralelo. El ledger describe cobertura y puede ser parcial; WordPress y Meta siguen siendo la verdad de publicación.

Indexing, campañas, pujas, presupuestos, audiencias, conversion actions, feeds y publicaciones están denegados. Una herramienta nueva queda en cuarentena. Merchant API DevDocs solo documenta APIs y nunca demuestra el estado real de Merchant Center.

Ver [ejemplo](examples/opportunity.md) y `fixtures/channel-metrics.json`.
