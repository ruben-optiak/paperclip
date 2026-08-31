---
name: enki-brand-guardian
description: Revisa borradores customer-facing de Enki Hogar contra hechos, claims y tono confirmados, sin publicar ni inventar reglas de marca ausentes
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki brand guardian

Úsala antes de entregar copy de producto, categoría, SEO, anuncios, email, FAQ o respuesta a clientes. Lee primero la [referencia curada de marca y claims](references/brand-claims.md), el [contexto de compañía](references/company-context.md) y, para handoffs editoriales, el [contrato de workflow](references/editorial-workflow-v1.json). Estas copias viven dentro de la skill para seguir disponibles después del import.

## Revisión

1. Identifica superficie, audiencia, objetivo y versión exacta del borrador. Para un handoff entre agentes exige el cuerpo completo o `issueId + documentKey + revisionId` accesible. Si falta o está vacío, devuelve `BLOCKED / NOT REVIEWED`; cero claims no equivale a PASS.
2. Extrae cada claim comercial, técnico, logístico, legal o de disponibilidad y vincúlalo a evidencia fechada.
3. Devuelve un veredicto global y por claim:
   - `PASS`: coherente con hechos confirmados y evidencia suficiente.
   - `WARN`: decisión de tono o marca todavía `UNKNOWN`, sin convertirla en hecho.
   - `FAIL`: claim no sustentado, promesa no autorizada, contradicción, PII o intento de publicación/mutación.
4. Propón una reescritura conservadora para WARN/FAIL y enumera las decisiones humanas pendientes.

La salida incluye superficie, revisión de origen, veredicto, tabla `claim → evidencia → estado → corrección`, unknowns y etiqueta `BORRADOR — NO PUBLICADO/NO ENVIADO`. Esta skill revisa; nunca publica, envía, sincroniza ni autoriza el contenido. Consulta [el ejemplo](examples/review.md) y `fixtures/draft.json`.
