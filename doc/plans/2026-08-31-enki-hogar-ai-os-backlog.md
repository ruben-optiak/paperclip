# Enki Hogar AI OS — backlog vivo

Última actualización: 2026-09-01
Rama de trabajo: `feat/enki-hogar-approach`
Paquete actual: `companies/enki-hogar-ai-os/` (`0.12.0`)

## Propósito

Este documento es la lista versionada y priorizada de mejoras del sistema Enki Hogar AI OS. El [plan de setup](2026-08-29-enki-hogar-ai-os-setup.md) conserva la historia de implementación; este backlog contiene únicamente el estado actual y el siguiente trabajo.

Hay dos capas separadas:

- Este backlog registra mejoras de arquitectura, reglas, conectores, seguridad, promoción y aprendizaje que deben sobrevivir entre instancias.
- Paperclip Issues registra el trabajo operativo ejecutable, sus agentes, comentarios, documentos, revisiones y aprobaciones.

Un elemento de este documento no se considera iniciado porque exista un issue, ni terminado porque un agente lo afirme. Debe enlazar evidencia verificable. Cuando un elemento se convierta en trabajo operativo, se añadirá su identificador `ENK-*`; cuando una prueba revele una lección reutilizable, se evaluará si debe convertirse en contrato, skill, fixture o runbook versionado.

## Estados

- `NOW`: siguiente trabajo; no debe haber más de tres elementos simultáneos.
- `READY`: definido y sin bloqueo, pero no es el siguiente.
- `BLOCKED`: necesita una decisión, credencial, evidencia o dependencia explícita.
- `LATER`: válido, pero deliberadamente pospuesto.
- `DONE`: terminado con evidencia; se mueve al registro de cerrados.

## Estado observado de la instancia

Snapshot comprobado el 2026-09-01:

- Seis agentes Enki pausados y cero runs activos.
- Dos rutinas pausadas; ambos triggers de calendario están deshabilitados.
- WooCommerce, GA4, GSC, Google Ads, Product Support y Content Publisher están activos y sanos.
- WordPress está configurado en Content Publisher, pero `CONTENT_PUBLISH_WRITE_MODE=disabled`.
- Facebook e Instagram no están configurados.
- No hay plugins instalados; Telegram sigue pendiente de instalación y smoke real.
- Quedan seis issues bootstrap vigentes en backlog: `ENK-2`, `ENK-4`, `ENK-5`, `ENK-6`, `ENK-7` y `ENK-8`. `ENK-1` fue cancelado como onboarding obsoleto y `ENK-3` se cerró con evidencia de los smokes `ENK-9` a `ENK-15`.
- `ENK-5` está bloqueado por `ENK-2`; `ENK-8` está bloqueado por `ENK-4`. Ninguno de los seis issues retenidos se movió a `todo`.
- El workflow editorial v2 y su ciclo de feedback, retrospectiva 7/28/90 y aprendizaje Board-only quedan consolidados en la instancia mediante el último import selectivo. El paquete fuente `0.12.0` añade tooling local, contratos trazables, regresión y adaptadores multimarca, reconciliación Woo posicional y auditoría post-import; todavía no se ha importado ni cambia la instancia. La sincronización con upstream sigue separada bajo `EAI-016`.
- `EAI-002` quedó cerrado mediante `ENK-29`–`ENK-31`: el brief canónico de `ENK-24` es la revisión 7 y conserva C1 únicamente como prioridad de investigación, sin autorizar consolidación ni mutaciones externas.

## Orden inmediato

1. Reconciliar la medición GA4/GSC bajo `EAI-006` y declarar qué métricas editoriales son utilizables.
2. Implementar `EAI-022`: exponer exclusivamente runs aprobados y evidencia por campo mediante un conector read-only para Catalogue Manager; no procesar todavía todos los catálogos ni generar imports Woo live.
3. Mantener `ENK-7` en backlog hasta que `EAI-022` demuestre default-deny, alcance por run aprobado y ausencia de acceso a inputs brutos.
4. Solo después de `EAI-006`, solicitar una nueva decisión Board para la primera ejecución editorial real; C1 sigue siendo una investigación y no una consolidación preaprobada.

