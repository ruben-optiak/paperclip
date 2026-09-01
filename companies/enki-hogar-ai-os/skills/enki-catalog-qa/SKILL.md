---
name: enki-catalog-qa
description: Valida datos de catálogo mediante fuentes, normalización, comparación, QA, aprobación y exportación controlada
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki catalogue QA

Aplica siempre esta cadena, sin saltos:

`fuentes → normalizado → comparativa → QA → aprobación → export`

Antes de comparar, lee el [contexto de catálogo](references/catalog-crm.md), el [schema y modelo de atributos](references/catalog-schema.md) y el [playbook de validación](references/catalog-validation-playbook.md). Son referencias internas vendorizadas con la skill para el runtime importado.

## Contrato obligatorio de salida

Toda ejecución que procese o compare datos de catálogo usa conjuntamente:

- [catalog-run/v1](references/catalog-run-v1.schema.json) para fijar fuentes, checksums, runtime, reglas, artefactos, etapas y decisión;
- [catalog-field-evidence/v1](references/catalog-field-evidence-v1.schema.json) para conservar una observación por entidad y campo, incluido valor crudo, normalizado y localización exacta;
- [catalog-change-set/v1](references/catalog-change-set-v1.schema.json) para describir la diferencia revisable y su elegibilidad para un borrador local.

Valida primero los JSON contra sus schemas estrictos y después ejecuta `scripts/validate_catalog_contracts.mjs` para comprobar hashes, geometría, lineage, valores, resumen y gates cruzados. Usa `fixtures/catalog-contracts/valid/` como ejemplo saneado y `fixtures/catalog-contracts/invalid/cases.json` como regresión negativa. Un CSV o Markdown suelto puede acompañar el informe para lectura humana, pero no sustituye estos contratos.

Antes de ejecutar un adaptador, replay histórico o auditoría real, exige además que pase la suite [catalog-regression/v1](references/catalog-regression-v1.schema.json) con `scripts/validate_catalog_regression.mjs`. Su manifiesto vive en `fixtures/catalog-regression/v1/manifest.json` y fija por hash seis casos saneados de Buades, Enki Espejos, Mundilite y Chicandbath. El gate cubre tabla, grid, detalle, columnas, varios SKU/precio, acabados y configurador, y proyecta los pares calculados a evidencia de campo v1. Consulta [el ejemplo de regresión](examples/regression-suite.md).

Exige también el registro y las definiciones [catalog-adapter/v1](references/catalog-adapter-v1.schema.json). El runtime `enki-catalog-pipeline` debe seleccionar exactamente un adaptador por marca, snapshot y página, comprobar hashes y producir sus métricas antes de comparar el oracle. Solo `row_left_to_right`, demostrado por tres marcas, pertenece al core; `matrix_by_headers` sigue siendo local de Chicandbath. Un resultado apto para continuar declara cuatro adaptadores, seis fixtures, 21/21 pares, cobertura `1`, error `0` y cero autoridad comercial, Woo o externa. Consulta [el ejemplo de adaptadores](examples/adapter-regression.md).

La comparación con Woo exige el perfil y los resultados [catalog-reconciliation/v1](references/catalog-reconciliation-v1.schema.json). El perfil fija el SHA y las filas del export completo, cada identidad y cada columna por `posición + original + deduplicada`. `woo-reconcile` produce los contratos v1 y únicamente diferencias locales pendientes; `woo-audit` compara exports completos antes/después contra ese change set exacto. El fixture bajo `fixtures/catalog-reconciliation/v1/` demuestra padre/variación, tres grupos de cabeceras duplicadas, precio bruto fiscalmente alineado, SEO/media en la capa padre, idempotencia y detección de deriva fuera de alcance. Consulta [el ejemplo de reconciliación](examples/woo-reconciliation.md).

## Reglas

