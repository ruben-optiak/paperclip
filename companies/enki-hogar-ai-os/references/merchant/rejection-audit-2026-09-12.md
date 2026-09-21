# EAI-028 — origen de los 25 rechazos Merchant

Fecha: 2026-09-12. Zona: Europe/Madrid. Seguimiento operativo: `ENK-32`.
Estado: **PARTIAL; no cierra EAI-028 ni corrige los rechazos**.

## Resultado y cobertura

Se fijó el conjunto exacto de 25 ofertas desde la sesión Merchant autorizada:
22 rechazos por imagen ausente, 2 por precio inválido y 1 por tipo de imagen
no admitido. Se desactivó únicamente el filtro de visualización «Prioritized
fixes»; países, métodos y fuentes permanecieron en «All». La tabla mostró
`1–25 of 25`, con actualización indicada a las 00:00 del 12 de septiembre.

- Cohorte e incidencia individual: **25/25**.
- Atributos originales del feed inspeccionados y unión directa MPN + URL con
  Woo: **1/25**, oferta `8559`.
- Candidatos Woo corroborados desde la web pública: **17/25**, incluido ese
  caso verificado. Los otros **16 son candidatos**, no joins Merchant–Woo
  confirmados. Coinciden nombre/opciones e identidad pública; aún falta leer
  su destino y MPN originales en Merchant.
- Ocho ofertas Toke: sin candidato ni destino inspeccionado en esta entrega.
- Once fichas públicas leídas; doce llamadas al MCP Woo permitido, once
  satisfactorias y una resolución por SKU fallida conservada. Cada consulta
  de variaciones se limitó a una página; ninguna declaró truncamiento.
- Trece variantes candidatas publican `image.src` vacío. Ocho fichas padre o
  simples de accesorios carecen de `Product.image` en el JSON-LD capturado;
  esos ocho documentos corresponden a catorce ofertas candidatas.
- Dos URLs de imagen probadas mediante GET: una devuelve JPEG/200; la otra,
  HTML/404. No se descargó el feed completo ni se exploró todo el catálogo.

La [evidencia saneada](rejection-evidence-2026-09-12.json) conserva cohorte,
atributos observados, argumentos exactos del MCP, resolución, fechas,
precios saneados, opciones, cobertura, HTTP, firmas iniciales y SHA-256 del
HTML. Las lecturas públicas principales se realizaron a las 13:42:23–27 UTC;
los recibos Woo incluyen su propio `fetched_at`. El contraste adicional de
identidad pública de `1856` se hizo a las 13:44:27 UTC.

## Hallazgos

### P1 — rociador SPA 200: el cero está en el feed y en el marcado público

Para `8559`, Merchant muestra en **Raw data source attributes: Feed Google**:

- MPN `BD.7107125`, marca Buades, precio `EUR0.00`, disponibilidad `in_stock`.
- Destino: <https://www.enkihogar.com/rociador-inox-rectangular-2-funciones-cascada-y-lluvia/>.
- Imagen: <https://www.enkihogar.com/wp-content/uploads/2023/09/BD.7107125.jpg>.
- `additional image link`: `8561,`, no una URL de imagen utilizable.

`woo_get_product_structure(sku="BD.7107125", max_pages=1)` resolvió el
producto simple `8559` con ese mismo SKU, nombre y permalink. El conector
devuelve `price`, `regular_price` y `sale_price` como `null`; está publicado
y declara stock. La ficha pública responde 200, conserva la canonical y
emite una oferta JSON-LD de precio `0`, moneda `EUR`, disponibilidad
`InStock`. La imagen principal responde 200, `image/jpeg`, con firma JPEG.

**Conclusión observada:** no es solo una etiqueta errónea del diagnóstico:
el feed recibido y el marcado público ofrecen precio cero, mientras Woo no
aporta un precio decimal válido a través del conector. La causa exacta de la
transformación del precio, el valor comercial correcto y la configuración
del generador de feed no están inspeccionados. Un `null` del conector puede
significar dato ausente o inválido; no prueba un NULL literal en la base de
datos. Tampoco se ha probado una compra ni la presentación visual del precio.

**Propuesta mínima, no aplicada:** Ecommerce debe validar el precio y si el
artículo sigue siendo vendible. Con aprobación específica, corregir el dato
de origen o excluir la oferta si no tiene precio válido; después contrastar
precio de la variante/simple, web, JSON-LD y siguiente ingestión Merchant.
Revisar por separado el enlace adicional numérico. No inventar un importe
ni modificar solo Merchant para ocultar el problema de origen.

### P2 — variante Aqua: candidato sin precio, no usar el mínimo del padre