## Backlog priorizado

| ID | Prioridad | Estado | Trabajo | Siguiente acción | Evidencia de cierre |
| --- | --- | --- | --- | --- | --- |
| `EAI-006` | P1 | NOW | Reconciliar medición GA4 | Technology investiga la divergencia GA4/GSC, cobertura de páginas editoriales, consentimiento, eventos e ingresos; Growth documenta qué métricas son utilizables | Baseline de medición con fuentes, limitaciones y consultas reproducibles; se actualizan los contratos afectados |
| `EAI-007` | P1 | BLOCKED | Primera ejecución editorial real | Tras `EAI-006` y una nueva decisión Board, decidir entre seguir investigando C1 o elegir otro tema no solapado; producir primero un borrador local y revisión exacta | Borrador y revisión versionados; si Board autoriza canary, WordPress crea un único draft idempotente y se verifica live |
| `EAI-008` | P1 | READY | Datos financieros mínimos | Ejecutar `ENK-2`; mantener `ENK-5` bloqueado hasta disponer del contrato de COGS, fiscalidad, transporte, comisiones, devoluciones y atribución | Contrato de fuentes financieras y lista explícita de métricas disponibles/no disponibles |
| `EAI-009` | P1 | READY | Telegram local | Instalar el plugin, crear secret-ref del bot, fijar user/chat allowlists y ejecutar el smoke bidireccional sin autoridad de aprobación | Mensaje autorizado crea issue/comentario atribuido; reporte llega al chat; PII y decisiones de aprobación siguen bloqueadas |
| `EAI-010` | P2 | BLOCKED | Facebook e Instagram | Configurar credenciales y ejecutar canaries separados; no compartir aprobación ni estado de escritura con WordPress | Cada proveedor supera lectura, aprobación exacta, idempotencia y reconciliación live de forma independiente |
| `EAI-011` | P2 | BLOCKED | Activar rutinas | Requiere backlog limpio, medición reconciliada y varios briefs/revisiones manuales aceptados por Board | Board habilita cada trigger por separado; primer run programado termina correctamente y no crea trabajo duplicado |
| `EAI-012` | P2 | READY | Merchant Center | Ejecutar el `ENK-6` ya reespecificado: verificar la causa actual mediante fuente autorizada y preparar recuperación sin mutaciones automáticas | Diagnóstico fechado, evidencias, acciones humanas y criterios de recuperación; sin tratar DevDocs como estado real |
| `EAI-013` | P2 | BLOCKED | Catálogo y soporte técnico (épica) | Ejecutar primero `EAI-022`; `EAI-018`–`EAI-021` ya están cerrados. Después reabrir `ENK-7` para una auditoría desde export Woo fresco y seleccionar el siguiente pack técnico por marca/dominio | Mismatches reproducibles sin duplicar catálogo; pack aprobado e importable con ciclo de supersede/purge completo; las consultas live usan SKU/product ID Woo exacto |
| `EAI-014` | P2 | READY | SEO, SEM y performance (épica) | Coordinar `EAI-023`–`EAI-027`; `ENK-4`/`EAI-006` siguen siendo el gate de medición antes de ejecutar `ENK-8` | Backlog priorizado por impacto, confianza, esfuerzo y riesgo; consultas, periodos y baselines reproducibles |
| `EAI-015` | P3 | LATER | Promoción a producción | Elegir infraestructura, fijar tag/commit, digests OCI y SHA-256 del ZIP; probar import pausado, backup, restore, smoke y rollback | Todos los campos de `runtime/compatibility.lock.yaml` completos y evidencia de restauración/promoción |
| `EAI-016` | P3 | LATER | Sincronización con upstream Paperclip | Probar periódicamente `upstream/master` en una rama de sync, resolver conflictos allí y ejecutar gates antes de integrar en Enki | Merge de upstream aislado, verificado y documentado; nunca se experimenta directamente sobre la rama operativa |
| `EAI-022` | P1 | NOW | Evidencia read-only para Catalogue Manager | Exponer runs aprobados y evidencia por campo mediante un conector sin herramientas de escritura, usando el replay histórico ya cerrado como gate de entrada | Catálogo MCP exacto, default-deny, consultas por marca/serie/SKU/campo, crops o coordenadas verificables y cero acceso a inputs brutos no aprobados |
| `EAI-023` | P1 | BLOCKED | Pipeline SEO actual | Tras `EAI-006`, consolidar snapshot GSC/GA4, inventario de URLs, indexabilidad, canibalización, contenido y priorización con fechas y consultas reproducibles | Baseline actual, contratos de fuente/frescura, backlog medible y regresiones para canonical, redirect, noindex, sitemap y enlazado interno |
| `EAI-024` | P1 | BLOCKED | Economía SEM por item/SKU | Tras `EAI-006`, `EAI-008` y `EAI-012`, cruzar Ads/Merchant/Woo por identificadores exactos, margen y etiquetas sin inferir costes ausentes | Informe reproducible por campaña/item/SKU con cobertura de matching, ROAS/CAC/margen utilizables, gaps explícitos y cero mutaciones de campaña |
| `EAI-025` | P1 | BLOCKED | Ledger de experimentos SEM | Tras `EAI-024`, versionar hipótesis, cohorte, presupuesto autorizado, ventana, comparador, resultado y decisión sin permitir activación automática | Cada propuesta es idempotente y auditable; datos insuficientes quedan inconclusos y toda aplicación sigue requiriendo Board y herramienta gobernada |
| `EAI-026` | P1 | READY | Desired state técnico de WordPress | Inventariar versiones, plugins, snippets, GTM/caché/CDN y cambios históricos relevantes sin almacenar secretos ni convertir el inventario en autoridad de publicación | Snapshot fechado y redacted, rollback por cambio, checks de drift y ownership claro entre WordPress, repositorio y configuración live |
| `EAI-027` | P2 | READY | Harness funcional y de performance web | Convertir checks históricos de compra, plantillas, Core Web Vitals y regresiones técnicas en pruebas reproducibles con baseline y presupuesto explícito | Smoke funcional read-only y baseline Lighthouse/Web Vitals con entorno, fecha, tolerancias y artefactos; ninguna optimización se aplica automáticamente |

