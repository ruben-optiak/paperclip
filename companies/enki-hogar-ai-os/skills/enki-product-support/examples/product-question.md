# Ejemplo: compatibilidad y disponibilidad

Pregunta: «¿El lavabo Bonn sirve con el mueble Prali 05 y está disponible?»

1. Resolver el producto y sus SKU con `knowledge_resolve_product`.
2. Consultar `knowledge_check_compatibility` entre las dos referencias técnicas exactas.
3. Resolver la evidencia de la relación con `knowledge_get_evidence`.
4. Consultar el padre y las variaciones actuales con `woo_get_product_structure` para estado, opciones, precio y stock.
5. Si la relación técnica no existe, responder `UNKNOWN`. Si el SKU del crosswalk no aparece en Woo, registrar un mismatch y escalar a Ecommerce.

Salida: compatibilidad técnica con snapshot/evidencia; disponibilidad comercial con `fetched_at` de Woo; ninguna mezcla silenciosa de ambas autoridades.
