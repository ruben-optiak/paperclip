# Pipeline SEO actual — EAI-023

El contrato es `references/seo/pipeline-v1.json`. El tooling de
`scripts/seo/` usa Python 3.9+ y la biblioteca estándar; el diagnóstico MCP
usa el Node del conector. El análisis genera una prioridad técnica reproducible
con `impacto × confianza ÷ esfuerzo`, riesgo separado y criterio de aceptación
por hallazgo. El baseline cruza observación pública, lecturas actuales de
GSC/GA4 y una muestra de inspecciones del índice; no autoriza cambios en la web.

## Captura pública

Desde la raíz del repositorio:

```sh
python3 companies/enki-hogar-ai-os/scripts/seo/pipeline.py crawl \
  --output /tmp/enki-seo-public-new.json
```

Cada salida debe tener un nombre nuevo. El script rechaza sobrescrituras,
consulta `robots.txt` antes del crawl, respeta el grupo del user-agent,
mantiene el origen HTTPS exacto y comprueba cada redirect antes de seguirlo.
Excluye URLs con query string, credenciales, rutas de cuenta/compra o patrones
sensibles. No envía cookies ni ejecuta JavaScript. Limita cuerpos, redirects,
tiempos, sitemaps y páginas; no admite entidades XML. Un sitemap bloqueado o
truncado deja el inventario parcial.

Selecciona las cuatro semillas, todos los artículos del sitemap editorial
hasta el límite global y hasta diez URLs adicionales por sitemap, ordenadas
alfabéticamente. No es una muestra aleatoria ni ponderada por demanda.
Inventariar una URL no demuestra que esté indexada. La captura conserva
status, redirects, hashes, canonical, directivas robots, conteos de título/H1,
descripción y enlaces hacia URLs conocidas; no conserva HTML ni texto de
consultas. El conteo de palabras incluye la plantilla y no mide calidad del
contenido. El grafo solo describe enlaces observados desde las páginas
muestreadas: ausencia de enlace no demuestra una página huérfana.

## Diagnóstico de las fuentes privadas

```sh
docker exec -i docker-enki-google-mcps-1 node --input-type=module - \
  < companies/enki-hogar-ai-os/scripts/seo/probe-sources.mjs
```

El bearer permanece en el contenedor. Solo salen estado y códigos de error
saneados. Se comprueban también errores JSON dentro de `content`, porque GA4
puede devolver `isError=false` junto con un error de credenciales. El estado
healthy del contenedor no demuestra acceso a las APIs.

Un `oauth_invalid_grant` exige renovar la autenticación del proveedor por el
operador mediante el setup existente de [conexiones](connections.md). GSC usa
OAuth propio; GA4 usa Google ADC. No sustituir uno por otro ni copiar tokens a
la compañía, al Git o a los agentes. Después repetir el probe y el reporte
real; un probe satisfactorio no equivale a haber capturado los datos SEO.

## Datos analíticos y contrato de entrada

Las fechas de comparación se fijan en el config (julio y agosto de 2026 en
esta revisión). El capturador usa solo herramientas ya admitidas:

```sh
node companies/enki-hogar-ai-os/scripts/seo/capture-sources.mjs \
  companies/enki-hogar-ai-os/references/seo/pipeline-v1.json \
  companies/enki-hogar-ai-os/references/seo/public-2026-09-12.json \
  /tmp/enki-seo-sources-new.json
```

El host ejecuta el capturador dentro del conector Google y escribe únicamente
el recibo saneado en una ruta nueva. La propiedad se selecciona por nombre
Enki exacto y único; una selección ambigua se rechaza. Los identificadores y
respuestas originales no salen del contenedor. El ámbito retenido es la unión
exacta de inventario y páginas del snapshot; se cuentan las filas excluidas,
sin fusionar barras finales. GA4 filtra `hostName=www.enkihogar.com` y no
representa otros hosts ni el total de la propiedad.

