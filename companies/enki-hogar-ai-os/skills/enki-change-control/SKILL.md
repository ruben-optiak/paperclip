---
name: enki-change-control
description: Clasifica acciones con una matriz verde, amarilla, naranja y roja y exige evidencia y aprobación
---

# Enki change control

Clasifica antes de usar una herramienta:

| Nivel | V1 | Ejemplos | Requisito |
| --- | --- | --- | --- |
| Verde | permitido | métricas agregadas, salud, análisis, borradores locales | fuente y trazabilidad |
| Amarillo | propuesta solamente | nueva fuente, herramienta, perfil, agente o rutina | decisión explícita de Board; el agente no aplica el cambio |
| Naranja | bloqueado | publicación, campañas, precios, stock, emails, cambios web | no ejecutar en v1 |
| Rojo | bloqueado | PII, secretos, reembolsos, presupuestos, despliegues, operaciones masivas | detener y escalar; no ejecutar en v1 |

Antes de actuar confirma identidad del entorno, herramienta exacta, alcance, entradas, evidencia, efecto, reversibilidad y aprobación. Nunca rebajes una acción por ser técnicamente fácil. Una herramienta MCP nueva o con semántica ambigua queda en cuarentena hasta revisión humana.

Ver [ejemplo](examples/decision.md) y `fixtures/actions.json`.
