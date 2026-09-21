# Canary de un producto simple

1. Board fija una marca, un catálogo, un export Woo completo, hasta cinco
   referencias y las URLs oficiales permitidas.
2. Ecommerce demuestra que el SKU y la referencia no existen en el snapshot.
3. El operador prepara cada imagen con el perfil aprobado y adjunta el manifest
   con SHA-256, dimensiones, origen y derechos.
4. Ecommerce redacta contenido original y SEO, enlaza evidencia por campo y
   obtiene PASS/WARN de Brand Guardian y PASS/PARTIAL de Catalogue QA.
5. El bundle validado se adjunta al issue. Board aprueba exactamente un
   `bundleSha256 + productKey + documentRevision`.
6. El conector, aún en modo `woo-drafts`, sube los WebP, crea un producto simple
   `draft` y devuelve ID, SKU, slug, media IDs y estado.
7. Ecommerce hace readback. Si hay divergencia o resultado incierto, no reintenta
   y crea seguimiento para reconciliación del journal.

El canary no publica, no crea categorías/atributos/marcas y no modifica un
producto ya existente.
