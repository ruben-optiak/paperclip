---
name: enki-editorial-learning
description: Captura feedback editorial de Enki y evalúa publicaciones a 7, 28 y 90 días, proponiendo aprendizajes trazables sin convertir observaciones aisladas en reglas automáticas
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki editorial learning

Úsala al recibir feedback sobre una revisión exacta o al medir contenido publicado. Lee el [contrato de feedback](references/editorial-feedback-v1.schema.json), el [contrato de retrospectiva](references/publication-retrospective-v1.schema.json), la [política de aprendizaje](references/editorial-learning-policy-v1.json) y el [workflow editorial](references/editorial-workflow-v2.json).

## Ciclo

1. Registra feedback humano o de agente en `editorial-feedback`, ligado a `issueKey + documentKey + revisionId + contentKey`. Resume o anonimiza señales de audiencia; no copies PII ni payloads crudos.
2. Antes de programar/publicar live, inicializa `publication-retrospective` y congela hipótesis, métrica, baseline, regla de decisión, limitaciones y checkpoints. Un draft canary no inicia el reloj.
3. Tras verificar la respuesta live de WordPress/Meta, registra `publishedAt` y calcula fechas de 7/28/90 días desde la fecha local del proveedor.
4. Evalúa solo ventanas cerradas con fuentes, periodos y calidad explícitos. Poco volumen es `insufficient_volume`; fuente parcial/caída es `partial`/`unavailable`; ninguno demuestra éxito o fracaso.
5. Separa resultado de aprendizaje. Una observación queda como candidata; no modifica prompts, skills, contratos ni conectores.
6. Propón promoción solo por repetición independiente, riesgo grave confirmado, mejora demostrada con comparador o corrección de medición. Board decide; implementar exige la mínima superficie versionada, evidencia y test de regresión. Conserva reglas rechazadas o `superseded`.

Growth mantiene hipótesis y checkpoints; el Director consolida feedback y pide la decisión Board. Métricas financieras incompletas se entregan a Finance y nunca se sustituyen por tráfico, ROAS o cero. Los fallos de medición se entregan a Technology.

Valida cada documento antes del handoff:

```sh
node scripts/validate_editorial_learning.mjs fixtures/editorial-feedback.json
node scripts/validate_editorial_learning.mjs fixtures/publication-retrospective.json
```

Consulta el [ejemplo de ciclo](examples/learning-cycle.md) y los casos positivos/negativos en `fixtures/learning-cases.json`.
