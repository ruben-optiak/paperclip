# EAI-029 — advertencias de sitemap y límite verificable de GSC

Fecha: 2026-09-12. Ticket operativo: `ENK-33`.
**Diagnóstico acotado completado; causas individuales no disponibles ni corregidas.**

La lectura autorizada muestra ahora **60 advertencias**, frente a las 61 del
baseline. El conector no proporciona sus mensajes ni URLs afectadas. No es
posible explicar cada advertencia con el catálogo actual. El entregable es
esta comprobación y su límite demostrado, no una auditoría causal completa.
La [evidencia saneada](sitemap-warning-evidence-2026-09-12.json) conserva el
texto MCP exacto, catálogo, procedencia, comparación y campos desconocidos.

## Lectura actual frente al baseline

Propiedad: `sc-domain:enkihogar.com`. Ambas observaciones corresponden a
`https://www.enkihogar.com/sitemap_index.xml`. Todas las horas de esta tabla
son UTC, no un periodo analítico de GSC.

| Campo | Baseline restaurado | Lectura EAI-029 |
| --- | --- | --- |
| Consulta del conector | 2026-09-12 12:31:34.636 | 2026-09-12 14:30:55.514 |
| Última descarga declarada por Google | 2026-09-02 01:49:53.797 | 2026-09-12 13:16:23.855 |
| Último envío declarado | 2025-06-30 06:50:08.118 | Sin cambio |
| Advertencias mostradas | 61 | 60 |
| Errores mostrados | 0 | 0 |
| Mensajes y URLs de las advertencias | No disponibles | No disponibles |

Hay un contador una unidad menor y una fecha de descarga posterior. No
podemos identificar qué advertencia desapareció, afirmar que se corrigiera
una causa o atribuir el cambio a nuestro trabajo. No enviamos sitemaps ni
solicitamos rastreo. El baseline se conserva sin reescribirlo.

Google define las advertencias como incidencias generalmente no críticas
de URLs y los errores como problemas del sitemap que impiden procesarlo
correctamente. Son contadores distintos: 60 advertencias no significan
60 errores ni necesariamente 60 URLs diferentes.
([Recurso Sitemaps de Google](https://developers.google.com/webmaster-tools/v1/sitemaps)).

### Datos que no deben utilizarse como cobertura de indexación

La respuesta muestra `web: 789 submitted, 0 indexed` e
`image: 673 submitted, 0 indexed`. El campo `contents.indexed` está obsoleto
en la API y no debe utilizarse. Además, el conector sustituye su ausencia
por cero. **No hay evidencia de que Enki tenga cero páginas indexadas.**
Los 789 y 673 son contadores de tipos de contenido diferentes; no se suman
para obtener páginas únicas. ([Contrato oficial](https://developers.google.com/webmaster-tools/v1/sitemaps)).

También hay pérdida de información en el formato del conector:

- `Errors: 0` puede proceder de un cero del proveedor o de un campo omitido;
  el texto MCP no permite distinguirlos. El 60 positivo de warnings no
  procede de ese valor por defecto. Conservamos «0 mostrado», no una
  garantía independiente de ausencia de errores.
- `Type: Unknown` puede ser un valor por defecto. `isPending` e
  `isSitemapsIndex` no se exponen: permanecen desconocidos, no `false`.
- Las 19 inspecciones del baseline siguen siendo observaciones puntuales
  anteriores, no cobertura exhaustiva ni localización de estas advertencias.

## Dónde se pierde el detalle

Se contrastó el catálogo publicado con la allowlist y el código instalado
de `@jlnkrth/gsc-mcp-server@1.1.0`, archivo `src/tools.js`. Su SHA-256 está
en la evidencia. No se leyó configuración OAuth ni se cambiaron servicios.

| Capa | Capacidad comprobada | Límite |
| --- | --- | --- |
| MCP autorizado | `gsc_list_sitemaps` acepta únicamente `site_url` | Sin filtro de índice, mensajes o lista de URLs afectadas |
| Implementación instalada | Llama a `sitemaps.list({ siteUrl })` y formatea metadatos/contadores | No reenvía `sitemapIndex`; omite dos indicadores y aplica valores por defecto |
| API documentada de Google | Permite `sitemapIndex` para listar entradas de un índice | El recurso documentado sigue sin campos de mensajes o URLs de advertencias |
| Captura SEO local | Extrae URL, fechas y contadores del texto MCP | No puede recuperar información que nunca recibió |

El parámetro de desglose existe en la
[API Sitemaps: list](https://developers.google.com/webmaster-tools/v1/sitemaps/list),
pero no en la herramienta instalada. No lo enviamos como argumento oculto
ni llamamos directamente a Google con las credenciales del conector.

Las otras herramientas autorizadas tampoco enumeran advertencias:
`gsc_list_sites` lista propiedades, `gsc_search_analytics` mide rendimiento
y `gsc_inspect_url` inspecciona URLs concretas. Esta última puede mostrar
`Referring sitemaps` en su formato de origen, aunque el decoder SEO actual
no lo conserva. Esa referencia no prueba que la URL cause una advertencia.
No se repitieron inspecciones ni un rastreo público completo para presentar
conjeturas como mensajes reales de Google.

## Hallazgos separados, no causas demostradas

El [baseline SEO](../../runbooks/seo-pipeline.md) ya observó una regla robots
que coincide con el sitemap de marcas, `/manage-profile/` con `noindex` y
Estanterías desconocida para Google. Ninguno viene unido a un mensaje de
las 61 advertencias anteriores o las 60 actuales. No se propone quitar el
`noindex` del perfil, abrir robots ni cambiar sitemaps a partir del contador.

## Siguiente lectura propuesta, no ejecutada

La vía mínima es una captura/export aportada por el operador o autorización
explícita para consultar, en modo solo lectura, el detalle del sitemap de
esta propiedad en Search Console. Registrar propiedad, URL exacta, última
lectura, estado, mensajes, líneas/ejemplos y sitemaps hijos **si aparecen**.

Google documenta páginas de detalle y errores desplegables en su
[informe de sitemaps](https://support.google.com/webmasters/answer/7451001?hl=en).
Eso no garantiza que la UI actual muestre los 60 mensajes del contador de
advertencias de la API: no hemos inspeccionado esa UI. Si tampoco los
expone, el recibo debe decirlo y no presentar otro informe como equivalente.
No pulsar envío, eliminación, solicitud de indexación ni prueba en directo.

Una alternativa técnica sería proponer y revisar la exposición de
`sitemapIndex` en el MCP para acotar contadores por hijo. No se ha
implementado ni autorizado y, por sí sola, no aportaría campos de mensajes
ausentes del recurso documentado. Cualquier modificación posterior de
web/robots/sitemap exige su propia evidencia y aprobación exacta.

## Alcance de verificación

- Una lectura de proveedor (`gsc_list_sitemaps`) satisfactoria; dos lecturas
  de catálogo, una inicial y otra conservada con el recibo.
- Sin API directa, UI administrativa, nuevos tools, credenciales, cambios
  de configuración, mutaciones web ni activación de agentes.
- Informe y JSON incorporados al inventario con SHA-256. Pasan la validación
  del paquete, el escaneo de secretos, 154 pruebas Node, la comprobación de
  diff y aserciones de procedencia, fechas, contadores y campos desconocidos.
- No se ejecutan typecheck/build globales ni suites de navegador para esta
  entrega documental. No es una entrega PR-ready ni una promoción/import.
