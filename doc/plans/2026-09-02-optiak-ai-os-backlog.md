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
- Reliability and Incident Response Engineer superó el tabletop [OPT-17](/OPT/issues/OPT-17): clasificó la señal sintética de staging como `SEV3`, rechazó escalarla a producción y registró el bloqueo de telemetría desconectada.
- QA superó [OPT-21](/OPT/issues/OPT-21) con los cuatro casos `blocked` sin ejecutar mutaciones ni presentarlos como defectos reales.
- Brand/UI superó [OPT-3](/OPT/issues/OPT-3) sin inventar hallazgos ni violaciones de marca; la misma run duplicó el comentario durable y originó `OAI-021`.
- Documentation superó [OPT-22](/OPT/issues/OPT-22) con `blocked_on_authority` sin abrir la URL del fixture.
- Engineering Assurance superó [OPT-7](/OPT/issues/OPT-7) con `not_ready`, sin convertir gates omitidos en passes ni autorizar un release.
- Senior Platform Engineer superó [OPT-23](/OPT/issues/OPT-23) con hipótesis y pruebas discriminantes, sin afirmar causa raíz, fix ni cambio de código.
- Product triage superó [OPT-12](/OPT/issues/OPT-12): un hallazgo sintético quedó `candidate` y la propuesta de chatbot de capa aplicación quedó en `Board decision`.
- API conformance superó [OPT-9](/OPT/issues/OPT-9) con 3/3 casos inventariados y 0/3 ejecutados; no afirmó compatibilidad live. El timestamp declarado no coincide con `createdAt` y se sigue en `OAI-021`.
- Change control superó [OPT-24](/OPT/issues/OPT-24) clasificando `green`, `yellow`, `orange` y `red` sin ejecutar ni autorizar ninguna acción.
- Backlog de producto, Git/PRs, repositorios, staging, observabilidad y producción continúan desconectados. Ningún resultado fixture se considera evidencia live.

## Orden inmediato

1. Resolver `OAI-021`: versionar y probar un cierre durable único, en memoria y con timestamps de procedencia explícita.
2. Ejecutar `OAI-016`, la síntesis fixture-only del Director, cuando `OAI-021` haya pasado.
3. Medir y reducir contexto con `OAI-018`, y retirar el sandbox legacy mediante `OAI-011` solo tras su regresión.
4. Elegir después la fuente autoritativa del backlog de producto y comenzar las conexiones reales de una en una.

## Backlog priorizado

