---
name: wordpress-publisher
description: Adaptación vendorizada para renderizar posts y simular sincronización WordPress sin credenciales ni publicación
---

# WordPress publisher — Enki v1

Esta adaptación solo permite generar HTML local y validar una petición con `--dry-run`.

```sh
python3 scripts/wordpress_publisher.py render fixtures/post.md
python3 scripts/wordpress_publisher.py sync fixtures/post.md --dry-run
```

La herramienta no acepta credenciales, no realiza red y no implementa publicación real. Una invocación `sync` sin `--dry-run` falla de forma segura. El resultado debe etiquetarse `BORRADOR — NO PUBLICADO`.

Campos de frontmatter aceptados: `title`, `slug`, `excerpt`, `status`. El único estado permitido es `draft`; cualquier otro se normaliza a `draft` en dry-run.
