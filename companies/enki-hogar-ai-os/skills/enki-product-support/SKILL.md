---
name: enki-product-support
description: Resuelve identidad, especificaciones, compatibilidad y configuración técnica sin duplicar precio, stock ni la estructura comercial viva de WooCommerce
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki product support

Usa esta skill para preguntas técnicas de producto, preventa y soporte. La proyección es deliberadamente pequeña y reconstruible: contiene hechos técnicos estables aprobados, relaciones explícitas, reglas de configuración, texto de soporte y un crosswalk hacia SKU de WooCommerce. No es una réplica del catálogo comercial.

Los resultados siguen el [contrato versionado](references/product-support-result-v1.schema.json).

## Orden de consulta

1. Fija la fecha actual en `Europe/Madrid` y separa la pregunta técnica de la comercial.
2. Para precio, stock, estado, opciones actualmente vendibles o estructura padre/variaciones, consulta primero `woo_get_product_structure` (o `woo_get_product` para una ficha simple). WooCommerce es la única autoridad viva para esos datos.
3. Resuelve el SKU Woo o la referencia de fabricante con `knowledge_resolve_product`. Usa exactamente uno de `woo_sku`, `manufacturer_ref` o `query`.
4. Consulta `knowledge_get_technical_profile` para hechos estables y `knowledge_list_allowed_options` o `knowledge_get_configuration_model` para entender cómo debe modelarse una familia compleja.
5. Para compatibilidad usa exclusivamente `knowledge_check_compatibility`. Si devuelve `unknown`, responde `UNKNOWN`: una coincidencia semántica o pertenecer a la misma serie nunca demuestra compatibilidad.
6. Usa `knowledge_search_support` para instalación, mantenimiento, garantía y FAQ. La búsqueda semántica orienta, pero no autoriza compatibilidades.
7. En afirmaciones sensibles de compra, instalación o compatibilidad, resuelve `evidence_ref` con `knowledge_get_evidence` y conserva fuente, snapshot y página.
8. Si Woo y el crosswalk no coinciden, no elijas uno silenciosamente: registra el mismatch y pásalo a Ecommerce & Catalogue.

## Fuentes de verdad

- WooCommerce live: SKU vendible, padre/variaciones, atributos comerciales actuales, precio, stock, estado y URL.
- Support pack activo y aprobado: identidad técnica, referencia de fabricante, especificaciones estables, compatibilidades explícitas, reglas y contenido de soporte.
- Export completo y reciente de Woo + pipeline `fuentes → normalizado → comparativa → QA → aprobación → export`: auditorías masivas y propuestas de importación. Ese trabajo se realiza en el repositorio operativo `enki-hogar`, no en esta proyección.

## Límites

- No afirmes que la cobertura técnica representa todo WooCommerce. `knowledge_coverage` solo mide los packs cargados.
- No guardes ni deduzcas precio, PVP, coste, stock, disponibilidad, estado web, métricas SEO/Merchant ni datos de clientes en un support pack.
- No generes el producto cartesiano de atributos. Cada eje debe declarar `variation`, `configurator_option`, `component_product` o `assisted_sale`.
- No ejecutes importaciones, reindexados ni purgas: son operaciones locales del operador. Solo puede purgarse un pack completo ya superseded.
- No publiques ni cambies WooCommerce, WordPress, feeds, stock, precios o pedidos.

Entrega hechos confirmados, evidencia, fecha de cada fuente, datos comerciales live observados por separado, limitaciones y el handoff necesario. Una respuesta completa con datos parciales, desconocidos o contradictorios termina en `done` con veredicto `PARTIAL` o `FAIL`; reserva `blocked` para cuando no pueda producirse el entregable solicitado. Cualquier reparación independiente se abre como issue separado para su propietario, nunca como `unblockDescriptor` dirigido a otro agente. Consulta [el ejemplo](examples/product-question.md) y `fixtures/technical-profile.json`.