## Dependencias de las nuevas líneas

- Catálogo: `EAI-017 → EAI-018 → EAI-019 → EAI-020 → EAI-021 → EAI-022 → ENK-7`. `EAI-013` permanece como épica y no duplica esos entregables.
- SEO: `EAI-006 → EAI-023`; `EAI-014` agrupa el resultado y la futura ejecución de `ENK-8`.
- SEM: `EAI-006 + EAI-008 + EAI-012 → EAI-024 → EAI-025`.
- Estado técnico web: `EAI-026` puede avanzar sin publicar; `EAI-027` puede construir el baseline sin aplicar optimizaciones.

### Disposición aplicada a `ENK-1`–`ENK-8`

- `ENK-1`: `cancelled`; comentario Board con la razón histórica. Su assignee de prueba continúa terminado.
- `ENK-2`: `backlog`, prioridad alta; contrato de fuentes financieras mínimas con fuentes, entregable y criterio de cierre explícitos (`EAI-008`).
- `ENK-3`: `done`; comentario Board enlaza los smokes `ENK-9` a `ENK-15` y el snapshot sano de conexiones.
- `ENK-4`: `backlog`, prioridad alta; reconciliación de medición orientada a la divergencia GA4/GSC hallada en `ENK-24` (`EAI-006`).
- `ENK-5`: `backlog`, prioridad alta y relación first-class `blocked by ENK-2`; prohíbe calcular rentabilidad sin costes y atribución.
- `ENK-6`: `backlog`; diagnóstico Merchant Center exige evidencia actual y prohíbe tratar DevDocs como estado real (`EAI-012`).
- `ENK-7`: `backlog`; separa auditoría comercial desde export Woo de los packs técnicos estables (`EAI-013`).
- `ENK-8`: `backlog` y relación first-class `blocked by ENK-4`; además exige el workflow editorial v2 antes de ejecución (`EAI-014`).

