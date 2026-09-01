# Setup versionado de Enki Hogar AI OS

Fecha: 2026-08-29
Rama: `feat/enki-hogar-approach`
Paquete: `companies/enki-hogar-ai-os/`
Versión inicial: `0.1.0`
Versión actual: `0.12.0`

> Este documento conserva la implementación y sus evidencias históricas. El estado actual, las prioridades y el siguiente trabajo se mantienen en el [backlog vivo de Enki Hogar AI OS](2026-08-31-enki-hogar-ai-os-backlog.md).

## Objetivo

Entregar una definición reproducible `agentcompanies/v1` para operar Enki Hogar desde Paperclip con seis agentes, fuentes gobernadas y autonomía por defecto limitada a lectura, análisis y borradores. v0.12.0 conserva el workflow editorial, el aprendizaje gobernado, el runtime PDF aislado, los contratos trazables, el oracle y los adaptadores multimarca, y añade reconciliación Woo posicional, change sets locales idempotentes y auditoría completa del export posterior. Las importaciones se hacen con agentes, heartbeats y rutinas pausados.

No se cambia la UI, el contrato de API, el esquema de base de datos ni las migraciones. Como excepciones de seguridad al alcance inicial, se endurece internamente el importador para asignar un `CODEX_HOME` gestionado y único por agente importado, se conserva la carga de proveedores Codex en ese home y el adaptador entrega los MCP gestionados con cabeceras HTTP válidas y delegación explícita de aprobación al gateway de Paperclip. El paquete portable no puede calcular esos paths porque los UUID se generan al importar.

## Estado de implementación

