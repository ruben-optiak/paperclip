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

## Publicación

- Facebook v0.1: un post de texto y enlace opcional mediante
  `facebook_publish_page_post`.
- Instagram v0.1: una imagen JPEG disponible en URL HTTPS pública, caption y alt
  text mediante `instagram_publish_image`.
- Usa `idempotency_key=<issue>:content-draft:<revision>` y conserva exactamente
  los argumentos revisados. La llamada debe quedar **Ask a human first** en la
  UI; Director y agentes no pueden aprobarla.
- Tras éxito, actualiza el ledger desde la respuesta real. Si el conector marca
  resultado incierto, no repitas la llamada: Technology y el operador deben
  reconciliar el journal contra la plataforma live.

No hay publicación masiva, carruseles, vídeos/Reels, Stories, comentarios,
mensajes directos, borrado, edición social ni gestión de cuentas en v0.1. No
transformes una limitación de formato en autorización para usar otra API.

Consulta el [ejemplo de handoff](examples/publication.md) y el
[fixture](fixtures/social-post.json).
