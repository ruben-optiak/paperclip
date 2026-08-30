# Setup versionado de Enki Hogar AI OS

Fecha: 2026-08-29
Rama: `feat/enki-hogar-approach`
Paquete: `companies/enki-hogar-ai-os/`
Versión inicial: `0.1.0`

## Objetivo

Entregar una definición reproducible `agentcompanies/v1` para operar Enki Hogar desde Paperclip con seis agentes, fuentes gobernadas y autonomía limitada a lectura, análisis y borradores. La primera importación se hará sobre la compañía local existente, con agentes, heartbeats y rutinas pausados.

No se cambia la UI, el contrato de API, el esquema de base de datos ni las migraciones. Como excepción de seguridad al alcance inicial, se endurece internamente el importador para asignar un `CODEX_HOME` gestionado y único por agente importado y se conserva la carga de proveedores Codex en ese home. El paquete portable no puede calcular esos paths porque los UUID se generan al importar.

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
- [x] Preflight seguro del gateway para demostrar lectura permitida, escritura denegada y auditoría antes de conectar Enki.
- [x] Desired state y detector GET-only de drift para conexiones, catálogos, perfiles, políticas, gateways por agente, runtimes, homes, presupuestos y rutinas.
- [x] Aislamiento por workspace y home gestionado; sandbox explícito, approvals deshabilitados en runtime no interactivo y sin secretos de conectores en agentes.
- [x] Lock de compatibilidad con commit base de Paperclip y digests OCI de las imágenes base de conectores.
- [x] Separación de licencia MIT para código/configuración y `LicenseRef-Enki-Hogar-Internal` para conocimiento de Enki.
- [x] Artefacto ZIP determinista, allowlist de importación y workflow CI limitado a los paths de Enki y del hardening del importador.
- [x] Gate automatizado dirigido: paquete 31/31, MCP WooCommerce 16/16, portabilidad/adapter 101/101, ocho skills válidas, typechecks dirigidos, ZIP reproducible y Compose combinado.
- [ ] Backup de la compañía local existente — acción manual antes del import.
- [ ] Preflight del gateway en una compañía desechable con una sesión Board real.
- [ ] Preview actualizado en la UI: 6 agentes, 8 skills, 4 proyectos, 9 tareas, 2 rutinas y cero colisiones.
- [x] Configuración local de cuatro conexiones, seis perfiles, política global, seis gateways gobernados y límites mensuales positivos; conexiones y gateways quedan deshabilitados hasta superar el gateway smoke.
- [x] Named-gateway smoke con sesión Board real: dos catálogos exactos, tres lecturas Google reales, una denegación default y restauración completa del estado pausado.
- [ ] Smoke test con cuentas reales, activación individual y GO/NO-GO del Daily Brief.
- [ ] Activación de rutinas — únicamente después de ejecutar ambas manualmente.

El preview anterior de cinco agentes y siete skills queda superado por el hardening de v0.1.0 y no cuenta como evidencia de la versión actual.

## Evidencia local de integración — 2026-08-30

- Los tres MCP de Google pasan salud, `tools/list` stateless y catálogos exactos: Ads 3 herramientas, GA4 7 y GSC 4.
- ADC, OAuth de GSC y Google Ads ejecutan lecturas reales mínimas sin imprimir resultados sensibles.
- Paperclip mantiene las cuatro conexiones saludables, sin installs directos, en `draft` y deshabilitadas.
- Los seis perfiles default-deny coinciden con el desired state. El smoke administrativo pasó 18 matrices agente/conexión, tres lecturas reales y una denegación `deny_default`.
- Agentes y rutinas permanecen pausados; los seis gateways permanecen deshabilitados y no hay ningún token `gateway_client` activo.
- La auditoría de drift deja únicamente 14 diferencias de activación esperadas: `status/enabled` de cuatro conexiones y `status` de seis gateways.
- El named-gateway smoke pasa por las rutas MCP reales: dos catálogos exactos, tres lecturas Google, una decisión `deny_default`, revocación de tokens temporales y restauración de conexiones y gateways a estado deshabilitado.