- [x] Paquete portable con `COMPANY.md`, `README.md`, `.paperclip.yaml`, licencias y procedencia.
- [x] Seis agentes `codex_local`, una única raíz y contratos explícitos de ejecución, fuentes, handoffs y bloqueo.
- [x] Doce skills versionadas, incluidas `enki-brand-guardian`, `enki-product-support`, `enki-social-publisher`, `enki-editorial-planning` y `enki-editorial-learning`, con ejemplos y fixtures offline.
- [x] Cuatro proyectos, once tareas iniciales y dos rutinas con triggers deshabilitados.
- [x] Snapshot curado mediante allowlist, inventario con hashes y sincronización con escaneo de secretos.
- [x] MCP WooCommerce autenticado, estrictamente GET y con seis herramientas sin pedidos individuales ni PII; incluye estructura live padre/variaciones con metadata allowlisted.
- [x] Runtimes fijados para Google Ads, GA4 y GSC, protegidos con bearer y catálogos de lectura.
- [x] Contrato común `enki-evidence-envelope/v1` y definiciones canónicas de métricas, moneda, IVA, devoluciones, ROAS, CAC y margen desconocido.
- [x] Compose adicional, `.env.example`, matriz de secretos y endpoints de salud no sensibles.
- [x] Plugin Telegram versionado: allowlist de usuario/chat, atribución humana, issues/comentarios auditados, reportes filtrados y avisos de aprobación sin capacidad de decisión.
- [x] Preflight seguro del gateway para demostrar lectura permitida, escritura denegada y auditoría antes de conectar Enki.
- [x] Desired state y detector GET-only de drift para conexiones, catálogos, perfiles, políticas, gateways por agente, runtimes, homes, presupuestos y rutinas.
- [x] Aislamiento por workspace y home gestionado; filesystem read-only con Landlock, proceso Codex no interactivo y sin secretos de conectores en agentes. Codex autoriza el despacho MCP, pero Paperclip conserva la decisión allow/deny/approval.
- [x] Lock de compatibilidad con commit base de Paperclip y digests OCI de las imágenes base de conectores.
- [x] Runtime de preparación PDF `0.1.0`: Python 3.12, dependencias permisivas fijadas, raster a 300 dpi, inventario geométrico portable, input read-only, output externo, red deshabilitada y cero overwrite.
- [x] Contratos estrictos `enki-catalog-run/v1`, `enki-catalog-field-evidence/v1` y `enki-catalog-change-set/v1`, validador cruzado portable, bundle saneado, casos negativos y migración conservadora desde los CSV históricos.
- [x] Regresión `enki-catalog-regression-suite/v1` con seis fixtures saneados de cuatro marcas, siete riesgos de layout, oracle geométrico, cabeceras Woo duplicadas por posición y proyección a evidencia de campo v1.
- [x] Registro `enki-catalog-adapter-registry/v1` y cuatro adaptadores `enki-catalog-adapter/v1`: hashes exactos, alcance por marca/snapshot/página, core multimarca, estrategia Chicandbath local y métricas 21/21, cobertura 1 y error 0.
- [x] Reconciliación Woo `v1`: CSV por posición exacta, cabeceras duplicadas estables, identidad padre/variación, ownership de página, fiscalidad explícita, diferencias locales idempotentes y auditoría post-import sin generador de imports.
- [x] Separación de licencia MIT para código/configuración y `LicenseRef-Enki-Hogar-Internal` para conocimiento de Enki.
- [x] Artefacto ZIP determinista, allowlist de importación y workflow CI limitado a los paths de Enki y del hardening del importador.
- [x] Gate automatizado de v0.5.0: paquete 44/44, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 16/16, plugin Telegram 13/13, diez skills válidas, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.5.1: paquete 48/48, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19, plugin Telegram 13/13, 126 pruebas del servicio de herramientas, typecheck TypeScript directo del servidor, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.6.0: paquete 58/58, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19, plugin Telegram 13/13, nueva skill validada oficialmente, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.7.0: paquete 73/73, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19, plugin Telegram 13/13, contratos Ajv estrictos, nueva skill validada oficialmente, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.8.0: runtime de catálogo 8/8 más paquete 73/73, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19 y plugin Telegram 13/13; smoke Docker repetible sin paths del host, secretos, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.9.0: paquete 99/99 —incluidas 26 comprobaciones de contratos de catálogo—, runtime de catálogo 8/8, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19 y plugin Telegram 13/13; schemas Ajv estrictos, secretos, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.10.0: paquete 116/116 —incluidas 26 comprobaciones de contratos y 17 de regresión multimarca—, runtime de catálogo 8/8, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19 y plugin Telegram 13/13; secrets scan, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.11.0: paquete 121/121 —incluidas 5 comprobaciones estructurales de adaptadores—, runtime de catálogo 25/25, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19 y plugin Telegram 13/13; adapter replay 21/21, secrets scan, ZIP reproducible y Compose combinado.
- [x] Gate automatizado de v0.12.0: paquete 127/127 —incluidas 6 comprobaciones de reconciliación—, runtime de catálogo 38/38, MCP WooCommerce 25/25, Product Support 19/19, Content Publisher 19/19 y plugin Telegram 13/13; replay histórico sanitizado, secrets scan, ZIP reproducible y Compose combinado.
- [x] Backup de la compañía local existente completado antes de las pruebas de activación.
- [ ] Preflight del gateway en una compañía desechable con una sesión Board real.
- [x] Importación local de v0.2.0 completada y topología verificada: 6 agentes, 8 skills, 4 proyectos, 9 tareas y 2 rutinas.
- [x] Parche v0.2.1 aplicado sobre la compañía existente: se reemplazaron de forma selectiva los 6 agentes y 8 skills, se creó el anchor task ENK-21 y se conservaron proyectos, rutinas, UUID, presupuestos y estado pausado sin duplicar las tareas históricas del smoke.
- [x] v0.3.0 implementó el primer prototipo de memoria de catálogos; v0.4.0 lo sustituye para evitar una segunda fuente de verdad.
- [x] v0.4.0 separa Woo live, auditoría masiva en `enki-hogar` y una proyección técnica reconstruible. Expone ocho tools read-only, packs inmutables por marca/dominio y purga solo de una versión completa superseded.
- [x] Pack técnico Enki Espejos 1.0.0 aprobado con revisión `a767ce916cc9c4582c6bb982300d3a990ae909422e48bcb66336ad99814fde93`, cargado como pack activo y validado mediante consultas reales sin precio ni stock duplicados.
- [x] Parche v0.4.1 importado selectivamente sobre la compañía existente: 6 agentes y 9 skills actualizados sin duplicar proyectos, tareas ni rutinas; UUID, límites mensuales, organigrama y estado pausado conservados.
- [x] v0.5.0 implementa un MCP gobernado para WordPress, Facebook e Instagram: seis lecturas, tres escrituras ask-first, kill switch `disabled` por defecto, journal persistente de idempotencia y credenciales aisladas del agente.
- [x] v0.5.0 importado selectivamente sobre la compañía existente: 6 agentes actualizados, 9 skills reemplazadas y `enki-social-publisher` creada, sin tocar proyectos, tareas ni rutinas; UUID, límites y estado pausado conservados.
- [x] Content Publisher desplegado en Quickstart, bearer cifrado en Paperclip, catálogo exacto de 9 herramientas, perfiles mínimos, aprobación Board para las 3 escrituras, cuarentena futura y drift cero. La llamada live de capacidades confirmó `write_mode=disabled` y WordPress/Facebook/Instagram aún sin configurar.
- [x] ENK-22 restaurado a `done` con recuperación resuelta. ENK-23 validó en un único run la expansión de un SKU de variación hasta su padre Woo y cerró un informe `PARTIAL` como `done`, sin recuperación ni continuación correctiva.
- [x] Configuración local de las cinco conexiones read-only previas, seis perfiles, política global, seis gateways gobernados y límites mensuales positivos; conexiones y gateways se activaron tras superar su smoke, con agentes y rutinas pausados.
- [x] Named-gateway smoke con sesión Board real: dos catálogos exactos, tres lecturas Google reales, una denegación default y restauración completa del estado pausado.
- [x] Smoke test con cuentas reales y activación individual: los cinco especialistas y el Director han superado el perímetro read-only/zero-PII; los informes del Director son operativamente `PARTIAL` porque declaran fuentes y decisiones todavía ausentes.
- [x] Ejecución manual de Daily Brief y Weekly Review con un único run cada una, disposición terminal y restauración posterior del Director a `paused`.
- [ ] Instalación/configuración del plugin Telegram en la instancia local y smoke con bot/IDs reales; el código y el mount están listos, pero la instancia todavía no tiene plugins instalados.
- [ ] Activación de horarios — requiere decisión explícita de Board; el desired state de v0.12.0 mantiene ambas rutinas pausadas y sus triggers deshabilitados.

El preview anterior de cinco agentes y siete skills queda superado por el hardening de v0.1.0 y no cuenta como evidencia de la versión actual.

## Evidencia local de integración — 2026-08-30

- Los tres MCP de Google pasan salud y `tools/list` stateless. El catálogo objetivo de v0.1.2 es Ads 3 herramientas, GA4 6 y GSC 4; `list_google_ads_links` queda retirado por exponer `creator_email_address`.
- ADC, OAuth de GSC y Google Ads ejecutan lecturas reales mínimas sin imprimir resultados sensibles.
- Paperclip mantiene las cuatro conexiones activas y saludables, sin installs directos; los agentes y las rutinas siguen siendo el interruptor operativo.
- Los seis perfiles default-deny coinciden con el desired state. El smoke administrativo pasó 18 matrices agente/conexión, tres lecturas reales y una denegación `deny_default`.
- Agentes y rutinas permanecen pausados; los seis gateways están activos, vinculados uno a uno a sus perfiles, y no hay ningún token `gateway_client` persistente.
- La auditoría de desired state está limpia: cuatro conexiones, seis perfiles, una política global, seis gateways y dos rutinas coinciden con el contrato versionado.
- El named-gateway smoke pasa por las rutas MCP reales: catálogos exactos, lecturas Google, una decisión `deny_default` en el preflight y revocación de tokens temporales.