Merchant rechaza `32370`, «Mueble de baño Aqua 2 cajones + lavabo Flat Ceniza
100cm Quarzo», por precio inválido. La ficha pública candidata
<https://www.enkihogar.com/mueble-de-bano-aqua-2-cajones-lavabo-flat/>
identifica el padre `32309` en su formulario Woo; no se utilizó el ID de
Merchant como entrada de la consulta.

El MCP de estructura para ese padre devuelve 72 variaciones completas. La
variación `32370`, SKU `72125`, coincide con Ceniza / 100cm / Quarzo y no
tiene precio decimal válido (`price` y `regular_price` saneados a `null`).
La web publica para el padre un AggregateOffer EUR de 299,11 a 394,94; ese
rango **no demuestra un precio válido de la variante rechazada**. El HTML
inicial no incluye sus datos de variación; no se invocaron endpoints AJAX
adicionales ni se seleccionaron opciones en el navegador.

**Inferencia pendiente de unión exacta:** la variante sin precio es un
candidato fuerte al rechazo, pero falta comprobar su MPN, enlace y precio
originales del feed. Propuesta: completar primero esa unión y validar precio
o exclusión de **esa variante**, nunca copiar automáticamente el mínimo del
padre. El precio correcto no está autorizado ni establecido por esta auditoría.

### I1 — accesorios: ausencia de imagen también en datos públicos

Trece variantes de siete fichas candidatas publican `image.src=""`:
`1852`, `1853`, `1849`, `1850`, `1855`, `1859`, `1860`, `1861`, `1841`,
`1842`, `1844`, `1845` y `1847`. Los padres tampoco aportan `Product.image`
en el JSON-LD. El producto simple candidato `1856` añade otra ficha sin ese
atributo, aunque la ausencia en JSON-LD no prueba que no exista ninguna
imagen en todo el HTML o en la biblioteca de medios.

La estructura Woo confirma identidades públicas, opciones y precios de esos
candidatos; su herramienta publicada **no expone imágenes**, por lo que la
evidencia de imagen vacía procede del HTML público, no de una lectura del
campo de imagen de la API Woo. No se amplió el catálogo del conector.

**Inferencia:** estos vacíos son consistentes con los rechazos Merchant;
todavía no demuestran qué campo/regla del generador originó cada omisión.
Propuesta: leer `link`, `mpn` e `image_link` del feed para los catorce
candidatos, validar el recurso correcto por acabado y reparar solo las
asociaciones verificadas con aprobación. No aplicar una imagen genérica a
todas las variantes ni modificar el fallback del generador sin inspeccionarlo.

### I2 — esponjera 50 cm: la URL .jpg responde HTML/404

Para el candidato a `1839`, la ficha
<https://www.enkihogar.com/esponjera-gel-recta-n5/>
identifica el padre `1838`; Woo devuelve variación `1839`, SKU `100501`,
Cromo / Taladro. La imagen de esa variante pública es:

<https://www.enkihogar.com/wp-content/uploads/2023/02/633-Esponjera-Gel-recta-50cm.jpg>

El 2026-09-12 a las 13:42:57 UTC respondió **404**,
`text/html; charset=UTF-8`; los bytes empiezan por `<!doctype html>`.
El JSON-LD declara para esa imagen dimensiones cero. Una extensión `.jpg`
no garantiza que el servidor entregue una imagen.

**Inferencia, no causa Merchant confirmada:** recibir HTML en esa URL podría
explicar «Unsupported image type» si es la misma URL enviada en el feed.
Falta leer el `image_link` original de `1839`; no se comprobó una respuesta
específica a Googlebot ni se atribuye el fallo a la extensión o al formato
del archivo original, que no se ha recuperado.

Propuesta mínima: confirmar la URL exacta del feed, localizar el recurso
correcto del producto y, con aprobación, restaurar o reemplazar esa asociación.
Verificar HTTP 200, Content-Type y firma de imagen, dimensiones y contenido
adecuados, y después el reprocesado de Merchant. No renombrar HTML a `.jpg`.

### I3 — ocho variantes Toke sin detalle inspeccionado

Los IDs `8198`–`8205` aparecen individualmente como imagen ausente en la
cohorte. No se conocen aún sus destinos/MPN originales ni se consultó Woo
por esos números. No se extrapolan a estas ocho ofertas los hallazgos de
los accesorios. Próximo paso: leer las ocho fichas Merchant o un export
acotado, resolver SKU/URL exactos y repetir las pruebas.

### Control de identidad que evitó una unión falsa

