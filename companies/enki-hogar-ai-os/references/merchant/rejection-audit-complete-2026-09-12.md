# EAI-028 — auditoría read-only completada de los 25 rechazos

Fecha: 2026-09-12. Zona: Europe/Madrid. Ticket: `ENK-32`.
**Auditoría completada; productos no corregidos.**

Esta entrega sustituye las conclusiones provisionales del
[avance parcial](rejection-audit-2026-09-12.md), que se conserva como historial.
La [evidencia completa saneada](rejection-evidence-complete-2026-09-12.json)
incluye los atributos originales de las 25 ofertas, identidades, recibos Woo,
HTML/JSON-LD, pruebas HTTP y límites de cada comprobación.

## Resultado

| Grupo | Ofertas | Evidencia de origen | Propuesta mínima, no aplicada |
| --- | ---: | --- | --- |
| Precio inválido | 2 | Feed con `EUR0.00`; Woo sin precio decimal válido para el mismo SKU | Validar precio comercial o exclusión de la oferta exacta; corregir origen, web/JSON-LD y feed de forma coherente |
| Accesorios sin imagen | 14 | `image_link` omitido; 13 variantes públicas con imagen vacía y un simple sin `Product.image` | Obtener imágenes correctas por producto/acabado y reparar solo asociaciones verificadas |
| Toke sin imagen en feed | 8 | `image_link` omitido aunque la web entrega imagen; las ocho variantes comparten una foto cromada | Revisar exportación y selección de imagen por acabado; no copiar automáticamente la foto común |
| Tipo de imagen no admitido | 1 | El `image_link` original devuelve HTML/404, no una imagen | Restaurar o sustituir el recurso correcto y validar su respuesta antes del siguiente procesamiento |

La comprobación final de Merchant mantiene **22 imágenes ausentes, 2 precios
inválidos y 1 tipo de imagen no admitido**, total 25. No se pulsó ninguna
acción de corregir, guardar, procesar fuente, pedir revisión o activar anuncios.

### Cobertura y criterio de identidad

- **25/25** ofertas con atributos originales inspeccionados en la UI:
  `Product details → Additional details → Raw data source attributes: Feed Google`.
  Lectura del 12 de septiembre, 14:00:43–14:07:33 UTC (16:00–16:07 CEST).
- **24/25** unidas por MPN del feed igual al SKU Woo y URL de destino exacta.
  En variantes se comprueban también padre y opciones del mismo producto.
- **1/25**, oferta `1856`, no declara MPN y tiene SKU Woo vacío: se une por
  URL exacta, nombre y `postid-1856` observado independientemente en el HTML.
  No se presenta este caso como un match por SKU.
- **12 destinos únicos**, todos HTTP 200 y canonical coincidente. Los
  enlaces de variantes apuntan a la ficha padre; no se probó preselección de
  opciones ni se hizo una compra. Un AggregateOffer del padre no valida el
  precio específico de una variante.
- Trece consultas Woo retenidas: doce satisfactorias y un intento fallido
  por SKU `1856`, conservado. Solo `woo_get_product_structure`, con
  `max_pages=1`; ningún recibo declaró truncamiento. El padre Aqua devolvió
  72 variantes para localizar el SKU, pero el recibo almacenado conserva
  únicamente las filas de la cohorte.
- Cuatro URLs de imagen comprobadas por HTTP/firma; inspección visual solo
  de la imagen compartida Toke. No se atribuye a las otras tres una revisión
  visual de acabado, medidas o exactitud de producto.

Los IDs numéricos Merchant y Woo solo se contrastaron **después** de resolver
la identidad desde SKU/URL o, en el caso sin SKU, desde la evidencia pública
independiente. La coincidencia numérica por sí sola no se usa como unión.

## 1. Dos precios cero confirmados

### SPA 200 — oferta 8559 / SKU BD.7107125

El feed recibido declara `EUR0.00`, `in_stock` y el MPN `BD.7107125`.
La resolución Woo por ese SKU devuelve producto simple `8559`, con el mismo
permalink y sin precio decimal válido: `price`, `regular_price` y `sale_price`
normalizados a `null`.