Las incompatibilidades del core detectadas durante los smokes quedan corregidas. `actorMiddleware` excluye únicamente `GET` y `POST` sobre las dos rutas exactas del protocolo MCP (`/mcp/gateways/:gatewayPublicId` y `/api/tool-gateway/gateways/:gatewayId/mcp`) y deja al named gateway como única autoridad para validar sus bearer. El adaptador Codex usa `http_headers` y `default_tools_approval_mode = "approve"` en los bloques MCP gestionados: Codex permite el despacho no interactivo, mientras Paperclip conserva la decisión de autorización. Ninguna excepción asigna identidad Board/agent ni evita perfiles, políticas o auditoría del gateway.

### Piloto Technology — PASS (2026-08-30)

- ENK-9 terminó vinculado al issue y con una sesión fresca; el informe final no contiene secretos, PII, URLs privadas ni rutas absolutas.
- Las escrituras en workspace, scratch y definición empaquetada fueron denegadas y no dejaron fixtures. El workspace hermano quedó `NOT TESTED` porque no existía una referencia explícita y no se enumeraron rutas.
- El catálogo gobernado expuso exactamente las cinco capacidades de Technology y excluyó mutaciones y `run_report`.
- Las lecturas mínimas de Google Ads, GA4 y GSC finalizaron correctamente a través del named gateway.
- La auditoría del intervalo final registró tres pares `profile_allows_tool`/`tool_completed`, discovery filtrado y únicamente el diagnóstico informativo conocido `permitted_connections_not_installed`.
- Tras el PASS se pausó Technology: los 6 agentes y las 2 rutinas quedan pausados; las 4 conexiones están sanas y los 6 gateways permanecen activos para los siguientes smokes controlados.

### Pilotos de especialistas — 5/6 PASS (2026-08-30)

- ENK-10 (Growth) y ENK-11 (Finance & BI) terminaron `done` y sus agentes se devolvieron a estado pausado.
- ENK-12 (Ecommerce & Catalogue) terminó `done` tras optimizar `woo_low_stock`: campos acotados, paginación estable por ID con concurrencia máxima de seis, deduplicación y cobertura explícita. La lectura real completó 7/7 páginas dentro del límite remoto de 10 segundos, con 605/605 productos únicos y cero duplicados.
- La recuperación automática que se abrió al pausar Ecommerce quedó resuelta como restaurada sin reactivar al agente.
- ENK-13 (Customer Experience) terminó `done` con el criterio correcto de v0.1.x: la consulta de pedidos y la PII están ausentes y denegadas por defecto; no se crea una aprobación para una capacidad inexistente.
- El estado de cierre conserva los seis agentes, sus heartbeats y las dos rutinas pausados. El siguiente piloto es el Director.

### Parche 0.1.1

- Versiona las correcciones demostradas por ENK-12 y ENK-13 sin ampliar autonomía ni catálogos.
- Eleva el MCP WooCommerce a `0.1.1`; los runtimes Google permanecen en `0.1.0` porque no cambió su código.
- Mantiene pendientes el tag, los digests de imágenes finales y el SHA-256 de promoción hasta construir el artefacto de release.

### Parche 0.1.2 y pilotos del Director — PASS de seguridad (2026-08-30)

- El primer intento de ENK-14 detectó que `list_google_ads_links`, perteneciente al MCP de GA4, devolvía `creator_email_address`. El valor no se publicó, la rama se detuvo y el Director se pausó.
- v0.1.2 deshabilita la herramienta en el proxy, la elimina del catálogo deseado y de los perfiles Director/Growth, y añade gates estáticos y de runtime. El runtime Google sube a `0.1.1`.
- Tras reconstruir solo el conector Google, `tools/list` devolvió Ads 3, GA4 6 y GSC 4. La entrada histórica que Paperclip conservaba activa se retiró de los perfiles y se dejó `quarantined`; el detector de drift volvió a cero.
- La repetición fresca de ENK-14 terminó `succeeded` con un único brief y sin continuación. No invocó la herramienta retirada, no publicó PII, secretos o identificadores privados y sus agregados coinciden con las respuestas MCP. El smoke de seguridad es PASS; el brief es `PARTIAL` por Ads ambiguo, COGS ausente y la discrepancia WooCommerce–GA4.
- ENK-15 ejecutó manualmente la Weekly Review sin nuevas lecturas de negocio: usó el estado de Paperclip y ENK-14 como evidencia histórica, produjo prioridades y handoffs con owner, terminó `succeeded` y no creó tareas ni mutaciones. Su resultado operativo también es `PARTIAL` por backlog, fuentes y decisiones pendientes.
- Un comentario humano sobre un issue `done` se interpreta como seguimiento y lo reabre a `todo`; con el assignee pausado, recovery puede escalarlo a `blocked`. La verificación se registra antes del cierre o se restaura `done` sin otro comentario. ENK-14 y ENK-15 quedaron `done`, los seis agentes y las dos rutinas `paused`, los triggers deshabilitados y cero runs vivos.

### Versión 0.2.0 — canal Telegram gobernado (2026-08-30)

- Se añade `enki-hogar.telegram-gateway` como plugin nativo de Paperclip, montado de solo lectura en Docker y configurado por compañía.
- Un mensaje allowlisted crea un issue asignado al Director; una respuesta añade un comentario atribuido al usuario humano activo. El plugin nunca ejecuta directamente tools, shell, MCP ni mutaciones de negocio.
- El manifest no declara `approvals.respond`, `issue.interactions.respond`, `agents.invoke`, `agents.resume` ni `issues.update`. Las aprobaciones solo generan una notificación con enlace y se deciden en la UI.
- El token de BotFather usa `secret-ref` y se resuelve en cada llamada. No existe variable Telegram en `.env`, Compose ni entornos de agentes.
- La entrada y la salida aplican deduplicación, rate limit, destino exacto y bloqueo de contenido con aspecto de PII, pedido o credencial. Los errores enviados son genéricos y no contienen respuestas remotas.
- Trece pruebas del plugin cubren capacidades, secret-ref, allowlist, identidad humana writable, raíz Director, deduplicación, atribución, apagado durante long poll, denegación de aprobaciones y filtrado sensible.

