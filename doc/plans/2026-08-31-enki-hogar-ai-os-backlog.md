# Enki Hogar AI OS — backlog vivo

Última actualización: 2026-08-31
Rama de trabajo: `feat/enki-hogar-approach`
Paquete actual: `companies/enki-hogar-ai-os/` (`0.5.1`)

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

Snapshot comprobado el 2026-08-31:

- Seis agentes Enki pausados y cero runs activos.
- Dos rutinas pausadas; ambos triggers de calendario están deshabilitados.
- WooCommerce, GA4, GSC, Google Ads, Product Support y Content Publisher están activos y sanos.
- WordPress está configurado en Content Publisher, pero `CONTENT_PUBLISH_WRITE_MODE=disabled`.
- Facebook e Instagram no están configurados.
- No hay plugins instalados; Telegram sigue pendiente de instalación y smoke real.
- Quedan seis issues bootstrap vigentes en backlog: `ENK-2`, `ENK-4`, `ENK-5`, `ENK-6`, `ENK-7` y `ENK-8`. `ENK-1` fue cancelado como onboarding obsoleto y `ENK-3` se cerró con evidencia de los smokes `ENK-9` a `ENK-15`.
- `ENK-5` está bloqueado por `ENK-2`; `ENK-8` está bloqueado por `ENK-4`. Ninguno de los seis issues retenidos se movió a `todo`.
- El hardening operativo queda consolidado como paquete fuente `0.5.1`; la sincronización con el upstream actual sigue separada bajo `EAI-016`.

## Orden inmediato

1. Validar la decisión editorial de `ENK-24` antes de redactar o tocar WordPress.
2. Convertir las lecciones confirmadas en un workflow editorial v2 y un ciclo de feedback versionado.
3. Solo después ejecutar la primera pieza editorial real, que podría ser una consolidación de contenido existente en vez de una URL nueva.

## Backlog priorizado