El conector GSC fijado a `1.1.0` devuelve tablas: limita respuestas a 25.000
caracteres, dimensiones a 80 caracteres y redondea posición a un decimal.
El config `1.1.0` pagina en bloques de 100, máximo 100 bloques. Para una URL
recortada, el prefijo solo genera candidatos del inventario: cada candidato
se vuelve a consultar con `page equals URL` y sin dimensión `page`, de modo
que su identidad queda respaldada por un filtro exacto, no por el prefijo.
Máximo 150 candidatos por consulta, cuatro lecturas concurrentes y 600
solicitudes para toda la captura. Las consultas de búsqueda recortadas se
omiten con conteo y hacen parcial el solapamiento. Tablas ambiguas o recortadas
se rechazan. Las posiciones ponderadas siguen siendo aproximadas por ese
redondeo del conector. No se modifica el servidor upstream ni su catálogo.

Una página completa en el último bloque implica
`truncated=true`. La API devuelve filas principales y puede omitir consultas;
alcanzar una página corta no prueba cobertura exhaustiva.
[Referencia oficial de Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

GSC usa días de `America/Los_Angeles`; GA4 usa el timezone de la propiedad,
que se verifica en detalles de propiedad y metadata de cada reporte. Se conservan ambos sin asumir que los mismos
labels de fecha representan los mismos instantes. CTR es la suma de clics
dividida por impresiones; posición se pondera por impresiones. GA4 aporta
`screenPageViews` direccionales; no se suman usuarios/sesiones entre páginas
ni se atribuyen ingresos a partir de estos datos. Cada respuesta se envuelve
en `enki-evidence-envelope/v1` antes de normalizarla; el recibo conserva su
metadata. El contrato ahora admite Madrid y California y exige California
para `source=gsc`; Woo mantiene sus límites de calendario de Madrid.

GA4 comprueba `row_count`, cabeceras, timezone, sampling, other-row loss,
thresholding y restricciones de métricas. Esas condiciones impiden promover
el reporte a disponible. La omisión intencionada de URLs fuera del ámbito
público se cuenta separadamente de una pérdida de transporte.

La entrada offline saneada utiliza este formato por proveedor:

```json
{
  "gsc": {
    "status": "available",
    "capturedAt": "2026-09-12T12:00:00Z",
    "truncated": false,
    "timezone": "America/Los_Angeles",
    "periods": [
      {"start": "2026-07-01", "end": "2026-07-31", "rows": []},
      {"start": "2026-08-01", "end": "2026-08-31", "rows": []}
    ]
  }
}
```

`rows` solo puede estar vacío cuando la API realmente devolvió cero filas;
el ejemplo muestra la estructura, no una captura real. Cada fila GSC contiene
`url`, `clicks`, `impressions`, `position`. Cada fila GA4 contiene `url` y
`pageViews`, con el mismo envoltorio y timezone verificado. Las URLs son
públicas, exactas y sin query strings; se descartan con conteo las rutas
sensibles. No fusionar URLs por barra final ni cambiar su identidad sin un
redirect/canonical observado. Filas duplicadas, periodos distintos o métricas
inválidas se rechazan. Conservar calidad, filtros y cobertura del proveedor en
el recibo de captura; usar `status=unavailable/partial` cuando haya error,
muestreo o pérdida de filas relevante. Los datos de más de siete días o
truncados no alimentan el análisis actual.

Para solapamiento, `gscOverlap` usa `status`, `capturedAt`, `truncated`,
`timezone`, `period` igual al último periodo configurado y `rows` con
`querySha256`, `url`, `clicks`, `impressions`, `position`. Calcular SHA-256 de
la consulta exacta dentro del proceso de captura, descartar el texto y no
tratar ese hash como anonimización para distribución pública. Dos páginas con
al menos diez impresiones cada una generan una candidata a revisión. Eso no
prueba canibalización: hace falta revisar intención, evolución y SERP.

Se inspeccionan hasta 20 URLs: conflictos técnicos de la muestra y páginas
con más impresiones. La herramienta actual expone verdict, cobertura y estado
del rastreo, pero omite `googleCanonical` y `userCanonical`; ambos quedan null,
con `canonicalFieldsExposed=false`. Esa limitación no autoriza a inferirlos
desde el HTML. La inspección describe la versión conocida por Google, no
una prueba en vivo de la URL.
[Referencia de URL Inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect).

## Análisis offline

```sh
python3 companies/enki-hogar-ai-os/scripts/seo/pipeline.py analyze \
  --snapshot companies/enki-hogar-ai-os/references/seo/public-2026-09-12.json \
  --sources companies/enki-hogar-ai-os/references/seo/sources-2026-09-12.json \
  --output /tmp/enki-seo-analysis-new.json
```

La salida ordena observaciones técnicas e incluye los agregados por periodo
cuando la entrada los permite. Con GSC disponible, prioriza también caídas
de al menos 0,15 clics diarios y páginas con 100+ impresiones y posición 4–20.
Normaliza por los días de cada periodo; una fila ausente no se convierte en
cero. Impacto vale 2/3/4 a partir de 100/500/1.000 impresiones, confianza
0,8 para caídas y 0,6 para revisión de intención/snippet, y esfuerzo 2.
Las puntuaciones son heurísticas de revisión,
no estimaciones de tráfico ni ventas. Una URL `noindex` fuera del sitemap
puede ser deliberada; el canonical ausente en esa URL no autoriza a indexarla.
El canonical expresa una preferencia, no acredita el canonical seleccionado
por Google.
[Referencia oficial de canonicalización](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

## Evidencia inicial del 12 de septiembre de 2026, antes de renovar OAuth

- `references/seo/public-2026-09-12.json`: 788 URLs inventariadas; 60 páginas
  comprobadas (26 artículos), 68 peticiones lógicas. El sitemap de marcas
  quedó sin leer durante esa captura y su nombre aparecía en una regla robots;
  esa coincidencia inicial no demuestra cómo Google interpreta la regla.
- `references/seo/sources-2026-09-12.json`: GSC y GA4 indisponibles por
  `oauth_invalid_grant`. El baseline EAI-006 se conserva como contexto histórico
  agregado, con una corrección explícita de timezone y cobertura.
- `references/seo/analysis-2026-09-12.json`: 35 observaciones, incluidas dos
  de autenticación. Tráfico, engagement actual y solapamiento permanecen null.

## Prioridades técnicas iniciales

| Prioridad técnica | Evidencia | Siguiente acción y aceptación |
| --- | --- | --- |
| 5,00 | GSC y GA4 no pueden leer | Renovar ambas autenticaciones y capturar periodos exactos; después priorizar por URL y demanda |
| 2,50 | `/manage-profile/` está en sitemap y responde 200 con `noindex` | Confirmar que debe permanecer excluida; revisar su inclusión en sitemap, sin proponer indexar una página de perfil |
| 2,00 | `*yith_product_brand` contiene el nombre de `/yith_product_brand-sitemap.xml`, pero la regla no comienza por `/` | Revisar alcance, sintaxis y procesamiento real en GSC; no atribuir causalidad sin prueba de Googlebot o log de origen |
| 1,50 | H1 ausente en `/tienda/`, `/aviso-legal/` y `/manage-profile/` | Revisar las plantillas pertinentes según su función; la página de perfil no es una oportunidad editorial |
| 1,00 | Estanterías sigue `noindex`, sin canonical y fuera del sitemap | Confirmar intención de exclusión y sus relaciones con categorías indexables |
| 0,80 | Títulos iguales en dos grupos de categorías «1 vía» y «2 vías» | Revisar intención y consulta/URL cuando vuelva GSC; no consolidar categorías basándose solo en el título |
| 0,70 | 23 páginas indexables de la muestra sin meta description | Priorizar tras recuperar demanda por URL y revisar la plantilla; ausencia de descripción no demuestra pérdida de tráfico |

Los dos grupos con título coincidente son:

- `/1-via-kits-de-ducha-empotrados/` y `/1-via/`.
- `/2-vias-kits-de-ducha-empotrados/`,
  `/2-vias-mezclador-monomando-columnas-ducha/` y `/2-vias/`.

Las 60 páginas respondieron 200; 58 tienen un canonical al propio URL y no
declaran `noindex`. No se observaron redirects en la muestra. Es evidencia del
HTML público, no una inspección de índice. El grafo carece de enlaces entrantes
observados para 547 de las 788 URLs; la muestra no permite llamarlas huérfanas.

Estos archivos preservan el bloqueo inicial y no se sobrescriben al recuperar
el acceso. Las nuevas capturas se analizan por separado. No se han cambiado
WordPress, indexación, redirecciones ni contenido.

## Baseline recuperado y backlog de revisión

La captura `references/seo/sources-2026-09-12-restored.json` se realizó entre
12:31 y 12:32 UTC, después de renovar ambas autenticaciones y reiniciar solo
el conector Google. Usó 366 solicitudes de lectura. La salida reproducible es
`references/seo/analysis-2026-09-12-restored.json`; para repetir su análisis,
usar el comando anterior con ese archivo `--sources` y una salida nueva.

El ámbito contiene 789 URLs públicas conocidas: 788 del inventario y una
semilla adicional. No representa todas las URLs históricas ni todos los hosts.

| Señal del ámbito observado | Julio 2026 | Agosto 2026 |
| --- | ---: | ---: |
| URLs con filas GSC | 643 | 633 |
| Clics GSC | 263 | 244 |
| Impresiones GSC | 22.076 | 21.332 |
| CTR recalculado | 1,19 % | 1,14 % |
| Posición ponderada aproximada | 12,5 | 14,9 |
| URLs con filas GA4 | 287 | 231 |
| Page views GA4 direccionales | 971 | 673 |

Las lecturas GSC por página recuperaron 124 y 130 candidatos de URL mediante
filtros exactos. GA4 devolvió 416/309 filas para el host; 129/78 quedaron fuera
del ámbito público retenido. No declaró muestreo, umbrales, other-row loss ni
restricciones de métricas. Eso no resuelve la cobertura de consentimiento o
las discrepancias comerciales de `EAI-006`. Los cambios mensuales no prueban
causalidad, estacionalidad ni impacto de una intervención.

El analizador entrega **35 oportunidades de revisión por demanda**, además de
33 observaciones técnicas. Prioridades iniciales, con riesgo medio y sin
autorización de escritura:

| Score | URL/producto | Evidencia de agosto | Acción y aceptación |
| --- | --- | --- | --- |
| 0,90 | Kit ducha Toke monomando 2 vías, rociador a pared | 576 impresiones, 0 clics, posición ≈8,8; índice PASS | Revisar intención, título/snippet y competencia real; documentar hipótesis, revisión y nueva ventana antes de cualquier cambio |
| 0,80 | Loop parte externa monomando ducha mural horizontal 2 vías | Clics 11→3; 122 impresiones, posición ≈5,9 | Revisar consultas y evolución por días/dispositivo; descartar cambios de demanda antes de atribuir la caída a la página |
| 0,60 | Kit Termo ducha termostática 2 vías, rociador a pared | 471 impresiones, 1 clic, posición ≈11,2; PASS | Revisar intención y presentación; comprobar canonical seleccionado con una fuente que sí lo exponga antes de consolidar |
| 0,60 | Toallero pie 100 | 417 impresiones, 0 clics, posición ≈14,4; PASS | Validar consulta/producto y propuesta de snippet; no estimar ventas a partir de impresiones |
| 0,60 | Mampara panel fijo Single | 415 impresiones, 7 clics, posición ≈16; PASS | Revisar oportunidad de contenido/enlazado con alcance y comparador explícitos |

El solapamiento conserva 1.297 filas consulta/URL y genera **21 candidatos**.
Se omitieron 16 celdas de consulta recortadas; la fuente permanece `partial`.
Solo se usan las filas íntegras como candidatos del subconjunto observado,
nunca para demostrar ausencia de solapamiento ni canibalización. Entre los
grupos revisables aparecen variantes Stone Smart (375 impresiones sumadas
entre páginas para un mismo hash), Luka/Karpi (208) y un grupo de packs
Aquapure (100). No son impresiones únicas del sitio ni órdenes de fusionar:
variantes y resultados múltiples pueden ser legítimos. El texto original de
las consultas no está en el recibo.

En 19 inspecciones, 17 URLs devuelven PASS; `/manage-profile/` aparece excluida
por `noindex` y Estanterías figura como desconocida para Google. La captura
actual no elimina sus exclusiones. Los cinco URLs de categorías con títulos
coincidentes están indexados: eso tampoco prueba que deban consolidarse.

El baseline declaraba **61 warnings y 0 errors**, con última descarga
2026-09-02. `EAI-029` repitió la lectura a las 14:30 UTC del 12 de septiembre:
el conector mostró 60 advertencias, cero errores y una descarga de Google más
reciente, pero siguió sin exponer mensajes o URLs. La UI autorizada confirmó
después que el índice raíz era correcto y que solo
`yith_product_brand-sitemap.xml` figuraba como no obtenido, con una instancia
de «Error general de HTTP» y sin código ni causa. Véanse
`references/seo/sitemap-warning-diagnostic-2026-09-12.md` y
`references/seo/sitemap-ui-diagnostic-2026-09-12.md`.

`EAI-030` comprobó la ruta públicamente el 19 de septiembre. La URL HTTPS con
`www` devuelve 200 sin redirección, XML válido y siete URLs; el índice raíz
también devuelve 200 y sigue declarando ese hijo. `robots.txt` contiene
`Disallow: *yith_product_brand` en los grupos `Googlebot` y `*`. Google
documenta que un sitemap bloqueado por robots puede producir un fallo de
obtención, pero también exige que el path de la regla comience por `/`; por
eso la directiva es una candidata no demostrada. Un fallo transitorio de
servidor/red/CDN también permanece posible sin logs fechados. La evidencia y
la propuesta no aplicada están en
`references/seo/brand-sitemap-http-diagnostic-2026-09-19.md`.

No se han explicado las 60 advertencias agregadas, modificado robots/sitemaps
ni reenviado nada a Google. Cualquier regla corregida, prueba en vivo o
reenvío requiere una aprobación nueva y exacta.

El baseline y el pipeline de `EAI-023` quedan entregados como observación
acotada, no como auditoría exhaustiva ni optimización aplicada. Siguen fuera
del alcance: canonical elegido por Google (el conector lo omite), atribución
comercial, resolución de warnings y cualquier publicación o configuración.

## Verificación del paquete

El 2026-09-12 pasó `companies/enki-hogar-ai-os/scripts/check.sh`: validación
del paquete, escaneo de secretos, suites de catálogo y conectores, 17 pruebas
Python SEO y diez pruebas Node de captura/probe, typecheck/tests/build de Telegram,
ZIP reproducible y resolución de Docker Compose. El replay de la captura
versionada no necesita red. No se ejecutaron los gates globales del producto:
los cambios están limitados al paquete de compañía y su backlog.

El 2026-09-19, tras recuperar los nueve artefactos operativos anteriores y
añadir el diagnóstico `EAI-030`, volvieron a pasar la validación del paquete y
el escaneo de secretos. La suite Node acotada del paquete pasó 154/154 pruebas.
Los dos adjuntos nuevos se descargaron desde Paperclip y conservaron exactamente
sus SHA-256 de origen. La comprobación no importó el paquete, no inició agentes
y no modificó ningún sistema externo.
