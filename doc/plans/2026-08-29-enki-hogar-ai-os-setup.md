# Setup versionado de Enki Hogar AI OS

Fecha: 2026-08-29
Rama: `feat/enki-hogar-approach`
Paquete: `companies/enki-hogar-ai-os/`
Versión inicial: `0.1.0`
Versión actual: `0.2.0`

## Objetivo

Entregar una definición reproducible `agentcompanies/v1` para operar Enki Hogar desde Paperclip con seis agentes, fuentes gobernadas y autonomía limitada a lectura, análisis y borradores. La primera importación se hará sobre la compañía local existente, con agentes, heartbeats y rutinas pausados.

No se cambia la UI, el contrato de API, el esquema de base de datos ni las migraciones. Como excepciones de seguridad al alcance inicial, se endurece internamente el importador para asignar un `CODEX_HOME` gestionado y único por agente importado, se conserva la carga de proveedores Codex en ese home y el adaptador entrega los MCP gestionados con cabeceras HTTP válidas y delegación explícita de aprobación al gateway de Paperclip. El paquete portable no puede calcular esos paths porque los UUID se generan al importar.

## Estado de implementación

- [x] Paquete portable con `COMPANY.md`, `README.md`, `.paperclip.yaml`, licencias y procedencia.
- [x] Seis agentes `codex_local`, una única raíz y contratos explícitos de ejecución, fuentes, handoffs y bloqueo.
- [x] Ocho skills versionadas, incluida `enki-brand-guardian`, con ejemplos y fixtures offline.
- [x] Cuatro proyectos, nueve tareas iniciales y dos rutinas con triggers deshabilitados.
- [x] Snapshot curado mediante allowlist, inventario con hashes y sincronización con escaneo de secretos.
- [x] MCP WooCommerce autenticado, estrictamente GET y con cinco herramientas sin pedidos individuales ni PII.
- [x] Runtimes fijados para Google Ads, GA4 y GSC, protegidos con bearer y catálogos de lectura.
- [x] Contrato común `enki-evidence-envelope/v1` y definiciones canónicas de métricas, moneda, IVA, devoluciones, ROAS, CAC y margen desconocido.
- [x] Compose adicional, `.env.example`, matriz de secretos y endpoints de salud no sensibles.
- [x] Plugin Telegram versionado: allowlist de usuario/chat, atribución humana, issues/comentarios auditados, reportes filtrados y avisos de aprobación sin capacidad de decisión.
- [x] Preflight seguro del gateway para demostrar lectura permitida, escritura denegada y auditoría antes de conectar Enki.
- [x] Desired state y detector GET-only de drift para conexiones, catálogos, perfiles, políticas, gateways por agente, runtimes, homes, presupuestos y rutinas.
- [x] Aislamiento por workspace y home gestionado; filesystem read-only con Landlock, proceso Codex no interactivo y sin secretos de conectores en agentes. Codex autoriza el despacho MCP, pero Paperclip conserva la decisión allow/deny/approval.
- [x] Lock de compatibilidad con commit base de Paperclip y digests OCI de las imágenes base de conectores.
- [x] Separación de licencia MIT para código/configuración y `LicenseRef-Enki-Hogar-Internal` para conocimiento de Enki.
- [x] Artefacto ZIP determinista, allowlist de importación y workflow CI limitado a los paths de Enki y del hardening del importador.
- [x] Gate automatizado dirigido: paquete 32/32, MCP WooCommerce 19/19, portabilidad/adapter 101/101, ocho skills válidas, typechecks dirigidos, ZIP reproducible y Compose combinado.
- [x] Backup de la compañía local existente completado antes de las pruebas de activación.
- [ ] Preflight del gateway en una compañía desechable con una sesión Board real.
- [x] Importación local completada y topología verificada: 6 agentes, 8 skills, 4 proyectos, 9 tareas y 2 rutinas.
- [x] Configuración local de cuatro conexiones, seis perfiles, política global, seis gateways gobernados y límites mensuales positivos; conexiones y gateways se activaron tras superar su smoke, con agentes y rutinas pausados.
- [x] Named-gateway smoke con sesión Board real: dos catálogos exactos, tres lecturas Google reales, una denegación default y restauración completa del estado pausado.
- [x] Smoke test con cuentas reales y activación individual: los cinco especialistas y el Director han superado el perímetro read-only/zero-PII; los informes del Director son operativamente `PARTIAL` porque declaran fuentes y decisiones todavía ausentes.
- [x] Ejecución manual de Daily Brief y Weekly Review con un único run cada una, disposición terminal y restauración posterior del Director a `paused`.
- [ ] Instalación/configuración del plugin Telegram en la instancia local y smoke con bot/IDs reales; el código y el mount están listos, pero la instancia todavía no tiene plugins instalados.
- [ ] Activación de horarios — requiere decisión explícita de Board; el desired state de v0.2.0 mantiene ambas rutinas pausadas y sus triggers deshabilitados.

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

