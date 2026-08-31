# Ejemplo

- Issue: `ENK-123`
- Documento: `content-draft`
- Revisión: `4`
- Revisión de Ecommerce: PASS sobre esa revisión exacta
- Canal: Instagram
- Consulta live: `instagram_list_media`, cobertura hasta `2026-08-31T10:00:00Z`
- Idempotency key: `ENK-123:content-draft:4`
- Acción solicitada: `instagram_publish_image`
- Estado: `PENDIENTE DE APROBACIÓN EN PAPERCLIP — NO PUBLICADO`

Después del éxito se registran el ID externo, URL si está disponible, fecha y
estado. Un timeout no se interpreta como fallo seguro ni autoriza un reintento.