La ficha pública de la estantería `1856` emite SKU JSON-LD `1856`, pero la
consulta exacta por ese SKU no encontró producto. Se conserva ese fallo.
Una lectura adicional de la misma ficha observó `postid-1856` en el cuerpo
HTML; la consulta por ese ID público resolvió un producto simple de SKU vacío,
nombre y permalink coincidentes, con precio decimal `69.70` sin moneda
declarada por Woo. Su unión al feed sigue siendo candidata. Este ejemplo
impide tratar todos los SKUs estructurados o IDs Merchant como identidad Woo.

## Matriz de cohorte

`V`: unión verificada por MPN y enlace originales del feed. `C`: candidato
con evidencia pública y Woo, pendiente de unión original del feed. `U`: sin
candidato. Los precios Woo no se convierten ni se comparan monetariamente
sin resolver moneda y semántica fiscal; los valores de web/feed en EUR se
declaran solo en su fuente.

| Oferta Merchant | Producto / variante | Rechazo | SKU Woo candidato | Estado |
| --- | --- | --- | --- | --- |
| 1853 | Estantería con perchas 50cm Cromo Taladro | Imagen ausente | 150201 | C |
| 1850 | Estantería 50cm Cromo Taladro | Imagen ausente | 150101 | C |
| 1859 | Escobillero cuadrado Negro mate | Imagen ausente | 080102 | C |
| 1852 | Estantería con perchas 50cm Negro mate Taladro | Imagen ausente | 150202 | C |
| 1855 | Estantería 48cm Cromo Taladro | Imagen ausente | 150301 | C |
| 1842 | Esponjera ARES Cromo Taladro | Imagen ausente | 100607 | C |
| 8559 | Rociador Spa 200 | Precio inválido | BD.7107125 | V |
| 1849 | Estantería 50cm Negro mate Taladro | Imagen ausente | 150102 | C |
| 8199 | Bidé Toke Níquel Cepillado | Imagen ausente | — | U |
| 32370 | Aqua Ceniza 100cm Quarzo | Precio inválido | 72125 | C |
| 1860 | Escobillero cuadrado Laton cepillado | Imagen ausente | 080103 | C |
| 1861 | Escobillero cuadrado Cromo | Imagen ausente | 080101 | C |
| 1841 | Esponjera ARES Negro mate Taladro | Imagen ausente | 100602 | C |
| 8201 | Bidé Toke Cromo | Imagen ausente | — | U |
| 8203 | Bidé Toke Oro Pulido | Imagen ausente | — | U |
| 8198 | Bidé Toke Negro | Imagen ausente | — | U |
| 1839 | Esponjera Gel 50cm Cromo Taladro | Tipo de imagen | 100501 | C |
| 1845 | Esponjera Inox Cromo Taladro | Imagen ausente | 100707 | C |
| 8204 | Bidé Toke Oro Rosado Pulido | Imagen ausente | — | U |
| 8205 | Bidé Toke Blanco | Imagen ausente | — | U |
| 8200 | Bidé Toke Oro Rosado Cepillado | Imagen ausente | — | U |
| 1847 | Esponjera de grifo 30cm Cromo | Imagen ausente | 100901 | C |
| 1856 | Estantería 54cm Inox pulido brillo cromo | Imagen ausente | Vacío | C |
| 8202 | Bidé Toke Oro Cepillado | Imagen ausente | — | U |
| 1844 | Esponjera Inox Negro mate Taladro | Imagen ausente | 100702 | C |

## Continuación y límites

La sesión de navegador compartida cambió repetidamente a otro trabajo.
Se solicitó un intervalo libre de Merchant y se dejó de operar otras
pestañas. **Para continuar basta dejar libre la pestaña Merchant o aportar
un export de estos 25 artículos** con identificador completo
(canal/idioma/feed label), título, MPN/SKU, enlace, image_link, price,
sale_price, availability e incidencia, sin credenciales ni datos de clientes.
No es necesario renovar autenticación ni habilitar un nuevo conector.

Quedan 24 conjuntos de atributos originales por inspeccionar, 16 candidatos
por confirmar y 8 ofertas por resolver. Los checks HTTP no equivalen a
inspección visual ni a validación integral de datos estructurados. La
configuración del generador, la biblioteca de medios y la causalidad
histórica permanecen desconocidas; no se solicitó revisión a Google.

Todas las propuestas son **no aplicadas**. Siguen sin autorización las
mutaciones de Woo, web, medios, feed, Merchant y Ads. Tampoco se activan
agentes o rutinas. El informe y su evidencia deben adjuntarse a `ENK-32`
como artefactos verificables antes de registrar la disposición parcial.