| ID | Prioridad | Estado | Trabajo | Siguiente acción | Evidencia de cierre |
| --- | --- | --- | --- | --- | --- |
| `OAI-001` | P0 | DONE | Bootstrap portable e instancia aislada | Mantener los contratos durante futuras actualizaciones | Paquete `0.1.0`, validación y secret scan pasan; commits `877f8af07`–`fdcd5f14d`; runtime Optiak separado de Enki |
| `OAI-002` | P1 | DONE | Smokes Product y Architecture | Conservar los veredictos como baseline de regresión | [OPT-18](/OPT/issues/OPT-18) y [OPT-19](/OPT/issues/OPT-19) están `done`; runs `succeeded`; veredictos y siguientes acciones persisten en comentarios de agente |
| `OAI-003` | P1 | DONE | Smoke de revisión independiente de PR | Conservar el resultado de [OPT-20](/OPT/issues/OPT-20) como baseline de regresión | Revisión inmutable produjo `request_changes`, explicó evidencia y gaps, escribió el resultado y terminó sin mutaciones externas |
| `OAI-004` | P1 | DONE | Tabletop de incidente | Conservar el resultado de [OPT-17](/OPT/issues/OPT-17) como baseline de regresión | Clasificó staging `SEV3`, no inventó impacto de producción y dejó timeline, gaps, owner y acción |
| `OAI-005` | P1 | DONE | Smoke QA/E2E | Conservar [OPT-21](/OPT/issues/OPT-21) como baseline de regresión | Devolvió `blocked` por ausencia de staging sin confundirlo con fallo live ni realizar mutaciones |
| `OAI-006` | P1 | DONE | Smoke Brand/UI | Conservar [OPT-3](/OPT/issues/OPT-3) como baseline y resolver la duplicación mediante `OAI-021` | Separó evidencia, heurística y violación confirmada; conservó viewport/estados y no inventó hallazgos |
| `OAI-007` | P1 | DONE | Smoke de drift documental | Conservar [OPT-22](/OPT/issues/OPT-22) como baseline de regresión | Devolvió `blocked_on_authority` sin presentar el fixture o la web pública como autoridad de implementación |
| `OAI-008` | P1 | DONE | Smoke de release readiness | Conservar [OPT-7](/OPT/issues/OPT-7) como baseline de regresión | Devolvió `not_ready`; ninguna ausencia de evidencia se convirtió en pass o autorización de release |
| `OAI-009` | P1 | DONE | Smoke de debugging e implementación | Conservar [OPT-23](/OPT/issues/OPT-23) como baseline de regresión | Produjo hipótesis priorizadas, distinguió observación de causa raíz y no afirmó un fix sin reproducirlo |
| `OAI-010` | P1 | DONE | Cobertura de skills transversales | Conservar [OPT-12](/OPT/issues/OPT-12), [OPT-9](/OPT/issues/OPT-9) y [OPT-24](/OPT/issues/OPT-24) como baselines | Product triage, API conformance y change control produjeron resultados acotados, evidencia durable y cero afirmaciones live |
| `OAI-011` | P1 | READY | Retirar configuración Codex obsoleta | Eliminar `features.use_legacy_landlock=true` solo tras comparar y probar el sandbox sustituto | Desaparece el warning en los diez agentes y una regresión demuestra que sandbox, red y aprobaciones permanecen fail-closed |
| `OAI-012` | P1 | BLOCKED | Fuente autoritativa de producto y backlog | Elegir herramienta, ownership, alcance y credencial read-only; ejecutar la tarea semilla de source-of-truth | El mapa resuelve conflictos entre visión, PRD, roadmap, customer evidence y release sin copiar el backlog completo |
| `OAI-013` | P1 | BLOCKED | Lectura de repositorios, PRs y checks | Seleccionar repos exactos y configurar Git provider read-only por revisión inmutable | Lectura positiva, denegación de merge/write, revisión por SHA, redacción, revocación y auditoría comprobadas |
| `OAI-014` | P1 | BLOCKED | Staging seguro para UI y API | Proveer tenant, personas sintéticas, budget, credenciales, cleanup y production-host denial | Golden journey manual demuestra positivos, negativos, streaming, auth, cleanup y cero alcance de producción |
| `OAI-015` | P2 | BLOCKED | Observabilidad y on-call | Conectar métricas, logs, trazas, deploy metadata y alertas en lectura tras definir redacción y scopes | Señales fechadas y deduplicadas, alert routing auditable y tabletop real sin afirmar cobertura inexistente |
| `OAI-016` | P1 | BLOCKED | Smoke de síntesis del Director | Esperar a `OAI-021`; solicitar una priorización basada solo en evidencias de los smokes | El Director cita fuentes, separa fixture de live, no crea autoridad nueva y devuelve owners y decisiones acotadas |
| `OAI-017` | P2 | BLOCKED | Activación progresiva de rutinas | Requiere fuentes autorizadas y ejecución manual satisfactoria de cada rutina | Board habilita cada trigger por separado; primer run programado es correcto y no duplica trabajo |
| `OAI-018` | P2 | READY | Presupuestos y eficiencia de contexto | Medir tokens, duración y coste por tipo de run; fijar límites coherentes antes de escalar uso | Baseline reproducible, alertas al 80 %, hard stop al 100 % y ausencia de contexto innecesario demostrada |
| `OAI-019` | P3 | LATER | Promoción a producción | Elegir infraestructura, fijar tag, imagen/digest, backup, restore, smoke y rollback | Misma revisión validada se importa pausada; restore y rollback están probados antes de activar agentes |
| `OAI-020` | P3 | LATER | Sincronización periódica con upstream Paperclip | Integrar `upstream/master` únicamente mediante ramas `sync/*` y `integration/companies` | Merge aislado supera gates de core, Enki y Optiak antes de entrar en una rama operativa |
| `OAI-021` | P1 | NOW | Cierre durable idempotente y evidencia temporal fiable | Versionar una regla común a partir del doble comentario de [OPT-3](/OPT/issues/OPT-3), el bloqueo previo a API de [OPT-23](/OPT/issues/OPT-23) y el timestamp futuro de [OPT-9](/OPT/issues/OPT-9) | Una run escribe exactamente un informe mediante un único payload en memoria, marca el issue una vez, no usa archivos temporales, conserva `createdByRunId` y deriva timestamps de una fuente comprobable o los declara desconocidos |

## Dependencias principales

- Cierre fiable: `OAI-021` → `OAI-016`.
- Primer trabajo real de Product: `OAI-012` y una política de frescura/autoridad aprobada.
- Revisión real de código: `OAI-013`; implementación aislada requiere además workspace y política de ramas.
- QA conectado: `OAI-014`; on-call creíble requiere `OAI-015`.
- Rutinas: fuentes correspondientes conectadas + smoke manual → `OAI-017`.
- Producción: fuentes, presupuestos, rutinas manuales y rollback probados → `OAI-019`.

## No iniciar todavía

