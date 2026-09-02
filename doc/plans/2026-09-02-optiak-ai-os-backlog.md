# Optiak AI OS — backlog vivo

Última actualización: 2026-09-02
Rama de trabajo: `feat/optiak/bootstrap`
Paquete actual: `companies/optiak-ai-os/` (`0.1.0`)

## Propósito

Este documento es la lista versionada y priorizada para construir, validar y evolucionar Optiak AI OS. Registra cambios de organización, contratos, skills, fixtures, conectores, seguridad, costes, promoción y aprendizaje que deben sobrevivir entre instancias.

Hay tres capas separadas:

- Este backlog usa identificadores `OAI-*` y es la fuente de verdad para la evolución del AI OS.
- Paperclip Issues usa identificadores `OPT-*` para ejecutar trabajo, conservar comentarios, documentos, runs, revisiones y aprobaciones.
- El roadmap y backlog reales del producto Optiak permanecen en su herramienta autoritativa. Cuando se conecten, será inicialmente en lectura y no se copiarán aquí como una segunda fuente de verdad.

Un elemento `OAI-*` no se considera iniciado solo porque exista un issue, ni terminado porque un agente lo afirme. Debe enlazar evidencia verificable. Las lecciones reutilizables de un smoke o una fuente real se convierten en la mínima superficie versionada adecuada: contrato, skill, fixture, test, política o runbook.

## Estados

- `NOW`: siguiente trabajo; no debe haber más de tres elementos simultáneos.
- `READY`: definido y sin bloqueo, pero no es el siguiente.
- `BLOCKED`: necesita una decisión, conexión, credencial, evidencia o dependencia explícita.
- `LATER`: válido, pero deliberadamente pospuesto.
- `DONE`: terminado con evidencia; se conserva en el registro de cerrados.

## Estado observado de la instancia

Snapshot comprobado el 2026-09-02:

- El corte validado de bootstrap anterior a este backlog es `fdcd5f14d`.
- La instancia Optiak está aislada de Enki mediante Compose, almacenamiento, namespace de instancia, secreto de sesión y puerto propios.
- Diez agentes están pausados, hay cero runs activos y las cuatro rutinas conservan todos sus triggers deshabilitados.
- Las doce skills incluyen fixtures Markdown portables y el preview CLI los transporta sin errores.
- El navegador y la CLI del host usan el puerto `3200`; agentes y MCP administrado usan el listener interno `3100`.
- Product & PRD Lead superó el smoke [OPT-18](/OPT/issues/OPT-18) con veredicto `changes_required` y escritura durable confirmada.
- Principal Platform Architect superó el smoke [OPT-19](/OPT/issues/OPT-19) con veredicto `changes_required` y escritura durable confirmada.
- Independent Code and PR Reviewer superó el smoke [OPT-20](/OPT/issues/OPT-20) con veredicto `request_changes`, revisión por revisión inmutable y escritura durable confirmada.
- Backlog de producto, Git/PRs, repositorios, staging, observabilidad y producción continúan desconectados. Ningún resultado fixture se considera evidencia live.

## Orden inmediato

1. Ejecutar `OAI-004`, el tabletop fixture-only de incidente, y devolver el agente a `paused`.
2. Continuar los smokes fixture-only de QA, Brand/UI, Docs y Release Readiness, siempre uno por uno.
3. Cubrir Senior Platform Engineer y las skills transversales que no aparecen en el smoke mínimo.
4. Ejecutar una síntesis fixture-only del Director únicamente cuando todos los especialistas hayan pasado.
5. Elegir después la fuente autoritativa del backlog de producto y comenzar las conexiones reales de una en una.

## Backlog priorizado