### Parche 0.2.1 — skills sandbox-readable y memoria editorial (2026-08-30)

- En ejecuciones locales, el adaptador materializa copias verificadas de las skills dentro del `HOME` temporal y exclusivo del heartbeat (`.agents/skills`). `CODEX_HOME` conserva autenticación, sesiones y configuración MCP fuera de las raíces legibles por Landlock; el scratch completo se elimina al terminar el run. En runtimes remotos, las copias siguen viajando dentro del `CODEX_HOME` curado que se stagea al sandbox.
- El Director secuencia los handoffs editoriales: Growth entrega primero `content-draft` con revisión durable y Ecommerce recibe después esa revisión exacta. Entrada ausente es `BLOCKED / NOT REVIEWED`, nunca PASS con cero claims.
- Se añade el contrato `enki-content-ledger/v1`, un anchor task y un runbook que separan memoria versionada, historia operativa de Paperclip y verdad live de WordPress/Meta/analítica.
- El ledger y la búsqueda empresarial no inventan cobertura: plataformas sin conector quedan `partial/unavailable`; tendencias recientes necesitan una fuente actual aprobada.
- El smoke live de ENK-21 materializó las cinco skills asignadas y la skill Paperclip bajo el `HOME` efímero del run; Growth leyó `paperclip/SKILL.md` y `enki-seo-sem/SKILL.md` sin denegaciones mientras `CODEX_HOME` permaneció separado. El scratch se eliminó al terminar.
- ENK-21 terminó `done` con `content-ledger` revisión 1 validada contra `enki-content-ledger/v1`: tres borradores recuperados de ENK-17 y cobertura `PARTIAL` porque WordPress, Instagram y Facebook aún no están conectados en lectura. No hubo publicación ni mutación externa.
- La credencial gateway temporal de la prueba anterior quedó revocada explícitamente; Growth volvió a `paused` y los otros cinco agentes permanecieron pausados.

### Parche 0.4.1 — variaciones, disposición terminal y redacción (2026-08-31)

- `woo_get_product_structure` distingue una coincidencia exacta de producto o variación. Para una variación consulta y valida su `parent_id`, carga el padre variable, conserva la variación solicitada aunque la paginación quede truncada y devuelve evidencia explícita en `resolution`.
- Los contratos globales de ejecución, Ecommerce y las skills de catálogo/soporte separan resultado del informe y estado de la tarea: un audit completo puede terminar `done` con resultado `PASS`, `PARTIAL` o `FAIL`; `blocked` se reserva para un entregable que realmente no puede producirse.
- Un agente solo puede crear un `unblockDescriptor` que lo nombre a sí mismo. La remediación de otro owner se representa como follow-up independiente y no bloquea el audit salvo dependencia real.
- La redacción de eventos sanitiza también strings anidados en payloads estructurados y mensajes de heartbeat. El prompt base prohíbe imprimir o interpolar secretos de entorno y la regresión cubre JWTs multilínea dentro de `output`/`content`.
- El endpoint `/health` de Woo obtiene su versión directamente de `package.json`, evitando drift entre imagen y manifest.
- El kill switch `routines disable-all --api-base ...` funciona contra Quickstart con la sesión Board almacenada, pausa rutinas y deshabilita triggers; el modo local sin API sigue disponible para instalaciones con `config.json`.
- El preview completo de v0.4.1 detectó que los once bootstrap issues se planificaban como nuevos. Se canceló esa ruta y se aplicó `--include agents,skills`: no se duplicó historia operativa.
- ENK-23 terminó `done` en un único run `succeeded`: resolvió `ENKI-ESP-060301BM` como variación `39725`, padre variable `39698`, cobertura 2/2 y crosswalk técnico exacto. El resultado fue `PARTIAL` únicamente por moneda y cantidad de stock no declaradas.
- Estado final: seis agentes pausados, dos rutinas pausadas, dos triggers deshabilitados, cero runs vivos en ENK-23 y los cinco conectores sanos.

### Versión 0.5.0 — publicación gobernada (2026-08-31)

- Se reutiliza la experiencia real de `../enki-hogar` para WordPress, pero la credencial ya no vive en una skill ni en el agente: un MCP aislado usa REST API + Application Password y conserva el helper vendorizado únicamente para render/dry-run offline.
- El conector expone exactamente seis lecturas y tres escrituras: upsert de un post WordPress, publicación de un post de Página Facebook y publicación de una imagen JPEG de Instagram. No existen delete, media upload, páginas/plugins, comentarios, DMs, carruseles, vídeos, Reels, Stories ni bulk publish.
- Toda escritura exige el handoff `content-draft` → `content-review`, una clave estable `<issue>:<documento>:<revisión>`, aprobación exacta de Board en Paperclip y un segundo gate `CONTENT_PUBLISH_WRITE_MODE`. El modo inicial es `disabled`; `wordpress-drafts` es el primer canary acotado.
- El journal persiste un hash del payload antes de llamar al proveedor, reproduce éxitos sin duplicar y bloquea reintentos de resultado incierto hasta reconciliación manual contra la plataforma live.
- WordPress y Meta siguen siendo la verdad de publicación; el content ledger es memoria derivada y nunca suplanta el estado live.
- El import selectivo v0.5.0 conservó toda la historia operativa. El reconciliador versionado creó la conexión desde estado deshabilitado, validó primero el catálogo, aplicó después perfiles/política y terminó con drift cero. Una simulación independiente confirmó `require_approval` en las tres escrituras sin llamar a ningún proveedor.

### Versión 0.5.1 — hardening operativo (2026-08-31)

- Paperclip recibe un `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` generado localmente e independiente de auth, JWT y todos los bearers MCP; el valor nunca se imprime ni se guarda en Git.
- Las ejecuciones procedentes de una aprobación ask-first en la pestaña de Test usan el mismo timeout explícito de 60 segundos que las ejecuciones aprobadas de agentes.
- El operador dispone de un helper atómico e idempotente para devolver inmediatamente `CONTENT_PUBLISH_WRITE_MODE` a `disabled` tras cada canary.
- El gate completo de v0.5.1 y las 126 pruebas del servicio de herramientas pasan; el `tsc --noEmit` directo del servidor también pasa. El wrapper global sigue necesitando `cargo` para compilar el runner Rust, limitación del host ya documentada y ajena a este diff.
- La instancia conserva v0.5.0 como último import selectivo; v0.5.1 es el paquete fuente de hardening y requiere preview antes de cualquier import futuro.

