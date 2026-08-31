---
name: enki-catalog-qa
description: Valida datos de catálogo mediante fuentes, normalización, comparación, QA, aprobación y exportación controlada
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki catalogue QA

Aplica siempre esta cadena, sin saltos:

`fuentes → normalizado → comparativa → QA → aprobación → export`

Antes de comparar, lee el [contexto de catálogo](references/catalog-crm.md), el [schema y modelo de atributos](references/catalog-schema.md) y el [playbook de validación](references/catalog-validation-playbook.md). Son referencias internas vendorizadas con la skill para el runtime importado.

## Reglas

- WooCommerce live es la fuente de verdad del catálogo comercial actual. La base `product-support-knowledge` no es un catálogo paralelo y no participa como autoridad de precio, stock, publicación, URL o existencia de producto.
- Para una auditoría masiva, exige un export **completo y recién generado** de WooCommerce, registra su `fetched_at`/checksum y trátalo como snapshot de comparación, no como una segunda fuente persistente.
- Registra URL o documento, fecha y nivel de autoridad de cada fuente. Prioridad: documentación oficial verificable, web oficial, fuente secundaria; si no hay evidencia, bloquea el campo, no necesariamente el issue.
- Normaliza unidades, enumeraciones y nombres de atributo antes de comparar.
- Conserva valor anterior, candidato, evidencia, confianza y motivo.
- Marca como críticos al menos SKU, EAN/GTIN, marca, modelo, medidas, compatibilidad, precio, stock y atributos que afecten compra o feed.
- Distingue siempre producto padre, variación vendible, opción de configurador, componente independiente y venta asistida. No conviertas cada atributo informativo en variación ni generes combinaciones cartesianas sin evidencia de que cada combinación es vendible.
- Los CSV de WooCommerce pueden incluir cabeceras visualmente duplicadas. Identifica columnas por posición y conserva el encabezado original; nunca dejes que un parser sobrescriba silenciosamente una columna homónima.
- Separa el matching de identidad (`manufacturer_ref`, SKU padre, SKU variación, EAN) del matching de página/slug. Una coincidencia de nombre no basta para actualizar un producto.
- No exportes un campo crítico discrepante o sin aprobación humana.
- La exportación es un archivo local de borrador; nunca escribe en WooCommerce, Merchant Center o WordPress.
- Después de cualquier importación humana en WooCommerce, exige un segundo export completo y repite la comparativa. Cierra solo cuando no haya altas/bajas inesperadas, SKU duplicados, variaciones huérfanas, precios/stock alterados fuera del alcance ni mismatches críticos.

El informe final incluye cobertura, discrepancias, bloqueos, aprobaciones requeridas y checksum del borrador exportado. Consulta [el ejemplo](examples/comparison.md) y `fixtures/product.json`.

## Disposición del issue

- Una auditoría completa puede concluir `PASS`, `PARTIAL` o `FAIL`; cualquiera de esos veredictos termina en `done` cuando el informe solicitado y su evidencia están completos.
- Usa `blocked` únicamente si no puedes producir el informe o artefacto pedido. Una corrección de conector, dato o catálogo que otro agente pueda abordar de forma independiente se crea como issue de seguimiento separado.
- Nunca nombres a otro agente, al Board o a un usuario en un `unblockDescriptor` autenticado como agente. Para un handoff crea y asigna el issue correspondiente; bloquea el issue fuente con `blockedByIssueIds` solo si su propio entregable debe esperar.