La reconciliación se aplicó mediante la API Board de Paperclip. Los seis agentes Enki y las dos rutinas permanecieron pausados, los triggers continuaron deshabilitados y no se generó ningún run.

## Reglas del ciclo de feedback

1. El feedback humano y de agentes se conserva primero bajo `enki-editorial-feedback/v1` como observación ligada al issue, documento, revisión y contenido exactos.
2. Los resultados publicados se comparan con la hipótesis original usando periodos cerrados a 7, 28 y 90 días cuando haya volumen suficiente.
3. Una observación no se convierte automáticamente en regla. Se promueve si se repite, evita un riesgo grave o demuestra una mejora con evidencia.
4. Una promoción modifica la mínima superficie adecuada: prompt/contrato, skill, fixture/eval, runbook o conector.
5. Cada regla promovida conserva la evidencia de origen y puede quedar `superseded` si resultados posteriores la contradicen.

## No iniciar todavía

- No redactar ni actualizar el contenido de `ENK-24` hasta cerrar `EAI-006` y obtener una nueva decisión Board explícita bajo el workflow v2; `EAI-002` no autorizó consolidación.
- No habilitar triggers de rutinas.
- No cambiar `CONTENT_PUBLISH_WRITE_MODE` fuera de un canary aprobado y acotado.
- No configurar Facebook/Instagram como un único rollout conjunto.
- No promover a producción ni completar digests por inferencia.
- `EAI-019`–`EAI-021` ya están cerrados, pero no ejecutar `ENK-7` sobre todos los catálogos hasta completar `EAI-022`; el replay histórico acotado demuestra lectura del layout, no autoridad para una auditoría live.

## Registro de cerrados