### Versión 0.6.0 — workflow editorial v2 (2026-09-01)

- `enki-editorial-planning` obliga a completar `research → shortlist → candidate validation → Board decision → draft → review → publish` sin lanzar etapas dependientes en paralelo.
- `enki-editorial-brief/v2` separa categoría, landing, artículo y producto, conserva identidades WordPress/Woo/SKU explícitas, periodos, frescura, cobertura, pesos, riesgos y unknowns.
- Growth y Ecommerce comparten el mismo conjunto mediante fingerprint SHA-256; la validación no puede añadir ni omitir candidatos y los scores se recalculan en vez de confiar en el total escrito.
- La decisión Board apunta a la revisión validada y solo completa el gate cuando una revisión posterior del brief aplica su estado, condiciones y siguiente acción. No concede autoridad de publicación.
- El fixture saneado de `ENK-24` reproduce 3,75/3,60/2,60, conserva C1 solo como investigación y evita incluir UUID de base de datos o tratar el fixture como evidencia live.
- Pasan 58 pruebas del paquete, 63 pruebas de conectores y 13 del plugin Telegram, además del validador oficial de skills, secretos, ZIP reproducible y Compose. La instancia sigue sin importar v0.6.0 y no se modificó su estado.

### Versión 0.7.0 — feedback y aprendizaje editorial (2026-09-01)

- `enki-editorial-learning` registra feedback humano y revisiones de agentes como observaciones no-PII ligadas al issue, documento, revisión y contenido exactos; una observación nunca modifica por sí sola una regla.
- `publication-retrospective/v1` congela antes de publicar la hipótesis, baseline y plan de medición. Un draft canary no inicia el reloj; una publicación live usa el `published_at` del proveedor y ventanas naturales de 7, 28 y 90 días en `Europe/Madrid`.
- Datos parciales, caídos o con volumen insuficiente quedan inconclusos y nunca se convierten en cero ni en éxito. Una afirmación de mejora exige como mínimo evidencia completa a 28 días y comparador explícito.
- Solo Board puede promover una lección; debe elegir la mínima superficie portable, enlazar evidencias y añadir una regresión. Repetición exige al menos dos contenidos independientes, salvo riesgo alto/crítico demostrado.
- Los contratos canónicos, mirrors, ejemplos, fixtures positivos/negativos y validador determinista pasan Ajv estricto y el validador oficial de skills.
- Pasan 73 pruebas del paquete, 63 pruebas de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. No se importó v0.7.0 ni se modificaron agentes, rutinas, WordPress o conectores live.

### Versión 0.8.0 — runtime aislado de catálogos (2026-09-01)

- `enki-catalog-pipeline` `0.1.0` prepara un snapshot PDF oficial como raster por página, manifiesto con SHA-256 e inventario de palabras con geometría; no extrae todavía productos canónicos, no compara Woo y no genera imports.
- Python 3.12 y las dependencias permisivas quedan fijados por `pyproject.toml` y `uv.lock`: pdfplumber `0.11.10`, pypdfium2 `5.13.0` y Pillow `12.3.0`. La base uv/Python está fijada por digest y el digest final se reserva al release.
- El wrapper Docker recibe únicamente un input externo read-only y un output externo separado; ejecuta sin red, capabilities, credenciales ni filesystem raíz escribible, y rechaza worktrees Git, symlinks, traversal, nombres de credenciales y runs existentes.
- Ocho unit tests y un smoke Docker real verifican 300 dpi, coordenadas, hashes, rutas relativas, determinismo byte a byte y limpieza ante errores. El gate completo conserva 73 pruebas del paquete, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose.
- No se importó v0.8.0 porque este runtime es tooling local del operador y no modifica agentes ni estado Paperclip. En ese corte todavía faltaban los contratos de evidencia; quedaron definidos posteriormente en v0.9.0 bajo `EAI-018`.

### Versión 0.9.0 — contratos trazables de catálogo (2026-09-01)

- `enki-catalog-run/v1` fija identidad, revisión, fuentes inmutables, checksums, runtime, reglas, artefactos, etapas, calidad, lineage y decisión local de cada ejecución.
- `enki-catalog-field-evidence/v1` conserva un hecho por entidad/campo con valor crudo y normalizado, transformación, confianza y localización exacta: cajas PDF, celda CSV por posición, recurso web o fila de revisión. Una página histórica sin geometría no puede aprobar un campo crítico.
- `enki-catalog-change-set/v1` une estado Woo actual y candidato mediante evidence keys exactas, alcance explícito, base fiscal, riesgo, decisión Board y resumen recalculable. Incluso aprobado, solo permite un borrador local y mantiene `externalWritesBlocked: true`.
- El validador autocontenido comprueba coherencia de run, marca, fuentes, hashes, paths, geometría, reglas, identidades, campos, valores, lineage, contadores y elegibilidad. Los tres schemas se compilan con Ajv 2020-12 estricto.
- Un bundle Buades inventado y saneado prueba geometría PDF y cabeceras Woo duplicadas por índice; diecinueve mutaciones negativas cubren paths absolutos, snapshots Woo parciales, tipos fuente/localización incompatibles, cajas inválidas, drift de hash, referencias ausentes, pérdida de valor, columnas/estados/confianza incoherentes, aprobaciones falsas, escritura externa, contadores y precisión insuficiente.
- El runbook de migración mapea `pdf_pages`, bloques geométricos, masters, comparativas, issues, colas QA, reglas manuales y exports Woo históricos sin promover `validated`, `resolved` o `auto_clear` a aprobación Board ni conservar rutas del host.
- Pasan 99 pruebas del paquete, 8 del runtime PDF, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. No se importó v0.9.0, no se procesaron catálogos reales y no hubo mutaciones en Paperclip o WooCommerce.