## Fronteras de autonomía v0.2.0

- Verde: lecturas autorizadas, análisis, comparativas, evidencias, delegación interna y borradores locales.
- Amarillo: propuestas para incorporar una nueva fuente, herramienta, conexión, perfil, agente o rutina; requieren revisión Board antes de configurar nada.
- Naranja: publicaciones, campañas, precios, stock, emails, indexing, feeds y cambios web; bloqueado.
- Rojo: PII, pedidos individuales, reembolsos, presupuestos, despliegues, secretos y operaciones masivas; bloqueado.
- Cualquier herramienta MCP nueva queda en cuarentena hasta revisar catálogo, riesgo y política.

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
6. Comprobar `/health` para WooCommerce, GA4, GSC y Google Ads.
7. Construir el ZIP determinista con `scripts/build-import-zip.sh` y guardar el SHA-256.
8. Ejecutar el preview UI sobre la compañía existente y exigir 6 agentes, 8 skills, 4 proyectos, 9 tareas, 2 rutinas, una raíz y cero colisiones.
9. Importar con todo pausado y ejecutar en el host de Paperclip el kill switch documentado: `npx paperclipai routines disable-all --company-id <company-id> --json`.
10. Configurar conexiones, perfiles y políticas siguiendo los runbooks; mantener installs MCP vacíos y reconciliar por API los seis gateways agent-scoped en estado disabled.
11. Ejecutar el detector de drift y exigir resultado limpio antes de activar nada.
12. Verificar para cada agente: workspace y home únicos, escritura denegada en workspace/scratch/paquete y, cuando exista referencia explícita, workspace hermano; persistencia solo vía issue/work product, credenciales Codex válidas y ausencia de secretos de conectores.
13. Activar especialistas uno a uno, después el Director, y ejecutar el smoke test manual.
14. Instalar el plugin Telegram desde su mount del contenedor, configurarlo con secret-ref y allowlists exactas, y superar su smoke sin habilitar decisiones de aprobación.
15. Ejecutar manualmente Daily Brief y Weekly Review; habilitar sus horarios uno a uno solo si ambos pasan.

No usar `docker compose down -v`: el volumen de Paperclip contiene la base y los datos persistentes de la instancia.

## Verificación automatizada

El gate del paquete es:

```sh
companies/enki-hogar-ai-os/scripts/check.sh
```

Incluye validación estructural, licencia/procedencia, allowlist, hashes, rutas, secretos, configuración de runtime, skills autocontenidas y sus mirrors byte a byte del conocimiento canónico, brief con datos completos/parciales/obsoletos/caídos, contratos de evidencia y métricas, políticas, drift, gateway MCP seguro, WordPress render/dry-run, MCP WooCommerce, plugin Telegram, PII, deduplicación, paginación, errores, rate limits y Compose. CI construye también las dos imágenes de conectores desde bases fijadas por digest.

Las pruebas de portabilidad cubren creación y actualización con homes Codex gestionados por UUID, rechazo de overrides inseguros y export sin paths locales. Las pruebas del adaptador cubren que un home gestionado siga recibiendo la configuración de proveedores Codex. La autenticación de named gateways queda cubierta por 21 pruebas dirigidas del middleware y 51 pruebas del gateway, además del smoke real descrito arriba.