La [ficha pública del rociador](https://www.enkihogar.com/rociador-inox-rectangular-2-funciones-cascada-y-lluvia/)
publica JSON-LD Offer de **0 EUR** e `InStock`; su imagen principal responde
200 con Content-Type y firma JPEG. Aquí el cero se observa tanto en el feed
como en los datos estructurados, no solo en la notificación Merchant.

### Aqua — oferta 32370 / SKU 72125 / padre 32309

El MPN `72125`, el padre `32309` y el
[destino exacto](https://www.enkihogar.com/mueble-de-bano-aqua-2-cajones-lavabo-flat/)
confirman la variante **Ceniza / 100cm / Quarzo**. Su precio original de feed
es también `EUR0.00`; Woo no proporciona precio decimal válido para esa
variante. Su `image_link` responde 200/JPEG, aunque no se ha validado
visualmente que represente las medidas y acabado de esta oferta.

El JSON-LD del padre muestra un rango **299,11–394,94 EUR**, no una oferta
válida del SKU `72125`. No sustituir el precio ausente por ese mínimo.

**Límite de causalidad:** se confirma el dato inválido enviado y la ausencia
de precio decimal válido en el origen consultable. No se inspeccionaron el
generador del feed ni su conversión de vacíos a cero. Un `null` saneado por el
conector puede significar ausencia o valor inválido; no prueba un NULL
literal de base de datos. La moneda/fiscalidad Woo no está declarada por esa
herramienta, por lo que esto no es una reconciliación financiera.

**Aplicación futura:** Ecommerce debe fijar el precio correcto o decidir que
el SKU no se oferta. Después de aprobación explícita, el cambio debe abarcar
la fuente comercial y su representación web/feed. No inventar un importe,
activar compra o modificar únicamente Merchant.

## 2. Catorce accesorios: omisión también visible en datos públicos

En las catorce ofertas de accesorios del grupo `M` de la matriz, el feed no
incluye el atributo `image_link`. Trece variantes tienen `image.src=""` en
el JSON de variantes servido por sus fichas públicas. Los siete padres de
esas variantes no incluyen `Product.image` en el JSON-LD observado.
La estantería simple `1856` tampoco incluye ese atributo.

La evidencia está en ocho destinos:

- [Estantería con perchas 50 cm](https://www.enkihogar.com/estanteria-pared-con-perchas-n2/).
- [Estantería 50 cm](https://www.enkihogar.com/estanteria-pared-n1/).
- [Estantería 48 cm](https://www.enkihogar.com/estanteria-pared-n4/).
- [Estantería 54 cm](https://www.enkihogar.com/estanteria-pared-n5/).
- [Escobillero cuadrado](https://www.enkihogar.com/escobillero-suelo-cuadrado/).
- [Esponjera ARES](https://www.enkihogar.com/esponjera-recta-ares/).
- [Esponjera Inox](https://www.enkihogar.com/esponjera-recta-n7/).
- [Esponjera de grifo](https://www.enkihogar.com/esponjera-de-grifo-n9/).

No se afirma que no existan archivos aprovechables en toda la biblioteca
de medios: esa fuente administrativa no se ha consultado. La herramienta
Woo publicada no devuelve imágenes; las afirmaciones sobre imágenes
proceden de la web pública y los originales de Merchant.

**Propuesta:** localizar y validar assets por acabado, comprobar su acceso y
dimensiones, y reparar asociaciones concretas con aprobación. No rellenar
los catorce artículos con una foto genérica ni alterar un fallback global
sin inspeccionar la configuración que lo controla.

## 3. Ocho Toke: imagen pública disponible, enlace omitido del feed

Las ocho ofertas `8198`–`8205` quedan unidas al padre Woo `8195` por sus
MPN/SKU exactos y por el
[destino original del feed](https://www.enkihogar.com/toke-mezclador-monomando-bidet-serie-toke/).
En **todas** falta `image_link`; no es una extrapolación de una sola variante.

Sin embargo, las ocho variantes públicas exponen la misma
[imagen WebP de 600×600](https://www.enkihogar.com/wp-content/uploads/2023/09/Mezclador-monomando-bide-600x600.webp):
HTTP 200, `image/webp`, firma RIFF/WEBP, 8.846 bytes. La inspección visual
muestra un único grifo plateado/cromado, no ocho imágenes fieles a cada
acabado negro, blanco, cepillado o dorado.

La omisión se localiza en los datos que llegan al feed pese a existir una
imagen en la representación pública. **No se ha demostrado qué regla del
generador, campo de variante o herencia del padre la causa.**

WebP está admitido para `image_link`; no procede atribuir esta ausencia a
ese formato ni convertir todas las fotos por conjetura. Google exige una URL
de imagen válida y representación adecuada del producto.
[Referencia oficial comprobada el 12 de septiembre](https://support.google.com/merchants/answer/6324350?hl=es).

**Propuesta:** inspeccionar el mapeo del generador con acceso administrativo
read-only autorizado y validar las imágenes de cada acabado. Solo después,
aprobar cambios exactos. No trasladar indiscriminadamente la foto cromada
común a las ocho ofertas.

## 4. Esponjera: el enlace original responde HTML/404

La oferta `1839`, SKU `100501`, padre `1838`, Cromo / Taladro, envía como
`image_link` exactamente:

<https://www.enkihogar.com/wp-content/uploads/2023/02/633-Esponjera-Gel-recta-50cm.jpg>

La prueba devuelve **HTTP 404**, `text/html; charset=UTF-8`, y bytes iniciales
`<!doctype html>`. Es la misma URL observada en la variante pública y en su
JSON-LD, que declara dimensiones cero. La unión original del feed pendiente
en el informe parcial queda ahora confirmada.

Esto prueba un recurso roto que no entrega imagen; es consistente con el
rechazo por tipo, pero no reproduce la petición histórica exacta de Google
ni determina cuándo dejó de existir el archivo.

**Propuesta:** recuperar el recurso correcto o cambiar la asociación a una
imagen válida, con aprobación; verificar HTTP 200, formato real y contenido
antes del siguiente procesamiento. La extensión `.jpg` por sí sola no basta.

## 5. Defecto adicional del feed: IDs en vez de URLs

Once ofertas contienen `additional_image_link` numérico o listas numéricas:
`8559` (`8561,`), `1839` (`1837`), `32370` (lista de diez IDs) y las ocho
Toke (`8197`). Estos valores no son URLs de imagen. Se conservan literalmente
en la evidencia; no se afirma que sean el motivo declarado de los 25 rechazos.

Revisar con acceso autorizado la transformación del campo adicional a URLs
válidas o su omisión cuando no haya recurso. No deducir rutas públicas a
partir de esos números ni añadir un endpoint de medios no autorizado.

## Matriz exacta y acción por oferta

`P`: precio válido o exclusión gobernada. `M`: imagen correcta en origen.
`T`: mapeo del feed e imagen específica por acabado. `F`: recurso roto.
Todas las acciones son propuestas, no órdenes de aplicación.

| Oferta | SKU Woo | Padre / simple | Producto / variante | Acción |
| --- | --- | --- | --- | --- |
| 8559 | BD.7107125 | Simple 8559 | SPA 200 | P |
| 32370 | 72125 | 32309 | Aqua Ceniza 100cm Quarzo | P |
| 1853 | 150201 | 1851 | Estantería con perchas 50cm Cromo | M |
| 1852 | 150202 | 1851 | Estantería con perchas 50cm Negro mate | M |
| 1850 | 150101 | 1848 | Estantería 50cm Cromo | M |
| 1849 | 150102 | 1848 | Estantería 50cm Negro mate | M |
| 1855 | 150301 | 1854 | Estantería 48cm Cromo | M |
| 1856 | Vacío; unión URL/nombre/identidad pública | Simple 1856 | Estantería 54cm Inox pulido brillo cromo | M |
| 1859 | 080102 | 1858 | Escobillero Negro mate | M |
| 1860 | 080103 | 1858 | Escobillero Laton cepillado | M |
| 1861 | 080101 | 1858 | Escobillero Cromo | M |
| 1842 | 100607 | 1840 | ARES Cromo | M |
| 1841 | 100602 | 1840 | ARES Negro mate | M |
| 1845 | 100707 | 1843 | Esponjera Inox Cromo | M |
| 1844 | 100702 | 1843 | Esponjera Inox Negro mate | M |
| 1847 | 100901 | 1846 | Esponjera de grifo 30cm Cromo | M |
| 8198 | BD.3721011.BK | 8195 | Toke Negro | T |
| 8199 | BD.3721011.BN | 8195 | Toke Níquel Cepillado | T |
| 8200 | BD.3721011.BP | 8195 | Toke Oro Rosado Cepillado | T |
| 8201 | BD.3721011.CH | 8195 | Toke Cromo | T |
| 8202 | BD.3721011.GB | 8195 | Toke Oro Cepillado | T |
| 8203 | BD.3721011.GP | 8195 | Toke Oro Pulido | T |
| 8204 | BD.3721011.PG | 8195 | Toke Oro Rosado Pulido | T |
| 8205 | BD.3721011.WH | 8195 | Toke Blanco | T |
| 1839 | 100501 | 1838 | Esponjera Gel 50cm Cromo | F |

## Disposición y siguiente frontera de aprobación

Se puede cerrar **la auditoría EAI-028**, no la recuperación de los productos.
Los originales de las 25 ofertas, pruebas y propuestas están completos para
este alcance. La configuración del generador y los registros administrativos
de medios quedan explícitamente fuera de la evidencia disponible.

Antes de corregir: Board debe aprobar objetivos exactos, precios/assets,
herramientas o intervención humana, alcance, respaldo y rollback. Después
de cualquier cambio autorizado, comprobar únicamente las ofertas afectadas
y el estado Merchant tras su ingestión; no prometer aprobación inmediata.

La entrega se adjunta como informe principal y evidencia en `ENK-32` mediante
el flujo de artefactos de Paperclip, conservando el avance parcial. No se han
editado productos, medios, feed, Merchant o Ads; no se han activado agentes
ni rutinas, instalado conectores, ampliado scopes o renovado credenciales.