| ID | Prioridad | Estado | Trabajo | Siguiente acción | Evidencia de cierre |
| --- | --- | --- | --- | --- | --- |
| `OAI-001` | P0 | DONE | Bootstrap portable e instancia aislada | Mantener los contratos durante futuras actualizaciones | Paquete `0.1.0`, validación y secret scan pasan; commits `877f8af07`–`fdcd5f14d`; runtime Optiak separado de Enki |
| `OAI-002` | P1 | DONE | Smokes Product y Architecture | Conservar los veredictos como baseline de regresión | [OPT-18](/OPT/issues/OPT-18) y [OPT-19](/OPT/issues/OPT-19) están `done`; runs `succeeded`; veredictos y siguientes acciones persisten en comentarios de agente |
| `OAI-003` | P1 | DONE | Smoke de revisión independiente de PR | Conservar el resultado de [OPT-20](/OPT/issues/OPT-20) como baseline de regresión | Revisión inmutable produjo `request_changes`, explicó evidencia y gaps, escribió el resultado y terminó sin mutaciones externas |
| `OAI-004` | P1 | NOW | Tabletop de incidente | Ejecutar `optiak-incident-triage` contra `references/fixtures/alert.md` | Clasifica staging `SEV3`, no inventa impacto de producción y deja timeline, gaps, owner y acción |
| `OAI-005` | P1 | READY | Smoke QA/E2E | Ejecutar `optiak-e2e-validation` contra `references/fixtures/journey.md` | Devuelve `blocked` por ausencia de staging sin confundirlo con fallo live ni realizar mutaciones |
| `OAI-006` | P1 | READY | Smoke Brand/UI | Ejecutar `optiak-ui-audit` contra `references/fixtures/screen.md` | Separa heurística/inconsistencia de una violación de marca confirmada y conserva viewport, estados y evidencia |
| `OAI-007` | P1 | READY | Smoke de drift documental | Ejecutar `optiak-docs-drift` contra `references/fixtures/claims.md` | Devuelve `blocked_on_authority` sin presentar el fixture o la web pública como autoridad de implementación |
| `OAI-008` | P1 | READY | Smoke de release readiness | Ejecutar `optiak-release-readiness` contra `references/fixtures/release.md` | Devuelve `not_ready`; ninguna ausencia de evidencia se convierte en pass o autorización de release |
| `OAI-009` | P1 | READY | Smoke de debugging e implementación | Probar Senior Platform Engineer con `optiak-debugging/references/fixtures/bug.md` | Produce hipótesis priorizadas, distingue observación de causa raíz y no afirma un fix sin reproducirlo |
| `OAI-010` | P1 | READY | Cobertura de skills transversales | Diseñar smokes acotados para product triage, API conformance y change control | Cada una tiene resultado esperado, caso negativo, evidencia durable y cero afirmaciones live |
| `OAI-011` | P1 | READY | Retirar configuración Codex obsoleta | Eliminar `features.use_legacy_landlock=true` solo tras comparar y probar el sandbox sustituto | Desaparece el warning en los diez agentes y una regresión demuestra que sandbox, red y aprobaciones permanecen fail-closed |
| `OAI-012` | P1 | BLOCKED | Fuente autoritativa de producto y backlog | Elegir herramienta, ownership, alcance y credencial read-only; ejecutar la tarea semilla de source-of-truth | El mapa resuelve conflictos entre visión, PRD, roadmap, customer evidence y release sin copiar el backlog completo |
| `OAI-013` | P1 | BLOCKED | Lectura de repositorios, PRs y checks | Seleccionar repos exactos y configurar Git provider read-only por revisión inmutable | Lectura positiva, denegación de merge/write, revisión por SHA, redacción, revocación y auditoría comprobadas |
| `OAI-014` | P1 | BLOCKED | Staging seguro para UI y API | Proveer tenant, personas sintéticas, budget, credenciales, cleanup y production-host denial | Golden journey manual demuestra positivos, negativos, streaming, auth, cleanup y cero alcance de producción |
| `OAI-015` | P2 | BLOCKED | Observabilidad y on-call | Conectar métricas, logs, trazas, deploy metadata y alertas en lectura tras definir redacción y scopes | Señales fechadas y deduplicadas, alert routing auditable y tabletop real sin afirmar cobertura inexistente |
| `OAI-016` | P1 | BLOCKED | Smoke de síntesis del Director | Esperar a `OAI-004`–`OAI-010`; solicitar una priorización basada solo en evidencias de esos issues | El Director cita fuentes, separa fixture de live, no crea autoridad nueva y devuelve owners y decisiones acotadas |
| `OAI-017` | P2 | BLOCKED | Activación progresiva de rutinas | Requiere fuentes autorizadas y ejecución manual satisfactoria de cada rutina | Board habilita cada trigger por separado; primer run programado es correcto y no duplica trabajo |
| `OAI-018` | P2 | READY | Presupuestos y eficiencia de contexto | Medir tokens, duración y coste por tipo de run; fijar límites coherentes antes de escalar uso | Baseline reproducible, alertas al 80 %, hard stop al 100 % y ausencia de contexto innecesario demostrada |
| `OAI-019` | P3 | LATER | Promoción a producción | Elegir infraestructura, fijar tag, imagen/digest, backup, restore, smoke y rollback | Misma revisión validada se importa pausada; restore y rollback están probados antes de activar agentes |
| `OAI-020` | P3 | LATER | Sincronización periódica con upstream Paperclip | Integrar `upstream/master` únicamente mediante ramas `sync/*` y `integration/companies` | Merge aislado supera gates de core, Enki y Optiak antes de entrar en una rama operativa |

