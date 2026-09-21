# EAI-029 — ampliación mediante la UI de Search Console

Fecha: 2026-09-12. Ticket operativo: `ENK-33`.
Lectura autorizada por el operador, incluida la sesión utilizada.

**Google confirma que no pudo leer el sitemap de marcas.** El índice raíz
figura como correcto, pero uno de sus siete hijos muestra una instancia de
«Error general de HTTP». La UI revisada no explica el contador de 60
advertencias del recibo MCP anterior ni permite vincularlo a este error.
No se ha corregido ni solicitado reprocesar nada.

Este informe amplía el [diagnóstico MCP](sitemap-warning-diagnostic-2026-09-12.md),
que se conserva como evidencia de las 14:30 UTC. El
[recibo UI saneado](sitemap-ui-evidence-2026-09-12.json) recoge los campos
observados en el árbol de accesibilidad de Zen, transcritos sin identidad
de cuenta, credenciales ni contenido de otras pestañas. No es una respuesta
API ni una exportación íntegra de Search Console.

## Índice y siete hijos

Propiedad comprobada: `sc-domain:enkihogar.com`.
Índice: `https://www.enkihogar.com/sitemap_index.xml`.
Captura del detalle: **15:58:05 UTC / 17:58:05 CEST**.

El listado muestra un único sitemap enviado, de tipo «Índice de sitemaps»,
enviado el 30 de junio de 2025 y leído el 12 de septiembre de 2026. Su estado
es «Correcto», con 789 páginas descubiertas y cero vídeos. El detalle dice
que el índice se ha procesado correctamente y muestra **1–7 de 7** hijos:

| Sitemap hijo | Estado en la tabla | Última lectura | Páginas descubiertas |
| --- | --- | --- | ---: |
| `category-sitemap.xml` | Correcto | 12 sept 2026 | 1 |
| `page-sitemap.xml` | Correcto | 12 sept 2026 | 10 |
| `post-sitemap.xml` | Correcto | 12 sept 2026 | 26 |
| `product-sitemap.xml` | Correcto | 12 sept 2026 | 606 |
| `product_cat-sitemap.xml` | Correcto | 12 sept 2026 | 145 |
| `wffn_optin-sitemap.xml` | Correcto | 12 sept 2026 | 1 |
| `yith_product_brand-sitemap.xml` | No se ha podido obtener | No disponible | 0 |

Todos pertenecen a `https://www.enkihogar.com/` y muestran cero vídeos.
Los contadores de páginas de los hijos suman 789, coincidiendo con el total
del índice. Esta coincidencia aritmética no demuestra ausencia de duplicados
ni convierte las páginas descubiertas en páginas indexadas. Tampoco el
estado correcto del índice prueba que todos sus hijos se hayan obtenido.

## Error confirmado en el sitemap de marcas

Se abrió el detalle de
`https://www.enkihogar.com/yith_product_brand-sitemap.xml` y se desplegó su
panel de error, a las **15:58:18 UTC**:

- Estado: «No se ha podido leer el sitemap».
- Última lectura: «N/D»; páginas y vídeos descubiertos: cero.
- Incidencia: «Error general de HTTP», **1 instancia**.
- Explicación: Google indica que no pudo acceder al sitemap y recomienda
  comprobar su ubicación y si el acceso está bloqueado.

No aparecen código HTTP específico, fecha del intento fallido, línea XML,
URLs de ejemplo ni causa técnica verificada. Por tanto, no se puede afirmar
404, 403, bloqueo WAF, indisponibilidad del servidor o robots como causa.
El cero de páginas descubiertas tampoco significa que no existan páginas
de marca o que ninguna esté indexada por otras vías.

El baseline público anterior había observado una regla robots que coincidía
con este sitemap. La UI aporta ahora evidencia independiente de fallo de
acceso de Google, pero **no identifica esa regla como la causa**. No se han
reconsultado robots, el sitemap público ni registros del servidor en esta
lectura, cuyo alcance autorizado era la UI de GSC.

## Qué sabemos de las advertencias

El MCP mostró 60 advertencias y cero errores formateados a las 14:30 UTC.
Esta visita UI es posterior y no repite esa consulta. La UI inspeccionada
no muestra el contador de 60 ni una lista de sus mensajes o URLs afectadas.
No confirma, por tanto, que el contador siga exactamente en 60 a la hora de
la visita, ni que una instancia de error HTTP equivalga a esas advertencias.

Son observaciones distintas: éxito del índice raíz, fallo de acceso de un
hijo y contador agregado anterior. Se conserva esa separación; no se
presenta el error de marcas como explicación completa de las advertencias.

## Cobertura y pausa del navegador compartido

Se revisaron el listado enviado, el detalle del índice y las siete filas
de hijos. Se abrieron **cinco de siete** detalles: marcas, productos,
categorías de entradas, páginas y entradas. Los cuatro últimos muestran
procesamiento correcto con los mismos contadores y fechas de su fila.
Se desplegó la única incidencia observada, la de marcas.

`product_cat-sitemap.xml` y `wffn_optin-sitemap.xml` constan correctos en la
tabla completa, pero sus páginas de detalle todavía no se abrieron. Se
pausaron los clics cuando Zen cambió a una pestaña ajena a GSC, evitando
interferir con el operador. No atribuirles una inspección de detalle.

## Próximo paso propuesto, no aplicado

La investigación útil siguiente es acotar el fallo de acceso del sitemap
de marcas, independientemente del contador de advertencias: comprobar de
forma fechada su ruta pública, redirecciones, robots y respuesta HTTP, con
un alcance de lectura aprobado y sin eludir restricciones de acceso. Si
esas observaciones no explican el fallo de Google, harían falta registros
de origen/CDN autorizados y saneados; no basta con que un navegador obtenga
el recurso. No retirar reglas ni modificar plugins por conjetura.

Toda corrección de web/robots/sitemap requiere una aprobación posterior de
los cambios exactos. No se pulsaron envío, eliminación, solicitud de
indexación, prueba en directo, «Abrir sitemap» ni menús de administración.
La autorización de esta sesión no amplía el catálogo MCP ni activa agentes.

## Verificación de la entrega

El informe y el JSON se registran con SHA-256 en el inventario. Pasan las
aserciones de estructura, siete URLs únicas, suma de contadores, cobertura
de detalle y conservación del recibo MCP previo. También pasan el validador
del paquete, secret scan, las 154 pruebas Node y `git diff --check`.
Los artefactos se adjuntan a `ENK-33` y se descargan para comprobar igualdad
byte a byte, conservando el diagnóstico MCP anterior como historial.
Sin typecheck/build globales para esta entrega documental; no es PR-ready,
no modifica producto ni incluye commit, push o import.
