---
name: wordpress-publisher
description: Prepara y valida artículos WordPress localmente y, tras revisión, solicita una publicación gobernada mediante el conector sin exponer credenciales
---

# WordPress publisher — Enki

La utilidad vendorizada sigue siendo offline: genera HTML local y permite
inspeccionar un payload con `--dry-run` sin aceptar credenciales.

```sh
python3 scripts/wordpress_publisher.py render fixtures/post.md
python3 scripts/wordpress_publisher.py sync fixtures/post.md --dry-run
```

Una invocación local `sync` sin `--dry-run` falla de forma segura. Nunca sustituyas
esa barrera, leas variables de entorno ni llames directamente a WordPress.

## Flujo gobernado

1. Busca el tema en Paperclip, el `content-ledger` y `wordpress_list_posts`.
2. Guarda el borrador completo en el documento `content-draft` y fija su revisión.
3. Obtén `content-review` de Ecommerce/Brand Guardian para esa revisión exacta.
4. Renderiza localmente y compara título, slug, excerpt y HTML con lo revisado.
5. Para `future` o `publish`, congela antes hipótesis y plan en `publication-retrospective`; `draft` y `pending` no inician el reloj 7/28/90.
6. Llama `wordpress_upsert_post` con un `idempotency_key` estable
   `<issue>:content-draft:<revision>`. Esa llamada debe abrir **Ask a human
   first** en Paperclip. No cambies argumentos después de la revisión.
7. Solo tras el resultado del conector registra `external_id`, URL, estado y
   fecha en el ledger. Si el estado queda live, registra el timestamp del proveedor en la retrospectiva; si sigue como borrador, conserva todos los checkpoints sin fecha. Si el resultado queda incierto, no reintentes: entrega a
   Technology la reconciliación operator-only del journal.

El conector admite `draft`, `pending`, `future` y `publish`; todos son cambios
externos y requieren aprobación. `future` exige fecha con offset. Categorías y
tags nuevos se crean únicamente con `create_missing_terms=true` visible en la
aprobación. v0.1 no sube medios: usa un `featured_media` ya existente.

Campos de frontmatter offline aceptados: `title`, `slug`, `excerpt`, `status`.
El renderer local siempre normaliza a `draft` y etiqueta
`BORRADOR — NO PUBLICADO`; la autoridad de publicación vive exclusivamente en
Paperclip + el MCP gobernado.