- WooCommerce live es la fuente de verdad del catálogo comercial actual. La base `product-support-knowledge` no es un catálogo paralelo y no participa como autoridad de precio, stock, publicación, URL o existencia de producto.
- Para una auditoría masiva, exige un export **completo y recién generado** de WooCommerce, registra su `fetched_at`/checksum y trátalo como snapshot de comparación, no como una segunda fuente persistente.
- Registra URL o documento, fecha y nivel de autoridad de cada fuente. Prioridad: documentación oficial verificable, web oficial, fuente secundaria; si no hay evidencia, bloquea el campo, no necesariamente el issue.
- Normaliza unidades, enumeraciones y nombres de atributo antes de comparar.
- Conserva valor anterior, candidato, evidencia, confianza y motivo.
- Conserva también el valor crudo sin modificar, cada transformación aplicada, versión de regla, SHA-256 de fuente y fila histórica. No conviertas `validated`, `resolved` o `auto_clear` de un CSV antiguo en una aprobación Board.
- Marca como críticos al menos SKU, EAN/GTIN, marca, modelo, medidas, compatibilidad, precio, stock y atributos que afecten compra o feed.
- Distingue siempre producto padre, variación vendible, opción de configurador, componente independiente y venta asistida. No conviertas cada atributo informativo en variación ni generes combinaciones cartesianas sin evidencia de que cada combinación es vendible.
- Los CSV de WooCommerce pueden incluir cabeceras visualmente duplicadas. Identifica columnas por posición y conserva el encabezado original; nunca dejes que un parser sobrescriba silenciosamente una columna homónima.
- Rechaza filas con más o menos celdas que la cabecera. No rellenes ni trunques una fila dañada, y no reutilices un perfil si cambia el SHA, el número de filas o cualquier binding posicional.
- No cambies un oracle multimarca para acomodar una heurística nueva. Si la fuente demuestra un layout distinto, añade un fixture saneado y una regresión negativa; una regla específica pertenece al adaptador versionado de esa marca.
- No ejecutes un adaptador sobre un snapshot o página fuera de su alcance declarado. Incluso para la misma marca, un PDF nuevo exige fixture saneado y versión nueva; nunca uses la semejanza visual como permiso implícito.
- En PDF conserva página y cajas `x0,y0,x1,y1` de referencia, valor, unidad y encabezado local cuando existan. Si un histórico solo permite recuperar la página, decláralo como precisión `page_only`; no inventes coordenadas ni apruebes así un campo crítico.
- Separa el matching de identidad (`manufacturer_ref`, SKU padre, SKU variación, EAN) del matching de página/slug. Una coincidencia de nombre no basta para actualizar un producto.
- Una variación nunca es dueña de título, SEO o media de página. Resuelve `simple → propia página`, `parent → propia página`, `variation → parent`; cualquier relación huérfana o modificada falla el gate.
- En `catalog-reconciliation/v1`, `audit.ignoredColumns` permanece vacío: el export posterior debe conservar todas las celdas que no formen parte exacta del change set aprobado, incluso fuera del alcance de entidades.
- No exportes un campo crítico discrepante o sin aprobación humana.
- La exportación es un archivo local de borrador; nunca escribe en WooCommerce, Merchant Center o WordPress.
- Después de cualquier importación humana en WooCommerce, exige un segundo export completo y repite la comparativa. Cierra solo cuando no haya altas/bajas inesperadas, SKU duplicados, variaciones huérfanas, precios/stock alterados fuera del alcance ni mismatches críticos.

El informe final incluye `runKey`, revisión y SHA del perfil de reconciliación, revisiones de contratos, adaptador/regla exactos, versión/resultado de la regresión multimarca, métricas de cobertura/error, discrepancias, bloqueos, aprobaciones requeridas y checksum del change set local. Tras un import humano incluye también el checksum del export posterior y el veredicto de deriva. Consulta [el ejemplo](examples/comparison.md), [la regresión](examples/regression-suite.md), [los adaptadores](examples/adapter-regression.md), [la reconciliación Woo](examples/woo-reconciliation.md), `fixtures/product.json` y los bundles saneados bajo `fixtures/catalog-contracts/valid/` y `fixtures/catalog-reconciliation/v1/`.

## Disposición del issue

- Una auditoría completa puede concluir `PASS`, `PARTIAL` o `FAIL`; cualquiera de esos veredictos termina en `done` cuando el informe solicitado y su evidencia están completos.
- Usa `blocked` únicamente si no puedes producir el informe o artefacto pedido. Una corrección de conector, dato o catálogo que otro agente pueda abordar de forma independiente se crea como issue de seguimiento separado.
- Nunca nombres a otro agente, al Board o a un usuario en un `unblockDescriptor` autenticado como agente. Para un handoff crea y asigna el issue correspondiente; bloquea el issue fuente con `blockedByIssueIds` solo si su propio entregable debe esperar.
