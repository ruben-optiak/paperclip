# EAI-030 — diagnóstico HTTP público del sitemap de marcas

Fecha: 2026-09-19. Ticket operativo: `ENK-34`.
**El fallo HTTP histórico de Google no se reproduce desde la red pública; la
causa exacta permanece sin demostrar.**

La URL que Search Console no pudo leer el 12 de septiembre responde hoy
`200`, sin redirección, como XML válido y con siete URLs de marca. El índice
raíz también responde `200`, es XML válido y sigue incluyendo ese hijo. La
[evidencia saneada](brand-sitemap-http-evidence-2026-09-19.json) conserva
cabeceras, conteos y hashes; no retiene los cuerpos públicos completos.

Este resultado acota el diagnóstico, pero no contradice la observación
histórica de GSC: un recurso disponible hoy pudo fallar en el intento anterior,
y una lectura con `curl` no reproduce la identidad ni la red de Googlebot.

## Resultado de la ruta exacta

Captura entre las 16:18:43 y 16:18:51 UTC:

| URL solicitada | Estado final | Redirecciones | Tipo | Bytes | SHA-256 del cuerpo |
| --- | ---: | ---: | --- | ---: | --- |
| `https://www.enkihogar.com/yith_product_brand-sitemap.xml` | 200, HTTP/2 | 0 | `text/xml; charset=UTF-8` | 1.499 | `4fedb734008b571242b744d32a54c600c84cb2bda814c2a564b6986d78339283` |
| `https://enkihogar.com/yith_product_brand-sitemap.xml` | 200, HTTP/2 | 0 | `text/xml; charset=UTF-8` | 1.499 | mismo hash HTTPS |
| `http://www.enkihogar.com/yith_product_brand-sitemap.xml` | 200, HTTP/1.1 | 0 | `text/xml; charset=UTF-8` | 1.462 | `18adbf654b3d87953c004b97f965d73b5e9440071791b73918549c9f96511392` |
| `http://enkihogar.com/yith_product_brand-sitemap.xml` | 200, HTTP/1.1 | 0 | `text/xml; charset=UTF-8` | 1.462 | mismo hash HTTP |

Las cuatro respuestas contienen siete nodos `url`, siete `loc` HTTPS con
`www` y siete `lastmod`. Las dos variantes HTTPS son idénticas entre sí y las
dos HTTP también. La única diferencia entre los cuerpos HTTP y HTTPS es la
ruta de la hoja XSL: los datos del sitemap son iguales. La respuesta canónica
incluye `X-Robots-Tag: noindex, follow`, `Cache-Control: max-age=0`, servidor
Apache y TLS 1.3. Esas cabeceras describen la lectura actual; no explican por
sí solas el intento anterior de Google.

El índice `https://www.enkihogar.com/sitemap_index.xml` devolvió `200`, 1.196
bytes y SHA-256
`282c315dc250ea300b2039900de08287cc78bab542b906b51732eada2397ea23`.
Es XML válido, contiene siete hijos y declara exactamente la URL canónica de
marcas. No hay un enlace roto en el índice actual.

## Regla robots: candidata relevante, no causa demostrada

`https://www.enkihogar.com/robots.txt` devolvió `200`, 1.005 bytes y SHA-256
`57b3c25f26f0a5fabf286ac75a528840be510eb429bdc0bb2bb9ee7b1332f65e`.
Contiene dos veces esta directiva, una en el grupo específico `Googlebot` y
otra en el grupo `*`:

```text
Disallow: *yith_product_brand
```

Si ese patrón se acepta, coincide textualmente con
`/yith_product_brand-sitemap.xml`. Además, Google documenta que respeta
`robots.txt` al obtener sitemaps y que un bloqueo puede producir el estado
«Couldn't fetch» ([informe de sitemaps](https://support.google.com/webmasters/answer/7451001?hl=en)).

No obstante, la misma especificación de Google dice que el valor de una regla
`allow`/`disallow` debe comenzar por `/`; la regla observada empieza por `*`.
También indica que el grupo específico de `Googlebot` prevalece y no se combina
con el grupo global ([interpretación de robots.txt](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)).
Por eso esta captura pública no permite afirmar si Google aplicó, ignoró o
interpretó de forma tolerante esa línea en el intento fallido. Es la hipótesis
principal que debe verificarse, no un diagnóstico causal cerrado.

## Hallazgos que deben permanecer separados

- **Fallo histórico confirmado:** GSC mostró «No se ha podido leer el sitemap»
  y una instancia de «Error general de HTTP» el 12 de septiembre; no expuso
  código ni hora del intento.
- **Disponibilidad actual confirmada:** ruta canónica, índice y `robots.txt`
  responden `200`; ambos XML son parseables. Esto descarta un 404 o XML roto
  persistente en el momento de esta captura, no un fallo transitorio anterior.
- **Robots candidato:** existe una directiva cuyo texto contiene el nombre del
  sitemap, pero no cumple el prefijo `/` documentado. Sin prueba de Googlebot o
  registro de origen no se adjudica causalidad.
- **Normalización independiente:** HTTP/HTTPS y `www`/apex sirven `200` sin
  redirección. Es una observación técnica real, pero no explica que Google no
  obtuviera la URL HTTPS `www`, que actualmente responde correctamente.
- **Advertencias agregadas:** este diagnóstico no vuelve a leer el contador de
  60 advertencias ni lo explica. El error del hijo y ese contador siguen siendo
  señales distintas.

## Siguiente cambio propuesto, no aplicado

Technology y Growth deben revisar la intención exacta de la regla YITH. Si se
pretende bloquear filtros o páginas de marca, pero permitir el sitemap, preparar
una modificación mínima y válida que preserve ese alcance y permita
explícitamente `/yith_product_brand-sitemap.xml` en el grupo efectivo de
`Googlebot`. La propuesta debe incluir el `robots.txt` anterior y posterior,
prueba de matching para páginas/filtros y para el sitemap, rollback y revisión
humana. No basta con borrar la cadena por intuición.

Después de una aprobación independiente del cambio exacto, el operador puede
usar la inspección en vivo para confirmar `Crawl allowed = Yes` y `Page fetch =
Successful`, y reenviar el sitemap si procede. Ambas son acciones de Search
Console fuera de este ticket. Si continúa el error, el siguiente diagnóstico
requiere logs saneados de origen/CDN para las peticiones de Google y sus códigos,
sin conservar IPs completas ni credenciales.

También conviene tratar la falta de redirección HTTP/apex en un ticket separado:
definir el origen canónico deseado, comprobar impacto y aplicar redirecciones
solo con aprobación y rollback. No mezclar esa mejora con la corrección del
fetch de GSC.

## Alcance y límites

- Se realizaron únicamente GET públicos con `curl` normal; no se usó un
  user-agent de Google, no se eludieron restricciones y no se accedió a logs,
  WordPress, CDN ni credenciales.
- Se conservaron hashes, cabeceras y conteos. Los cuerpos temporales se usaron
  para parseo XML y no se incorporan al paquete.
- No se modificaron `robots.txt`, sitemaps, plugins, host, Search Console ni la
  web. No se enviaron sitemaps, pruebas en vivo ni solicitudes de indexación.
- La conclusión es `current_public_success_historical_cause_unproven`; cerrar
  el diagnóstico no autoriza el cambio propuesto.