## Dependencias principales

- Validación fixture: `OAI-003`–`OAI-010` → `OAI-016`.
- Primer trabajo real de Product: `OAI-012` y una política de frescura/autoridad aprobada.
- Revisión real de código: `OAI-013`; implementación aislada requiere además workspace y política de ramas.
- QA conectado: `OAI-014`; on-call creíble requiere `OAI-015`.
- Rutinas: fuentes correspondientes conectadas + smoke manual → `OAI-017`.
- Producción: fuentes, presupuestos, rutinas manuales y rollback probados → `OAI-019`.

## No iniciar todavía

- No activar Director ni rutinas mientras falten los smokes especialistas.
- No duplicar el backlog o roadmap reales dentro de Markdown o memoria de agentes.
- No conectar todos los repositorios ni fuentes simultáneamente.
- No habilitar merges, deployments, rollbacks, cambios de infraestructura o producción.
- No presentar fixtures, documentación pública o datos desconectados como estado actual del producto.
- No retirar la opción legacy de sandbox sin una regresión explícita que demuestre el reemplazo seguro.

## Registro de cerrados

- 2026-09-02 — `OAI-003`: Independent Code and PR Reviewer revisó `fixture-sha-001` en [OPT-20](/OPT/issues/OPT-20). La única run `fd700125-3b40-4f6f-9c69-91e9ef0f3036` terminó `succeeded` y dejó `request_changes` por falta de evidencia de aislamiento entre tenants, contrato seguro de retry/streaming y diff/tests reproducibles. No usó fuentes live ni realizó mutaciones externas; el agente volvió a `paused`. El run deja además un primer dato para `OAI-018`: 118096 tokens de entrada, 93952 cacheados y 1984 de salida.
- 2026-09-02 — `OAI-002`: Product revisó `sample-1` en [OPT-18](/OPT/issues/OPT-18); Architecture revisó `rfc-sample-1` en [OPT-19](/OPT/issues/OPT-19). Ambos runs terminaron `succeeded`, escribieron comentarios durables, no usaron fuentes live ni realizaron mutaciones externas y los agentes volvieron a `paused`.
- 2026-09-02 — `OAI-001`: creada la compañía portable de diez agentes, doce skills, seis proyectos, veintiuna tareas y cuatro rutinas pausadas. La instancia local queda aislada en el puerto `3200`; fixtures e API interna fueron corregidos y probados sin tocar Enki.

## Mantenimiento

Actualizar este documento cuando ocurra cualquiera de estos eventos:

- se crea, termina, bloquea o reemplaza un issue operativo `OPT-*` ligado a un `OAI-*`;
- un smoke, incidente, revisión o fuente real produce una limitación o lección reutilizable;
- cambia una prioridad, dependencia, conexión, credencial, rutina, presupuesto o criterio de promoción;
- una lección se incorpora a código versionado.

En cada actualización se cambia la fecha, el estado, la siguiente acción y la evidencia. Los elementos terminados permanecen en el registro de cerrados; los descartados indican qué decisión o elemento los reemplazó.