La incompatibilidad del core detectada durante el primer smoke queda corregida. `actorMiddleware` excluye únicamente `GET` y `POST` sobre las dos rutas exactas del protocolo MCP (`/mcp/gateways/:gatewayPublicId` y `/api/tool-gateway/gateways/:gatewayId/mcp`) y deja al named gateway como única autoridad para validar sus bearer. La excepción no asigna identidad Board ni agent, y no alcanza subrutas administrativas, paths anidados ni otros métodos. La regresión está cubierta en ambos modos de despliegue y el test de aceptación monta ahora el middleware global real.

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

## Fronteras de autonomía v0.1.0

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
10. Configurar conexiones, perfiles y políticas siguiendo los runbooks; mantener installs vacíos y reconciliar por API los seis gateways agent-scoped en estado disabled.
11. Ejecutar el detector de drift y exigir resultado limpio antes de activar nada.
12. Verificar para cada agente: workspace y home únicos, escritura imposible sobre el paquete y workspaces hermanos, scratch operativo, credenciales Codex válidas y ausencia de secretos de conectores.
13. Activar especialistas uno a uno, después el Director, y ejecutar el smoke test manual.
14. Ejecutar manualmente Daily Brief y Weekly Review; habilitar sus horarios uno a uno solo si ambos pasan.

No usar `docker compose down -v`: el volumen de Paperclip contiene la base y los datos persistentes de la instancia.

## Verificación automatizada

El gate del paquete es:

```sh
companies/enki-hogar-ai-os/scripts/check.sh
```

Incluye validación estructural, licencia/procedencia, allowlist, hashes, rutas, secretos, configuración de runtime, skills autocontenidas y sus mirrors byte a byte del conocimiento canónico, brief con datos completos/parciales/obsoletos/caídos, contratos de evidencia y métricas, políticas, drift, gateway seguro, WordPress render/dry-run, MCP WooCommerce, PII, paginación, errores, rate limits y Compose. CI construye también las dos imágenes de conectores desde bases fijadas por digest.

Las pruebas de portabilidad cubren creación y actualización con homes Codex gestionados por UUID, rechazo de overrides inseguros y export sin paths locales. Las pruebas del adaptador cubren que un home gestionado siga recibiendo la configuración de proveedores Codex. La autenticación de named gateways queda cubierta por 21 pruebas dirigidas del middleware y 51 pruebas del gateway, además del smoke real descrito arriba.

Los gates globales del monorepo no están verdes en este host por causas ajenas al diff: `pnpm -r typecheck` y `pnpm build` llegan al runner Rust y paran porque `cargo` no está instalado; `pnpm test:run` alcanza `workspace-runtime.test.ts`, donde la configuración global `commit.gpgsign=true` rompe los repos Git efímeros sin TTY. Deshabilitando esa firma solo para el proceso pasan 150/154; los cuatro casos restantes reproducen diferencias locales de macOS (`/var` frente a `/private/var`), un timeout y su conflicto de puerto derivado. No existe diff de esta rama en `workspace-runtime.ts` ni en su test. Los typechecks TypeScript directos de server/adapter y todos los tests que cubren este cambio sí pasan.

El preview sobre la compañía local, la autenticación Codex, la activación individual y el GO/NO-GO del Daily Brief permanecen manuales porque requieren sesión Board, backup, credenciales y aprobación. El named-gateway smoke y las lecturas mínimas de conectores con cuentas reales ya se completaron sin conservar tokens temporales.

## GO/NO-GO v0.1.0

La arquitectura pasa a la siguiente fase solo si, de forma repetible:

1. se importa en una compañía limpia y pausada;
2. WooCommerce entrega envelopes válidos y fechados, y los resultados de GA4, GSC y Ads se normalizan inmediatamente al mismo contrato antes de cualquier cálculo o brief;
3. una tarea manual al Director produce un Daily Brief que distingue datos actuales, históricos, obsoletos y ausentes;
4. el Director delega correctamente a Ecommerce, Growth y Finance;
5. no se observa PII, mutación externa, publicación, contacto a cliente ni llamada no autorizada.

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