Los gates globales del monorepo no están verdes en este host por causas ajenas al diff: `pnpm -r typecheck` y `pnpm build` llegan al runner Rust y paran porque `cargo` no está instalado; `pnpm test:run` alcanza `workspace-runtime.test.ts`, donde la configuración global `commit.gpgsign=true` rompe los repos Git efímeros sin TTY. Deshabilitando esa firma solo para el proceso pasan 150/154; los cuatro casos restantes reproducen diferencias locales de macOS (`/var` frente a `/private/var`), un timeout y su conflicto de puerto derivado. No existe diff de esta rama en `workspace-runtime.ts` ni en su test. Los typechecks TypeScript directos de server/adapter y todos los tests que cubren este cambio sí pasan.

El preview e import sobre la compañía local, la autenticación Codex, el named-gateway smoke, los cinco pilotos de especialistas y los dos pilotos manuales del Director ya se completaron con sesión Board y sin conservar tokens temporales. Para cerrar v0.2.0 todavía falta instalar/configurar el plugin Telegram y superar su smoke con identidades reales. La activación posterior de horarios seguirá siendo una decisión Board separada; hasta entonces el desired state exige rutinas y triggers pausados.

## GO/NO-GO v0.2.0

La arquitectura pasa a la siguiente fase solo si, de forma repetible:

1. se importa en una compañía limpia y pausada;
2. WooCommerce entrega envelopes válidos y fechados, y los resultados de GA4, GSC y Ads se normalizan inmediatamente al mismo contrato antes de cualquier cálculo o brief;
3. una tarea manual al Director produce un Daily Brief que distingue datos actuales, históricos, obsoletos y ausentes;
4. el Director propone handoffs correctos a Ecommerce, Growth y Finance, con owner y evidencia, sin crearlos automáticamente durante el smoke;
5. no se observa PII, mutación externa, publicación, contacto a cliente ni llamada no autorizada.
6. Telegram acepta solo el usuario/chat exactos, crea trabajo atribuido en Paperclip, bloquea datos sensibles y deja toda decisión de aprobación en la UI.

Hasta superar este hito no se añaden Merchant Center live, Meta, social, publicación, pricing ni mayor autonomía.

## Promoción futura

Producción importará el mismo tag Git y el mismo ZIP validado sobre una compañía nueva y pausada. Antes de promover se deben completar los campos pendientes de `runtime/compatibility.lock.yaml`: tag y commit del paquete, imagen final de Paperclip y digest, imágenes finales de ambos conectores y digests, y SHA-256 del ZIP.

La infraestructura elegida deberá aportar PostgreSQL gestionado, almacenamiento persistente, TLS, autenticación, gestor de secretos, red privada o HTTPS gobernado para MCP, backups restaurables, smoke test y rollback. Cualquier upgrade de Paperclip se prueba primero en rama y exige de nuevo validación, preflight MCP, tests de políticas, roundtrip, aislamiento Codex y aprobación manual.

## Riesgos residuales aceptados

- `network_access=true` es necesario para que `codex_local` alcance la API de Paperclip y el gateway; el sandbox actual no ofrece allowlist por destino en el Quickstart. Los agentes no reciben bearer ni credenciales upstream, y el objetivo futuro es `networkScope=allowlist` tras validar `bwrap`.
- Connections, perfiles, políticas y named gateways no forman parte del export portable actual; el desired state los audita. Los gateways se reconcilian con el script versionado porque la UI no expresa de forma segura este scope por agente.
- Los agentes pueden intentar alterar rutinas dentro de capacidades del producto; sus contratos lo prohíben y el detector marca cualquier rutina inesperada o activa.
- Los valores finales de límites mensuales pertenecen a Board. El gate exige que sean positivos, pero el repositorio no inventa importes.
- Los digests de las imágenes finales se completan durante el release; solo las imágenes base están fijadas en el árbol fuente.
- El transporte Telegram v0.2.0 usa long polling y exige una única réplica activa por token. La promoción multi-réplica requerirá webhook HTTPS con verificación o coordinación de líder antes de escalar horizontalmente.
