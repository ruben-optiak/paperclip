---
name: enki-product-publishing
description: Prepara paquetes de producto WooCommerce trazables, optimiza medios WebP y solicita únicamente borradores gobernados tras QA y aprobación exacta
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki product publishing

Convierte una selección pequeña de productos nuevos en borradores WooCommerce
revisables. Esta skill no convierte un catálogo o una web de fabricante en
verdad comercial y nunca publica directamente.

## Flujo obligatorio

`mandato → fuentes congeladas → identidad → evidencia → copy/SEO → WebP → QA → bundle → aprobación exacta → borrador → readback`

1. Exige una marca y dominio oficiales exactos, un catálogo fechado con SHA-256,
   un export Woo completo y reciente y un máximo inicial de cinco productos.
   Para `GRIFERIA_N_2026-SP`, el PDF es la verdad de inventario del catálogo y el
   export Woo es la foto de lo actualmente cargado. La web del fabricante solo
   enriquece o resuelve dudas concretas; una ausencia online no excluye un producto
   presente en el PDF.
2. Demuestra novedad por referencia de fabricante, SKU y, cuando exista, GTIN.
   Una coincidencia aproximada de nombre no autoriza crear ni actualizar nada.
3. Limita cualquier captura web a URLs HTTPS declaradas del dominio oficial.
   Respeta `robots.txt`, términos, rate limit y caché; no inicia sesión, no
   evade protecciones ni recorre un dominio sin límite. Conserva fecha y hash de
   cada página y activo utilizado.
4. Separa hechos del fabricante, estado comercial observado y copy derivado.
   No copies párrafos del fabricante. Cada afirmación técnica conserva una
   evidencia y una confianza; precio, stock, SKU, GTIN, medidas, material y
   compatibilidad nunca se inventan.
   Para candidatos Sanycces con tarifa oficial, aplica únicamente la política
   [sanycces-pvp-tier-2026-v1](references/sanycces-discount-policy-v1.json). Si
   el snapshot o la política cambian, detén el cálculo y solicita una revisión;
   nunca extrapoles un porcentaje distinto.
5. Aplica `enki-catalog-qa` y `enki-brand-guardian`. Un campo crítico ausente
   puede dejar el bundle `PARTIAL`, pero nunca se rellena por plausibilidad.
6. Prepara imágenes con un perfil aprobado
   [product-media-profile/v1](references/product-media-profile-v1.schema.json).
   Solo usa imágenes con derechos confirmados; no amplía píxeles, elimina
   metadatos, normaliza a WebP y conserva origen, dimensiones y SHA-256.
   Para la primera imagen de producto sobre fondo blanco aplica además la
   política versionada
   [enki-primary-product-image-policy/v1](references/product-primary-image-policy.json),
   validada por su
   [contrato](references/product-primary-image-policy-v1.schema.json). Conserva
   los píxeles y la geometría exactos: solo recorta el blanco periférico, escala
   uniformemente y centra en un lienzo blanco de 1000 × 1000. Busca una ocupación
   del 78%, WebP calidad 92, y limita la ampliación a 2× para fuente oficial o
   1,75× para fuente derivada del PDF. Si el límite impide llegar al objetivo,
   conserva el resultado menor y registra el cap; nunca inventa detalle.
   Antes de sustituir media en Woo genera candidatos y comparativas antes/después
   y exige aprobación humana exacta. Una reconstrucción generativa nunca es una
   imagen principal válida porque puede alterar geometría, componentes o acabado.
   En un producto con acabados, la galería visible sigue este orden: acabado
   principal de merchandising sobre fondo blanco; recortes de los demás acabados
   disponibles; inspiración en contexto si existe; plano recortado solo a cotas;
   muestras de acabados. Para Sanycces Pool, Metal Raw es el acabado principal y
   Níquel cepillado el segundo. Esta preferencia de galería no preselecciona una
   variación ni cambia su precio. Nunca mezcles foto de producto ni atributos en
   el recorte de cotas. Cada hija referencia siempre la imagen exacta de su
   acabado; un activo puede declarar `gallery=false` solo cuando una decisión de
   merchandising aprobada no quiera mostrarlo también en la galería padre.
   No inventes escenas ni acabados cuando el catálogo no los aporte.