- 2026-09-01 — `EAI-021` completado: paquete fuente `0.12.0` con `enki-catalog-pipeline` `0.3.0`, contrato estricto de perfil/reporte/auditoría, lectura CSV por posición exacta, identidad simple/padre/variación, ownership de página separado, comparación fiscal EUR explícita, change sets locales idempotentes y auditoría integral del export posterior. El fixture saneado prueba cinco candidatos como dos matches y tres diferencias, además de drift fuera de alcance y fallos cerrados. Un replay efímero conservó solo checksum y agregados de un export histórico Buades de 1.196 filas y 376 columnas: cero filas mal formadas, IDs/SKUs duplicados, roles desconocidos o variaciones huérfanas; el replay inventado produjo dos matches y dos diferencias sin retener valores comerciales ni artefactos. Pasan 127 pruebas del paquete y 38 del runtime de catálogo, además de los gates de conectores, Telegram, secretos, ZIP y Compose. No se generó import ni hubo mutaciones en Paperclip, WooCommerce o conectores live. `EAI-022` pasa a NOW.
- 2026-09-01 — `EAI-020` completado: paquete fuente `0.11.0` con `enki-catalog-pipeline` `0.2.0`, un core geométrico pequeño y cuatro definiciones `enki-catalog-adapter/v1` fijadas por hash para Buades, Enki Espejos, Mundilite y Chicandbath. `row_left_to_right` se promueve al core con evidencia de tres marcas; `matrix_by_headers` permanece local de Chicandbath. El harness ejecuta sin leer `expected` ni `pairing` y compara después con el oracle EAI-019: cuatro adaptadores, seis fixtures, 21/21 pares, cobertura 1, error 0 y pass rate 1. Veinticinco pruebas del runtime cubren determinismo, ownership, hashes, alcance cerrado, geometría, roles y fallos conservadores; el paquete suma 121 pruebas. No se importó v0.11.0, no se procesó ningún PDF/catálogo real, no se generó un import y no hubo mutaciones live. `EAI-021` pasa a NOW.
- 2026-09-01 — `EAI-019` completado: paquete fuente `0.10.0` con schema estricto `enki-catalog-regression-suite/v1`, seis fixtures mínimos saneados de Buades, Enki Espejos, Mundilite y Chicandbath y un CSV Woo con cabeceras duplicadas por posición. Siete riesgos de layout producen exactamente 21 parejas geométricas y 21 observaciones `enki-catalog-field-evidence/v1`; el validador comprueba hashes, cajas, pairing, matrices, conteos, roles, QA y ausencia de rutas, PII o credenciales. Diecisiete pruebas incluyen mutaciones negativas de conteo, geometría, QA, hash y cabeceras. Pasan 116 pruebas del paquete, 8 del runtime PDF, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. Los fixtures contienen únicamente geometría y valores inventados; no hubo import, procesamiento de catálogo real ni mutaciones live. `EAI-020` pasa a NOW.
- 2026-09-01 — `EAI-018` completado: paquete fuente `0.9.0` con schemas estrictos `enki-catalog-run/v1`, `enki-catalog-field-evidence/v1` y `enki-catalog-change-set/v1`; registran fuentes y reglas inmutables, cobertura/frescura del snapshot, geometría PDF o posición CSV exacta, valores crudos/normalizados, identidad Woo separada, confianza, decisión y lineage. Un validador portable cruza hashes, paths, cajas, tipos de localización, fuentes, identidades, columnas, valores, contadores y gates de exportación. El bundle Buades inventado/saneado y diecinueve mutaciones negativas prueban cabeceras duplicadas, snapshot parcial, precisión insuficiente, drift de hash, estados incoherentes, aprobaciones falsas y bloqueo permanente de escrituras externas. El runbook mapea los CSV históricos sin ascender estados legacy a aprobación Board ni conservar paths del host. Pasan 99 pruebas del paquete, 8 del runtime PDF, 63 de conectores y 13 del plugin Telegram, además de secretos, ZIP reproducible y Compose. No hubo import, datos reales ni mutaciones live; `EAI-019` pasa a NOW.
- 2026-09-01 — `EAI-017` completado: paquete fuente `0.8.0` con runtime `enki-catalog-pipeline` `0.1.0`, Python 3.12 y stack permisivo fijado (`pdfplumber 0.11.10`, `pypdfium2 5.13.0`, `Pillow 12.3.0`). El wrapper Docker monta input read-only y output separado, deshabilita red y capacidades, usa root filesystem read-only y no inyecta credenciales. Ocho unit tests cubren 300 dpi, geometría, hashes, rutas lógicas, determinismo byte a byte, no-overwrite y rechazo de Git, symlinks, traversal y nombres de credenciales. Un smoke Docker real produjo 2 páginas y 7 elementos, sin paths del host, y su repetición fue idéntica. También pasan 73 pruebas del paquete, 63 de conectores, 13 del plugin Telegram, secretos, ZIP reproducible y Compose. La imagen base está fijada por digest; el digest de la imagen final se completa únicamente en release bajo `EAI-015`. No hubo import ni mutaciones en Paperclip, conectores o WooCommerce live.
- 2026-09-01 — `EAI-005` completado: paquete fuente `0.7.0` con `enki-editorial-learning`, `enki-editorial-feedback/v1`, `enki-publication-retrospective/v1` y política de promoción humana. El feedback queda ligado a issue/documento/revisión/contenido exactos; el plan se congela antes del live, un draft no inicia el reloj y las ventanas son 7/28/90 días naturales. Datos parciales o insuficientes permanecen inconclusos. Solo Board puede promover la mínima regla portable con evidencia y regresión; repetición exige dos contenidos independientes y una mejora exige evidencia completa a 28 días con comparador. Pasan Ajv estricto, el validador oficial de skills, 73 pruebas del paquete, 63 de conectores, 13 del plugin Telegram, secretos, ZIP reproducible y Compose; no hubo import, runs ni mutaciones live.
- 2026-09-01 — `EAI-004` completado: paquete fuente `0.6.0` con `enki-editorial-planning`, `enki-editorial-brief/v2` y workflow de siete etapas. El fixture saneado de `ENK-24` reproduce C1/C2/C3 como 3,75/3,60/2,60 y conserva C1 solo como investigación. Las pruebas rechazan IDs WordPress usados como identidad Woo, drift entre shortlist y validación, una decisión sobre otra revisión de Ecommerce, sumas manuales incorrectas y decisiones no aplicadas en una revisión posterior. Pasan el validador oficial de skills, el gate completo de 58 pruebas del paquete, 63 pruebas de conectores, 13 del plugin Telegram, secretos, ZIP reproducible y Compose; no hubo cambios live ni mutaciones externas.
- 2026-09-01 — `EAI-002` completado: `ENK-30` Growth (`eai-002-growth-evidence` rev1 `1ad699cb-13b9-4215-802f-1883a86a2540`) cubrió 13/13 canonicals con GSC `page + query` y GA4 exacto y leyó 11/11 artículos; `ENK-31` Ecommerce (`eai-002-ecommerce-validation` rev2 `344e8375-ff1d-49ec-b29e-543da7a1028a`) validó el mismo shortlist y descartó correctamente los IDs editoriales como identidad Woo; `ENK-29` quedó `done` con resumen rev4 `1cc93f9d-03bb-4275-8e40-06fa8a3dafe8`. El brief canónico de `ENK-24` es rev7 `c70ff915-adde-4f80-b39f-a83e36fee9e7`: C1 permanece como prioridad de investigación, la canibalización SERP no está demostrada, las puntuaciones reproducibles son 3,75/3,60/2,60 y ninguna consolidación, redirección, desindexación, reescritura o publicación queda autorizada. Se verificaron cero llamadas a `wordpress_upsert_post`, write mode `disabled`, seis agentes y dos rutinas pausados y ambos triggers deshabilitados.
- 2026-08-31 — `EAI-003` completado: paquete fuente `0.5.1` con secreto de firma independiente, cierre atómico del kill switch y timeout de 60 s para ejecuciones aprobadas; pasan el gate completo del paquete, 126 pruebas del servicio de herramientas y el typecheck TypeScript directo del servidor.
- 2026-08-31 — `EAI-001` completado: `ENK-1` cancelado, `ENK-3` cerrado con evidencia y `ENK-2`/`ENK-4`–`ENK-8` reespecificados; dependencias `ENK-2 → ENK-5` y `ENK-4 → ENK-8` verificadas sin activar trabajo.
- 2026-08-31 — Conectores read-only y Product Support sanos; seis agentes y dos rutinas pausados.
- 2026-08-31 — WordPress dedicado configurado; lectura live validada y canary de draft creado, verificado y retirado. Write mode restaurado a `disabled`.
- 2026-08-31 — `ENK-24` completó delegación, control de calidad y decisión Board sin mutaciones externas; su revisión originó `EAI-002`, `EAI-004` y `EAI-005`.
- 2026-08-31 — Pack técnico Enki Espejos `1.0.0` aprobado y operativo sin duplicar precio ni stock.

## Mantenimiento

Actualizar este documento cuando ocurra cualquiera de estos eventos:

- una decisión Board cambia prioridad o alcance;
- un issue operativo se crea, termina, bloquea o queda superseded;
- un smoke/canary produce una nueva limitación o una evidencia reutilizable;
- cambia el estado de una conexión, rutina, proveedor o promoción;
- una lección se incorpora a código versionado.

En cada actualización se cambia la fecha, el estado, la siguiente acción y la evidencia. No se borran silenciosamente elementos: los terminados pasan al registro de cerrados y los descartados indican la decisión que los supersede.