### Versión 0.10.0 — regresión multimarca de catálogo (2026-09-01)

- `enki-catalog-regression-suite/v1` fija un oracle mínimo y saneado para Buades, Enki Espejos, Mundilite y Chicandbath sin copiar PDFs, imágenes, SKU, precios, textos comerciales ni rutas del host.
- Seis fixtures cubren tabla, grid, detalle, columnas independientes, varios SKU por precio, matriz de acabados y configurador. En conjunto producen 21 parejas geométricas y 21 observaciones `enki-catalog-field-evidence/v1`.
- El validador autocontenido verifica hashes del manifiesto, áreas y límites de cajas, pairing izquierda-a-derecha, cabeceras de matriz, conteos, roles de entidad, estados QA y cabeceras Woo duplicadas por posición.
- Las pruebas negativas demuestran detección de drift de conteo/geometría/QA/hash/cabeceras, rutas absolutas, PII y credenciales. Los SHA de `source` identifican fuentes lógicas sintéticas, no los catálogos originales.
- Catalogue Manager exige esta regresión exacta antes de aceptar adaptadores, replays históricos o auditorías reales. Cambiar el oracle para acomodar una heurística queda prohibido.
- Pasan 116 pruebas del paquete, 8 del runtime PDF, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. No se importó v0.10.0, no se procesó ningún catálogo real y no hubo mutaciones en Paperclip, WooCommerce o conectores live.

### Versión 0.11.0 — core y adaptadores de catálogo (2026-09-01)

- `enki-catalog-pipeline` `0.2.0` separa primitivas geométricas comunes de reglas y código por marca. El core no contiene condiciones de marca ni la matriz Chicandbath.
- Cuatro definiciones `enki-catalog-adapter/v1`, fijadas por SHA-256, declaran versión, implementación, snapshot, páginas, features, fixtures, reglas y quality gate para Buades, Enki Espejos, Mundilite y Chicandbath.
- `row_left_to_right` asciende al core únicamente porque cinco fixtures de tres marcas lo demuestran. `matrix_by_headers` permanece en el adaptador Chicandbath hasta obtener evidencia independiente de otra marca.
- El ejecutor ignora `expected` y `pairing` del fixture, produce las relaciones y solo después el harness las compara con el oracle EAI-019. El gate cierra con cuatro adaptadores, seis fixtures, 21/21 pares, cobertura 1, error 0 y pass rate 1.
- Snapshot/página/features desconocidos, hashes alterados, geometría inválida, entidades sin QA y matrices incompletas fallan cerrado o producen métricas conservadoras; ninguna salida tiene autoridad comercial, Woo o externa.
- Pasan 121 pruebas del paquete, 25 del runtime de catálogo, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. No se importó v0.11.0, no se procesó un catálogo real y no hubo mutaciones en Paperclip, WooCommerce o conectores live.

### Versión 0.12.0 — reconciliación Woo y auditoría post-import (2026-09-01)

- `enki-catalog-pipeline` `0.3.0` lee cada export Woo como matriz posicional estricta: rechaza filas con ancho distinto, conserva cabeceras repetidas mediante índice cero-based, nombre original y nombre deduplicado estable, y fija cada binding en el perfil revisado.
- El perfil separa simples, padres y variaciones, resuelve qué entidad posee la página y limita cada campo a una superficie exacta. Precios solo se comparan con moneda y base fiscal EUR explícitas y evidencia independiente de la transformación.
- La reconciliación produce evidencia por campo, reporte y únicamente las diferencias en un change set local `needs_review`; no sobrescribe runs, no contiene credenciales/red, no genera CSV de importación y mantiene toda autoridad externa en `false`.
- La auditoría compara exports completos antes/después y exige las celdas exactas aprobadas, cero cambios adicionales, las mismas filas, SKU y relaciones padre. El drift fuera de alcance se registra solo mediante hashes, sin conservar sus valores.
- Cinco archivos saneados cubren tres grupos de cabeceras duplicadas, padre/variación, precio bruto, título, SEO, media, acabado, datos fuera de alcance, estado esperado, drift e idempotencia. Casos negativos rechazan hashes/columnas alterados, SKU duplicado, huérfanos, campos de página en variaciones, fiscalidad incompleta y un audit operacional sin aprobación Board.
- El replay acotado inspeccionó en memoria un export histórico Buades de 1.196 filas y 376 columnas: cero filas mal formadas, IDs/SKUs duplicados, roles desconocidos o variaciones huérfanas. Solo se versionaron checksum y agregados; tres filas inventadas reprodujeron la posición real y resolvieron cuatro candidatos como dos matches y dos diferencias. No se retuvo ningún valor comercial ni artefacto temporal.
- Pasan 127 pruebas del paquete, 38 del runtime de catálogo, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. No se importó v0.12.0, no se generó un import y no hubo mutaciones en Paperclip, WooCommerce o conectores live.

## Organización

El flujo es hub-and-spoke, sin Chief of Staff:

```text
Board / usuario
└── Director de Operaciones de Enki
    ├── Ecommerce & Catalogue Manager
    ├── Growth Manager
    ├── Finance & BI Manager
    ├── Technology Manager
    └── Customer Experience Manager
```

El Director es la única raíz compatible con el rol interno CEO de Paperclip, pero no obtiene autoridad de Board. El usuario puede asignar issues directamente a cualquier especialista. Ecommerce es owner del catálogo, stock, producto y evidencia de Merchant; Growth es owner de SEO, adquisición y oportunidades; Finance valida rentabilidad; Technology opera diagnósticos; CX produce únicamente borradores con contexto anonimizado.

## Fronteras de autonomía v0.12.0

