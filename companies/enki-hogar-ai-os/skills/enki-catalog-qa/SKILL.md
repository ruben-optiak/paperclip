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

- Registra URL o documento, fecha y nivel de autoridad de cada fuente. Prioridad: documentación oficial verificable, web oficial, fuente secundaria; si no hay evidencia, bloquea el campo.
- Normaliza unidades, enumeraciones y nombres de atributo antes de comparar.
- Conserva valor anterior, candidato, evidencia, confianza y motivo.
- Marca como críticos al menos SKU, EAN/GTIN, marca, modelo, medidas, compatibilidad, precio, stock y atributos que afecten compra o feed.
- No exportes un campo crítico discrepante o sin aprobación humana.
- La exportación es un archivo local de borrador; nunca escribe en WooCommerce, Merchant Center o WordPress.

El informe final incluye cobertura, discrepancias, bloqueos, aprobaciones requeridas y checksum del borrador exportado. Consulta [el ejemplo](examples/comparison.md) y `fixtures/product.json`.
