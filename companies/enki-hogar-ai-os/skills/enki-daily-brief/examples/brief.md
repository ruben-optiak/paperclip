# Ejemplo resumido

**Corte:** 2026-08-28 08:00 Europe/Madrid. **Periodo:** 2026-08-27.

| Fuente | Periodo | Frescura | Calidad |
| --- | --- | --- | --- |
| WooCommerce | 2026-08-27 | 15 min | ok |
| GA4 | 2026-08-27 | retraso esperado 24 h | partial |
| GSC | 2026-08-25 | retraso esperado 2-3 días | ok |
| Ads | 2026-08-27 | 3 h | ok |

Alerta: el ROAS observado no puede convertirse en beneficio porque falta COGS. Decisión pendiente: confirmar fuente de coste antes de ajustar presupuesto. Propuesta: Finance valida el modelo; Growth no modifica campañas.

Cada fila procede de un `enki-evidence-envelope/v1`. WooCommerce lo entrega nativamente; GA4, GSC y Ads se envuelven en la capa Enki inmediatamente después de la consulta. Una respuesta cruda o el formato legado `name/observed_at/quality` se rechazan antes de construir el brief.