- Verde: lecturas autorizadas, análisis, comparativas, evidencias, delegación interna y borradores locales.
- Amarillo: propuestas para incorporar una nueva fuente, herramienta, conexión, perfil, agente o rutina; requieren revisión Board antes de configurar nada.
- Naranja: solo `wordpress_upsert_post`, `facebook_publish_page_post` e `instagram_publish_image` pueden llegar a ask-first con el flujo editorial completo; campañas, precios, stock, emails, indexing, feeds y cualquier otra publicación/cambio web siguen bloqueados.
- Rojo: PII, pedidos individuales, reembolsos, presupuestos, despliegues, secretos y operaciones masivas; bloqueado.
- Cualquier herramienta MCP nueva queda en cuarentena hasta revisar catálogo, riesgo y política.
- El feedback y las métricas pueden generar candidatos de aprendizaje, pero únicamente Board puede promoverlos a reglas versionadas con evidencia y prueba de regresión.
- Importar/reindexar packs técnicos o purgar una versión completa superseded queda fuera de los agentes y solo existe en el CLI local del operador. No hay borrado por producto/serie/fila.

## Paquete fuente y backups

Se mantienen dos artefactos distintos:

1. `companies/enki-hogar-ai-os/`: fuente portable, revisable en Git y sin estado de instancia.
2. Export de compañía + backup de PostgreSQL + backup de almacenamiento: recuperación operativa de una instancia concreta, siempre fuera de Git.

No se exige igualdad byte a byte entre ambos. La compatibilidad se demuestra mediante preview, import/export y reimport funcional sobre una compañía desechable.

## Flujo local trackeable

1. Exportar la compañía existente desde la UI y conservar el backup fuera de Git.
2. Ejecutar `companies/enki-hogar-ai-os/scripts/check.sh`.
3. Arrancar únicamente Paperclip y completar el preflight del gateway en una compañía desechable.
4. Crear fuera de Git el env de conectores y los mounts OAuth/ADC; ningún agente recibe esos secretos.
5. Arrancar Quickstart y `runtime/docker-compose.integrations.yml` bajo el mismo proyecto Compose.
6. Comprobar `/health` para WooCommerce, GA4, GSC, Google Ads, product support y content publisher; este último debe iniciar con writes `disabled`.
7. Construir el ZIP determinista con `scripts/build-import-zip.sh` y guardar el SHA-256.
8. Ejecutar el preview del ZIP exacto por la ruta de transferencia CLI o por la UI sobre la compañía existente y exigir 6 agentes, 12 skills, 4 proyectos, 11 tareas, 2 rutinas y una raíz. En primera importación se exigen cero colisiones; en un parche solo se admiten reemplazos de entidades Enki conocidas.
9. Importar con todo pausado y ejecutar en el host de Paperclip el kill switch documentado: `npx paperclipai routines disable-all --company-id <company-id> --json`.
10. Configurar conexiones, perfiles y políticas siguiendo los runbooks; mantener installs MCP vacíos, reconciliar el Content Publisher con `scripts/reconcile-content-publisher.mjs --apply` para validar catálogo antes de permisos, aplicar la aprobación exacta de tres herramientas antes del bloqueo global, y reconciliar por API los seis gateways agent-scoped en estado disabled.
11. Ejecutar el detector de drift y exigir resultado limpio antes de activar nada.
12. Verificar para cada agente: workspace y home únicos, escritura denegada en workspace/scratch/paquete y, cuando exista referencia explícita, workspace hermano; persistencia solo vía issue/work product, credenciales Codex válidas y ausencia de secretos de conectores.
13. Activar especialistas uno a uno, después el Director, y ejecutar el smoke test manual. Validar content publisher en modo disabled y hacer el canary separado `wordpress-drafts` antes de habilitar otras publicaciones.
14. Instalar el plugin Telegram desde su mount del contenedor, configurarlo con secret-ref y allowlists exactas, y superar su smoke sin habilitar decisiones de aprobación.
15. Ejecutar manualmente Daily Brief y Weekly Review; habilitar sus horarios uno a uno solo si ambos pasan.

No usar `docker compose down -v`: el volumen de Paperclip contiene la base y los datos persistentes de la instancia.

## Verificación automatizada

El gate del paquete es:

```sh
companies/enki-hogar-ai-os/scripts/check.sh
```

Incluye validación estructural, licencia/procedencia, allowlist, hashes, rutas, secretos, configuración de runtime, skills autocontenidas y sus mirrors byte a byte del conocimiento canónico, brief con datos completos/parciales/obsoletos/caídos, contratos de evidencia y métricas, feedback con revisión exacta, retrospectiva 7/28/90, promoción Board-only, políticas, drift, gateway MCP seguro, WordPress render/dry-run, MCP WooCommerce, content publisher, plugin Telegram, PII, idempotencia, deduplicación, paginación, errores, rate limits y Compose. También ejecuta las ocho regresiones originales del runtime PDF, las 17 pruebas del core/adaptadores y 13 de reconciliación Woo/replay: hashes, ownership, alcance cerrado, independencia del oracle, posiciones duplicadas, identidad padre/variación, fiscalidad, idempotencia, auditoría integral y fallos conservadores. CI construye las imágenes de conectores desde bases fijadas por digest.

Las pruebas de portabilidad cubren creación y actualización con homes Codex gestionados por UUID, rechazo de overrides inseguros y export sin paths locales. Las pruebas del adaptador cubren que un home gestionado siga recibiendo la configuración de proveedores Codex. La autenticación de named gateways queda cubierta por 21 pruebas dirigidas del middleware y 51 pruebas del gateway, además del smoke real descrito arriba.

Los gates globales del monorepo no están verdes en este host por causas ajenas al diff: `pnpm -r typecheck` y `pnpm build` llegan al runner Rust y paran porque `cargo` no está instalado; `pnpm test:run` alcanza `workspace-runtime.test.ts`, donde la configuración global `commit.gpgsign=true` rompe los repos Git efímeros sin TTY. Deshabilitando esa firma solo para el proceso pasan 150/154; los cuatro casos restantes reproducen diferencias locales de macOS (`/var` frente a `/private/var`), un timeout y su conflicto de puerto derivado. No existe diff de esta rama en `workspace-runtime.ts` ni en su test. Los typechecks TypeScript directos de server/adapter y todos los tests que cubren este cambio sí pasan.

