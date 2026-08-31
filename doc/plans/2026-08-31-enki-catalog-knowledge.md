# Enki product and support knowledge architecture

Fecha: 2026-08-31  
Rama: `feat/enki-hogar-approach`  
Paquete: `companies/enki-hogar-ai-os/`  
Versión objetivo: `0.4.0`

## Objetivo

Dar a Ecommerce y Customer Experience contexto técnico fiable sin duplicar el catálogo comercial ni crear dos fuentes de verdad. Se conservan tres rutas independientes:

1. **WooCommerce live**: fuente única de producto vendible, padre/variaciones, URL, estado, precio y stock.
2. **Repositorio operativo `enki-hogar`**: auditorías masivas con export completo y reciente de Woo, fuentes oficiales y el flujo `fuentes → normalizado → comparativa → QA → aprobación → export`.
3. **Product Support Knowledge**: proyección pequeña y reconstruible de identidad técnica, especificaciones estables, relaciones explícitas, reglas de configuración, texto de soporte, evidencia y crosswalk de SKU.

No se cambia el esquema de Paperclip. La proyección usa PostgreSQL/pgvector y un volumen propios; Paperclip solo recibe un MCP remoto de lectura.

## Decisiones cerradas

- Un support pack cubre exactamente una combinación `marca + dominio` y fija un commit Git inmutable, checksums y aprobación humana.
- Solo existe un pack activo por `marca + dominio`; importar una nueva versión supersede la anterior atómicamente.
- La proyección rechaza precio, coste, stock, disponibilidad, estado web, métricas SEO/Merchant, PII, credenciales y rutas absolutas.
- El crosswalk distingue referencia de fabricante, SKU padre, SKU variación y tipo de mapping. No es propietario de esos SKU.
- Cada eje complejo declara `variation`, `configurator_option`, `component_product` o `assisted_sale`; no hay expansión cartesiana implícita.
- Compatibilidad solo se afirma desde relaciones estructuradas aprobadas. La búsqueda semántica nunca es autoridad de compatibilidad.
- No hay archive/delete por producto, serie o fila. Una corrección activa un pack nuevo completo; solo un pack completo `superseded` puede purgarse tras backup, preview inmutable y token de un uso.
- Woo añade una lectura acotada de padre/variaciones y filtra toda metadata salvo `_enki_original_pdf_sku`.

## Entregables

- [x] Esquema PostgreSQL/pgvector de packs, fuentes, entidades técnicas, hechos, relaciones, reglas, crosswalks, chunks, previews y auditoría.
- [x] Validador/importador transaccional del contrato `enki-product-support-pack/v1`.
- [x] Ocho herramientas MCP cerradas y read-only para resolución, ficha técnica, compatibilidad, opciones, configuración, búsqueda, evidencia y cobertura.
- [x] Rol `enki_support_reader` con transacciones read-only y sin acceso a tablas administrativas.
- [x] CLI de operador para validar/importar/listar packs, reindexar y purgar únicamente packs superseded.
- [x] Fixtures representativos Enki, Mundilite y Chicandbath sin catálogo cartesiano.
- [x] Herramienta Woo `woo_get_product_structure` para la estructura comercial live.
- [x] Skill `enki-product-support`, contratos, políticas, perfiles, Compose, matriz de secretos y runbooks alineados.
- [x] Reglas reforzadas de QA para export completo fresco, cabeceras duplicadas por posición, padre/variación y auditoría post-import.
- [ ] Importar un primer support pack real aprobado desde `../enki-hogar` en la instancia local.
- [ ] Refrescar las conexiones en Paperclip, aplicar perfiles/gateways y ejecutar smoke con agentes pausados.

## Operación inicial

1. Ejecutar el gate del paquete y construir el ZIP `v0.4.0`.
2. Mantener agentes/rutinas pausados y hacer backup de compañía y base de soporte.
3. Arrancar integraciones y comprobar los cinco health endpoints.
4. Construir un support pack de un único dominio; no importar `pdf_catalog_master.csv` ni un export Woo completo.
5. Validar e importar el pack siguiendo `runbooks/catalog-knowledge.md`.
6. Refrescar `Enki WooCommerce Read Only` (seis tools) y crear/refrescar `Enki Product Support Knowledge Read Only` (ocho tools).
7. Aplicar perfiles/gateways versionados y exigir drift cero.
8. Probar Enki (medida como variación), Mundilite (acabado/color), Chicandbath (variación/configurador/componente/venta asistida), compatibilidad conocida y relación ausente.
9. Contrastar cada ejemplo con Woo live y confirmar que la respuesta técnica no contiene precio/stock.
10. Activar Ecommerce y Customer Experience solo durante el smoke; volver a pausarlos al cerrar.

## Verificación requerida

- Tests unitarios de ambos conectores.
- Integración real contra PostgreSQL: activación/supersede, lectura mínima, búsqueda lexical/híbrida y purga de pack superseded.
- Validación de los tres fixtures y rechazo de columnas comerciales/rutas/PII/credenciales.
- Catálogo MCP exacto y ausencia de herramientas administrativas.
- Gate completo del paquete, escaneo de secretos y build reproducible del ZIP.

## Rollback

Deshabilitar las conexiones, pausar agentes/rutinas, importar el ZIP anterior y restaurar perfiles anteriores. Restaurar el `pg_dump` compatible o reconstruir la proyección desde los packs aprobados fijados por commit. No usar `docker compose down -v` como procedimiento normal.
