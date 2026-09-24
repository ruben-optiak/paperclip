---
name: enki-social-publisher
description: Prepara, compara y publica contenido gobernado en Facebook Page e Instagram profesional tras revisión y aprobación humana por argumentos exactos
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki social publisher

Úsala para convertir un borrador editorial revisado en una publicación de la
Facebook Page o de la cuenta profesional de Instagram de Enki. Nunca uses
credenciales, Graph API directa, navegador automatizado ni herramientas fuera
del conector gobernado.

## Antes de proponer

1. Fija el instante actual y `Europe/Madrid`.
2. Busca tema, campaña y producto en Paperclip y lee la última revisión de
   `content-ledger`.
3. Consulta `facebook_list_page_posts` o `instagram_list_media`; para Instagram
   consulta además `instagram_get_publishing_limit`.
4. Contrasta oferta, precio y stock con WooCommerce live y hechos técnicos con
   el pack aprobado. No inventes tendencias ni disponibilidad.
5. Guarda el copy completo y los assets/URLs en `content-draft`; obtén
   `content-review` para esa revisión exacta antes de solicitar publicación.
   Prioriza fotos de producto real en ambiente de calidad, con el modelo y
   acabado verificables. No introduzcas menciones a IA ni la expresión
   «imagen orientativa»; cualquier cautela comercial debe ser la frase
   expresamente aprobada por el operador.
6. Congela hipótesis, baseline, limitaciones y checkpoints en `publication-retrospective`; el reloj empieza únicamente con el timestamp live del proveedor.

## Productos etiquetados

- Si una publicación visual se centra en un producto real, prepara el vínculo a su ficha exacta del catálogo. Comprueba en WooCommerce y en el catálogo la identidad, variante/acabado, imagen, URL, precio y disponibilidad; nunca sustituyas por un producto o acabado parecido.
- Registra en `content-draft` y `content-review` el producto y variante Woo, el ID de catálogo Meta si existe, la URL de la ficha y la imagen o slide donde irá la etiqueta. La aprobación humana debe cubrir ese mapeo exacto.
- Etiqueta el producto al publicar solo si el canal y el conector gobernado exponen esa capacidad y verifica el resultado live. Si la API no admite etiquetas o falla, no uses Graph directa ni declares el post etiquetado: deja en Paperclip la URL del post y el producto como `pendiente_etiqueta_manual`, pide al operador completarlo y verifica desde otra cuenta. Si la etiqueta es esencial para la campaña, solicita aprobación específica antes de publicar sin ella.

## Publicación

- Facebook v0.1: un post de texto y enlace opcional mediante
  `facebook_publish_page_post`.
- Instagram v0.1: una imagen JPEG disponible en URL HTTPS pública, caption y alt
  text mediante `instagram_publish_image`.
- Facebook multi-foto: 2–10 fotos HTTPS públicas, en orden revisado, mediante
  `facebook_publish_multi_photo`. Es una publicación orgánica de varias fotos,
  no un anuncio de carrusel ni etiquetas de catálogo.
- Instagram carrusel: 2–10 JPEG HTTPS públicos, con alt text de cada slide,
  mediante `instagram_publish_carousel`. Verifica el recorte y la composición
  de cada imagen antes de pedir aprobación; el conector no los corrige.
- Usa `idempotency_key=<issue>:content-draft:<revision>` y conserva exactamente
  los argumentos revisados. La llamada debe quedar **Ask a human first** en la
  UI; Director y agentes no pueden aprobarla.
- Tras éxito, actualiza el ledger y la retrospectiva desde la respuesta real. Si el conector marca
  resultado incierto, no repitas la llamada: Technology y el operador deben
  reconciliar el journal contra la plataforma live.

No hay publicación masiva, vídeos/Reels, Stories, comentarios,
mensajes directos, borrado, edición social ni gestión de cuentas en v0.1. No
transformes una limitación de formato en autorización para usar otra API.

Consulta el [ejemplo de handoff](examples/publication.md) y el
[fixture](fixtures/social-post.json).