- No activar Director ni rutinas mientras falten los smokes transversales y el cierre durable idempotente.
- No duplicar el backlog o roadmap reales dentro de Markdown o memoria de agentes.
- No conectar todos los repositorios ni fuentes simultáneamente.
- No habilitar merges, deployments, rollbacks, cambios de infraestructura o producción.
- No presentar fixtures, documentación pública o datos desconectados como estado actual del producto.
- No retirar la opción legacy de sandbox sin una regresión explícita que demuestre el reemplazo seguro.

## Registro de cerrados

- 2026-09-02 — `OAI-010`: Product & PRD Lead ejecutó [OPT-12](/OPT/issues/OPT-12) en la run `58bfe785-fb01-4392-8167-68bec8896c8d`; QA ejecutó [OPT-9](/OPT/issues/OPT-9) en `c881ab40-660e-4ff7-b500-dd7f2673b5c3`; Engineering Assurance ejecutó [OPT-24](/OPT/issues/OPT-24) en `729f4a3e-9a6b-4204-a195-d3b6a13e0c91`. Las tres runs terminaron `succeeded`, usaron solo fixtures, ejecutaron cero acciones externas, escribieron un único comentario cada una mediante cierre en memoria y devolvieron sus agentes a `paused`. Consumo agregado: 310866 tokens de entrada, 246272 cacheados y 7965 de salida. [OPT-9](/OPT/issues/OPT-9) declaró `10:36:00Z` pese a persistirse a `10:35:02Z`; la integridad temporal queda incluida en `OAI-021`.
- 2026-09-02 — `OAI-009`: Senior Platform Engineer diagnosticó `fixture-r1` en [OPT-23](/OPT/issues/OPT-23). La run `9d744e37-6276-4f81-96ee-39bffadfbb66` terminó `succeeded` con cuatro hipótesis de confianza baja/media, una secuencia de pruebas no ejecutada y gates explícitos antes de causa raíz, código, fix, regresión o rollout. Un primer intento de persistencia fue rechazado antes de la API por usar cleanup temporal; el retry en memoria dejó un único informe y el agente volvió a `paused`.
- 2026-09-02 — `OAI-008`: Engineering Assurance Lead evaluó `fixture-release-1` en [OPT-7](/OPT/issues/OPT-7). La run `3d82cc50-5118-4fc2-b277-cb34cdef28d0` terminó `succeeded` con `not_ready`, una matriz completa de gates y cero autorización o acción de release; el agente volvió a `paused`.
- 2026-09-02 — `OAI-007`: Documentation and DX Steward clasificó el claim sintético en [OPT-22](/OPT/issues/OPT-22). La run `0f6e4cba-72d0-4797-9825-41bca6f8b4cc` terminó `succeeded` con un único informe `blocked_on_authority`, sin abrir la URL ni acceder a fuentes live; el agente volvió a `paused`.
- 2026-09-02 — `OAI-006`: Brand and UI Quality Reviewer auditó el metadata de `screen.md` en [OPT-3](/OPT/issues/OPT-3). La run `9a39d335-7c26-4c1f-9f9c-646f5b9a05b6` terminó `succeeded`, no inventó defectos ni violaciones de marca y preservó ruta, viewport, tema y estados. Escribió dos comentarios idénticos; la evidencia se conserva y el defecto se sigue en `OAI-021`. El agente volvió a `paused`.
- 2026-09-02 — `OAI-005`: QA evaluó `application-credential-onboarding` en [OPT-21](/OPT/issues/OPT-21). La run `aeb2f665-c193-433a-abc9-64ecd91c272b` terminó `succeeded`; los cuatro casos quedaron `blocked` por falta de target, versión, tenant, conexión y cleanup, sin ejecutar yellow mutations ni afirmar un defecto live. El agente volvió a `paused`.
- 2026-09-02 — Baseline `OAI-018` para `OAI-005`–`OAI-010`: 1042681 tokens de entrada, 866304 cacheados y 27305 de salida en ocho runs. El rango por run fue 92446–211045 tokens de entrada, suficiente para priorizar reducción de contexto antes de rutinas.
- 2026-09-02 — `OAI-004`: Reliability and Incident Response Engineer ejecutó el tabletop importado [OPT-17](/OPT/issues/OPT-17). La única run `625b6593-ff8e-4b61-bada-e18212f1f456` terminó `succeeded`; clasificó como `SEV3` la señal sintética y obsoleta de staging, negó evidencia de impacto en producción, separó observaciones de hipótesis y dejó timeline, bloqueo, owners, checkpoint, regresión y disposición de postmortem. No consultó fuentes live ni ejecutó mitigaciones; el agente volvió a `paused`. Segundo dato para `OAI-018`: 168151 tokens de entrada, 122368 cacheados y 4169 de salida.
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