El preview/import inicial, la autenticación Codex, el named-gateway smoke, los cinco pilotos de especialistas, los dos pilotos manuales del Director, la memoria editorial y el primer pack técnico real ya están completados. v0.5.0 quedó importada selectivamente y desplegada sobre Quickstart: Woo, Google, Product Support y Content Publisher están sanos; ENK-23 prueba el flujo live de variación más soporte técnico; y el publicador presenta catálogo/políticas/perfiles con drift cero y `write_mode=disabled`. v0.12.0 conserva esa topología, incorpora el hardening 0.5.1, el workflow editorial v2, el ciclo de aprendizaje gobernado, los contratos de catálogo v1, la regresión y adaptadores multimarca y la reconciliación Woo posicional con auditoría post-import; todavía no se ha importado como paquete y el tooling local no lo requiere. El prototipo v0.3.0 permanece superseded: no se carga un master comercial completo en PostgreSQL. Quedan la reconciliación de medición, el conector read-only de evidencia de runs, los canaries separados de Facebook e Instagram y la instalación/configuración del plugin Telegram con bot e identidades reales. La activación de horarios sigue siendo una decisión Board separada; hasta entonces el desired state y el estado observado mantienen agentes, rutinas y triggers pausados.

## GO/NO-GO v0.12.0

La arquitectura pasa a la siguiente fase solo si, de forma repetible:

1. se importa en una compañía limpia y pausada;
2. WooCommerce entrega envelopes válidos y fechados, y los resultados de GA4, GSC y Ads se normalizan inmediatamente al mismo contrato antes de cualquier cálculo o brief;
3. una tarea manual al Director produce un Daily Brief que distingue datos actuales, históricos, obsoletos y ausentes;
4. el Director propone handoffs correctos a Ecommerce, Growth y Finance, con owner y evidencia, sin crearlos automáticamente durante el smoke;
5. no se observa PII, contacto a cliente ni llamada no autorizada; cualquier publicación queda ligada a la revisión exacta, aprobación Board, journal y respuesta live.
6. Telegram acepta solo el usuario/chat exactos, crea trabajo atribuido en Paperclip, bloquea datos sensibles y deja toda decisión de aprobación en la UI.
7. Woo es la única autoridad comercial live; product support expone solo hechos técnicos aprobados/citados, no contiene precio/stock y el MCP no puede escribir.
8. Un pack nuevo supersede atómicamente al anterior y el purge solo acepta la versión completa superseded tras preview sin cambios.
9. En modo `disabled`, las tres escrituras fallan antes del proveedor; el canary `wordpress-drafts` no duplica al repetir la misma idempotency key y Facebook/Instagram permanecen bloqueados hasta canaries separados.
10. Todo contenido pasa por un `editorial-brief` versionado: Ecommerce valida el fingerprint exacto, los scores se recalculan y la decisión Board se aplica en una revisión posterior antes de abrir `content-draft`.
11. Todo contenido live conserva hipótesis y plan prepublicación, retrospectiva 7/28/90 y feedback ligado a revisiones exactas; ninguna observación o métrica cambia skills, contratos o runbooks sin decisión Board, evidencia y regresión.
12. La preparación de catálogos corre sin red ni credenciales, conserva SHA-256 y geometría, y no filtra rutas locales ni sobrescribe runs. Cada adaptador debe coincidir exactamente en marca/snapshot/página/hash, ejecutar sin leer el oracle esperado y cerrar con cobertura 1/error 0; cada delta pasa además los tres contratos v1, el validador cruzado y QA humana. Ninguna salida se trata como producto aprobado.
13. Toda reconciliación Woo fija el export completo, sus cabeceras por posición, entidades y campos exactos; produce solo diferencias locales pendientes y una segunda ejecución sobre el estado esperado da cero cambios. Tras una aplicación humana separada, el audit exige cero drift de filas, identidad o celdas fuera del change set aprobado.

Hasta superar este hito no se añaden Merchant Center live, formatos sociales adicionales, media upload, pricing ni mayor autonomía.

## Promoción futura

Producción importará el mismo tag Git y el mismo ZIP validado sobre una compañía nueva y pausada. Antes de promover se deben completar los campos pendientes de `runtime/compatibility.lock.yaml`: tag y commit del paquete, imagen final de Paperclip y digest, imágenes finales de WooCommerce, Google, product support, content publisher y catalog pipeline con sus digests, y SHA-256 del ZIP.

La infraestructura elegida deberá aportar PostgreSQL gestionado, almacenamiento persistente, TLS, autenticación, gestor de secretos, red privada o HTTPS gobernado para MCP, backups restaurables, smoke test y rollback. Cualquier upgrade de Paperclip se prueba primero en rama y exige de nuevo validación, preflight MCP, tests de políticas, roundtrip, aislamiento Codex y aprobación manual.

## Riesgos residuales aceptados

- `network_access=true` es necesario para que `codex_local` alcance la API de Paperclip y el gateway; el sandbox actual no ofrece allowlist por destino en el Quickstart. Los agentes no reciben bearer ni credenciales upstream, y el objetivo futuro es `networkScope=allowlist` tras validar `bwrap`.
- Connections, perfiles, políticas y named gateways no forman parte del export portable actual; el desired state los audita. Los gateways se reconcilian con el script versionado porque la UI no expresa de forma segura este scope por agente.
- Los agentes pueden intentar alterar rutinas dentro de capacidades del producto; sus contratos lo prohíben y el detector marca cualquier rutina inesperada o activa.
- Los valores finales de límites mensuales pertenecen a Board. El gate exige que sean positivos, pero el repositorio no inventa importes.
- Los digests de las imágenes finales se completan durante el release; solo las imágenes base están fijadas en el árbol fuente.
- El transporte Telegram v0.2.0 usa long polling y exige una única réplica activa por token. La promoción multi-réplica requerirá webhook HTTPS con verificación o coordinación de líder antes de escalar horizontalmente.