7. Materializa exactamente un
   [product-draft-bundle/v1](references/product-draft-bundle-v1.schema.json).
   El canary admite de uno a cinco productos simples o variables, hasta treinta
   variaciones y ocho imágenes por producto, taxonomías existentes por ID y
   Yoast como proveedor SEO observado. Cada variación fija SKU, referencia,
   opciones, imagen, precio y evidencia; el padre conserva los atributos de
   variación exactos.
   Si la preparación local contiene más de cinco candidatos, divídela en varios
   bundles y conserva el límite en cada uno. Para Pool usa
   `build-sanycces-pool-bundles` y el preflight local del publicador: deben fijar
   por hash las taxonomías Woo, comprobar padres, hijos, slugs, checksum GTIN y
   dimensiones/metadatos WebP, rechazar colisiones SEO y recalcular por SKU el
   PVP con IVA y el descuento desde la política fijada. Deben agrupar los
   cuatro Sanybox como simples en la categoría Sanybox existente y excluir los
   kits con hero pendiente. El manifiesto de lote no amplía la aprobación: cada
   alta posterior sigue siendo un `bundleSha256 + productKey` exacto.
   El título visible usa `tipo de producto – marca – serie` y apunta a 70
   caracteres o menos, aunque Merchant admita hasta 150. La descripción larga
   contiene introducción, estilo de serie, bullets técnicos breves con utilidad,
   resumen de opciones con enlace de búsqueda y resumen de marca. La descripción
   coloca el CTA de la serie en un párrafo independiente inmediatamente después
   del resumen, para que siempre comience en una línea visual nueva. La descripción
   corta es específica del producto, sin enlaces ni boilerplate corporativo;
   conserva los datos esenciales al principio y nunca supera el límite Merchant
   de 5.000 caracteres. Procedencia y notas de revisión viven solo en evidencia.
   No propagues automáticamente material ni acabados desde la serie a un
   componente: `Inox` no demuestra `316L`, y un simple sin acabado no debe usar
   un CTA de acabados. Los beneficios de cada bullet deben nombrar el uso exacto
   del producto, no una familia genérica que incluya usos no aplicables.
   Growth debe validar intención, demanda, canibalización y mapeo Woo→Merchant;
   no declares keywords de alto tráfico sin datos fechados.
8. Guarda el bundle como artefacto revisable. La aprobación debe citar su SHA,
   producto exacto y revisión del documento. No cambies el bundle aprobado.
   Genera antes el dossier local con `prepare-canary-review.mjs`; el dossier debe
   conservar `approvalGranted=false`, cero escrituras y la identidad exacta.
9. Solicita `woocommerce_create_product_draft` para un único `productKey`. La
   herramienta debe estar en modo `woo-drafts`, usar una clave de idempotencia
   estable y abrir Ask a human first en Paperclip.
10. Tras la respuesta, ejecuta el readback por ID/SKU y compara todos los campos
    aplicados. Un outcome incierto bloquea reintentos hasta reconciliación del
    journal por un operador.

## Límites v1

- Productos padre `simple` o `variable`, siempre en estado `draft`. Las
  variaciones nuevas permanecen `private` y el padre `hidden` hasta una decisión
  de publicación posterior y separada.
- No actualiza productos existentes, no crea términos, no borra medios, no
  publica, no procesa lotes y no cambia feeds o Merchant Center.
- `manage_stock=false` y `stock_status=outofstock` en el borrador inicial.
- El precio es opcional para productos simples y vive obligatoriamente en cada
  hijo de un producto variable. PVP y precio rebajado necesitan claves de
  evidencia distintas; el precio rebajado debe ser inferior al regular.
- La herramienta comprueba por separado el SKU del padre y todos los SKU hijo,
  crea un único plan idempotente y relee padre y variaciones. Un fallo parcial
  queda `uncertain` y exige reconciliación del operador; nunca se reintenta ni
  borra automáticamente.
- La taxonomía de marca YITH no se escribe hasta disponer de un endpoint y una
  prueba específica revisados. La marca se conserva en evidencia y copy, no se
  simula mediante otra taxonomía.
- El snapshot exacto `GRIFERIA_N_2026-SP` dispone del adaptador versionado
  `sanycces-griferia-2026`: exige sus hashes, 50/50 matrices válidas, cero
  `needs_review`, el gate Pool de 28 elementos de inventario/24 candidatos de
  producto y revisión de grupos antes de preparar fichas. Las diez matrices Pool
  son páginas, no productos. Los JPEG/recortes del PDF se conservan como candidatos
  `needs_review`, sin reescalado y sin aprobación automática como galería. Cualquier
  otro catálogo Sanycces necesita fixture saneado y un adaptador nuevo; la
  semejanza de layout no basta.

Consulta el [ejemplo de canary](examples/single-product-canary.md) y el bundle
saneado de [fixture](fixtures/product-draft-bundle.json).
