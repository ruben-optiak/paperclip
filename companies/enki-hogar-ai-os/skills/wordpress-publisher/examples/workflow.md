1. Revisar evidencia y políticas.
2. Crear Markdown con título, slug y excerpt.
3. Ejecutar `render` y revisar el HTML local.
4. Ejecutar `sync --dry-run` para inspeccionar el payload redactado.
5. Adjuntar el borrador al issue y obtener una revisión de Ecommerce para esa revisión exacta.
6. Llamar `wordpress_upsert_post` con idempotency key `ENK-123:content-draft:4`.
7. Aprobar o rechazar la acción en la UI. Nunca entregar credenciales al agente.
8. Tras éxito, registrar ID, URL, estado y fecha live en `content-ledger`.