| ID | Prioridad | Estado | Trabajo | Siguiente acción | Evidencia de cierre |
| --- | --- | --- | --- | --- | --- |
| `EAI-002` | P0 | NOW | Validar C1 de `ENK-24` | Obtener GSC `page + query` para categoría y artículos, exponer el resultado GA4 exacto, leer todos los artículos potencialmente solapados y pedir a Ecommerce que valide los mismos candidatos que Growth | Brief corregido con evidencia por URL/query, cobertura explícita y puntuación recalculada; ninguna escritura WordPress |
| `EAI-004` | P1 | READY | Workflow editorial v2 | Añadir etapa `research → shortlist → candidate validation → Board decision → draft → review → publish`; crear `enki-editorial-planning`, contrato de brief y fixtures derivados de `ENK-24` | Skill, contrato, workflow y pruebas obligan a distinguir categoría/artículo, alinear candidatos entre especialistas y actualizar el documento tras la decisión |
| `EAI-005` | P1 | READY | Ciclo de feedback y aprendizaje | Definir `editorial-feedback` y `publication-retrospective` con feedback humano, revisiones de agentes, hipótesis y resultados a 7/28/90 días | Feedback queda ligado a contenido/revisión; las lecciones recurrentes pueden promoverse a skills/contratos con evidencia y tests |
| `EAI-006` | P1 | READY | Reconciliar medición GA4 | Technology investiga la divergencia GA4/GSC, cobertura de páginas editoriales, consentimiento, eventos e ingresos; Growth documenta qué métricas son utilizables | Baseline de medición con fuentes, limitaciones y consultas reproducibles; se actualizan los contratos afectados |
| `EAI-007` | P1 | BLOCKED | Primera ejecución editorial real | Tras `EAI-002` y `EAI-004`, decidir entre consolidar C1 o elegir otro tema no solapado; producir primero un borrador local y revisión exacta | Borrador y revisión versionados; si Board autoriza canary, WordPress crea un único draft idempotente y se verifica live |
| `EAI-008` | P1 | READY | Datos financieros mínimos | Ejecutar `ENK-2`; mantener `ENK-5` bloqueado hasta disponer del contrato de COGS, fiscalidad, transporte, comisiones, devoluciones y atribución | Contrato de fuentes financieras y lista explícita de métricas disponibles/no disponibles |
| `EAI-009` | P1 | READY | Telegram local | Instalar el plugin, crear secret-ref del bot, fijar user/chat allowlists y ejecutar el smoke bidireccional sin autoridad de aprobación | Mensaje autorizado crea issue/comentario atribuido; reporte llega al chat; PII y decisiones de aprobación siguen bloqueadas |
| `EAI-010` | P2 | BLOCKED | Facebook e Instagram | Configurar credenciales y ejecutar canaries separados; no compartir aprobación ni estado de escritura con WordPress | Cada proveedor supera lectura, aprobación exacta, idempotencia y reconciliación live de forma independiente |
| `EAI-011` | P2 | BLOCKED | Activar rutinas | Requiere backlog limpio, medición reconciliada y varios briefs/revisiones manuales aceptados por Board | Board habilita cada trigger por separado; primer run programado termina correctamente y no crea trabajo duplicado |
| `EAI-012` | P2 | READY | Merchant Center | Ejecutar el `ENK-6` ya reespecificado: verificar la causa actual mediante fuente autorizada y preparar recuperación sin mutaciones automáticas | Diagnóstico fechado, evidencias, acciones humanas y criterios de recuperación; sin tratar DevDocs como estado real |
| `EAI-013` | P2 | READY | Catálogo y soporte técnico | Ejecutar el `ENK-7` ya reespecificado: auditoría desde export Woo fresco y selección del siguiente pack técnico por marca/dominio | Mismatches reproducibles sin duplicar catálogo; pack aprobado e importable con ciclo de supersede/purge completo |
| `EAI-014` | P2 | READY | SEO y adquisición | Ejecutar primero `ENK-4`; después de reconciliar medición y aprobar `EAI-004`, ejecutar `ENK-8` con señales comparables | Backlog priorizado por impacto, confianza, esfuerzo y riesgo; consultas y periodos reproducibles |
| `EAI-015` | P3 | LATER | Promoción a producción | Elegir infraestructura, fijar tag/commit, digests OCI y SHA-256 del ZIP; probar import pausado, backup, restore, smoke y rollback | Todos los campos de `runtime/compatibility.lock.yaml` completos y evidencia de restauración/promoción |
| `EAI-016` | P3 | LATER | Sincronización con upstream Paperclip | Probar periódicamente `upstream/master` en una rama de sync, resolver conflictos allí y ejecutar gates antes de integrar en Enki | Merge de upstream aislado, verificado y documentado; nunca se experimenta directamente sobre la rama operativa |

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

1. El feedback humano y de agentes se conserva primero como observación ligada al issue, documento y revisión exactos.
2. Los resultados publicados se comparan con la hipótesis original usando periodos cerrados a 7, 28 y 90 días cuando haya volumen suficiente.
3. Una observación no se convierte automáticamente en regla. Se promueve si se repite, evita un riesgo grave o demuestra una mejora con evidencia.
4. Una promoción modifica la mínima superficie adecuada: prompt/contrato, skill, fixture/eval, runbook o conector.
5. Cada regla promovida conserva la evidencia de origen y puede quedar `superseded` si resultados posteriores la contradicen.

## No iniciar todavía

- No redactar ni actualizar el contenido elegido en `ENK-24` hasta cerrar `EAI-002`.
- No habilitar triggers de rutinas.
- No cambiar `CONTENT_PUBLISH_WRITE_MODE` fuera de un canary aprobado y acotado.
- No configurar Facebook/Instagram como un único rollout conjunto.
- No promover a producción ni completar digests por inferencia.

## Registro de cerrados

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
