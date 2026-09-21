# Merchant Center — diagnóstico EAI-012

Fecha: 2026-09-12. Fuente de cuenta: interfaz autenticada de Google Merchant
Center, en la cuenta Enki Hogar que abrió el operador para este diagnóstico.
Lectura finalizada a las 12:53 UTC (14:53 Europe/Madrid). Evidencia transcrita
y minimizada: no se conservan sesiones, IDs de cuenta/fuente, correos personales,
capturas completas, filas de clientes ni el archivo del feed.

## Conclusión

**No se observa una suspensión vigente a nivel de la cuenta seleccionada.**
La pantalla «Setup and policy issues affecting all products» muestra
«No issues for you to fix». El problema actual visible es de producto:
25 no aprobados sobre 6.613 productos (aproximadamente 0,38%). No procede
preparar ni enviar una apelación de suspensión con esta evidencia.

El acceso fallido anterior correspondía a la sesión del navegador, no demostraba
una suspensión Merchant. El operador cambió la sesión y abrió Enki. Esto
autoriza esta lectura asistida; no instala un conector ni amplía la allowlist
de los agentes. La causa y la fecha de una posible suspensión histórica siguen
sin acreditarse. No se han inspeccionado otras cuentas ni el historial completo.

## Evidencia de cuenta y fuente

| Ref. | Pantalla / selección reproducible | Observación |
| --- | --- | --- |
| MC-01 | Overview → Your business on Google → Today / All marketing methods | 6.613 productos; aprobados mostrados redondeados como 6,59K; 25 no aprobados; 0 limitados; 0 en revisión. No convertir el valor redondeado en un recuento exacto observado. |
| MC-02 | Products → Needs attention → View all issues; países, métodos y fuentes: All | 25 productos en la tabla; 22 con `Missing product image`, 2 con `Invalid price`, 1 con `Unsupported image type [image_link]`. Última actualización visible: 2026-09-12 00:00. Los conteos de incidencias son los mostrados por Google, no un export deduplicado por SKU. |
| MC-03 | Products → Needs attention → View setup and policy issues | Ningún problema de configuración/políticas a nivel de cuenta. El modo inicial «Prioritized fixes» mostraba todo resuelto; fue necesario desactivarlo para ver los rechazos de producto. |
| MC-04 | Settings → Data sources → Primary sources → Feed Google → Latest update | File (URL), España, español, feed label `-`; última actualización 2026-09-12 00:00 CEST. 6.613 productos actualizados, 0 nuevos, todos los atributos reconocidos, sin problemas de archivo. Esto prueba procesamiento, no aprobación de cada artículo. |
| MC-05 | Settings → Business info → Details | Dominio `enkihogar.com` verificado y reclamado. Dirección, correo comercial y teléfono coinciden con los datos públicos consultados; nombre comercial Enki Hogar frente a razón social Grupo Enki O.E. No se ha auditado la identidad fiscal ni el perfil de pagos. |
| MC-06 | Shipping and returns → Shipping policies | Cuatro servicios completos para España: Buades, Sanycces, Lealbath y estándar. Todos muestran 2–10 días; estándar cubre todos los productos. No se han inspeccionado tarifas, códigos postales, precedencia de reglas ni checkout. |
| MC-07 | Shipping and returns → Return policies | Política Standard for Spain verificada, 14 días, `Customer responsibility`, 6.613 productos. No aparecen excepciones en la tabla. El resumen inferior muestra `Free` para el 100%; no se ha resuelto la diferencia semántica con el coste a cargo del cliente. |
| MC-08 | Overview → What to do next | El aviso de la cuenta Ads enlazada dice que no se publican anuncios porque campañas o grupos están pausados/eliminados. Es evidencia de la UI Merchant, no una auditoría directa de Ads ni autorización para activar campañas. |

La fuente automática «Found by Google» muestra 0 productos activos y 22
archivados. No se relaciona ese 22 con los 22 rechazos de imagen: coincidir en
un contador no demuestra identidad. Los 6.613 productos están en Feed Google.

## Contraste público acotado

Tres GET sin autenticación, formularios ni carrito devolvieron HTTP 200 el
2026-09-12 entre 12:51:14 y 12:51:17 UTC. No se guardó HTML crudo. La consulta
web previa tenía caché y falló para envíos; el contraste fechado siguiente
procede de las lecturas directas posteriores, no de esa caché.

- [Aviso legal](https://www.enkihogar.com/aviso-legal/): identifica razón social,
  dirección y contacto. Los datos de contacto coinciden con MC-05. No se emite
  un dictamen de cumplimiento legal ni una validación del perfil de pagos.
- [Condiciones de compra](https://www.enkihogar.com/condiciones-generales-de-compra/):
  territorio peninsular; entrega habitual 2–10 días, máximo indicado de 15;
  precios con IVA y transporte separado. Los 2–10 días coinciden con el resumen
  Merchant, pero faltan comprobar el máximo, las zonas y las tarifas reales.
- [Envíos y devoluciones](https://www.enkihogar.com/envios-y-devoluciones/):
  envíos peninsulares, transporte calculado en compra, 14 días para artículos
  admitidos, retorno por desistimiento a cargo del cliente y excepciones para
  muebles/bajo pedido/personalizados. Contrastar esas excepciones con MC-07:
  la tabla Merchant aplica la política general a todos los productos. Es un
  **gap de verificación**, no una infracción confirmada ni causa de suspensión.

## Acciones propuestas, sin aplicación

| Orden | Alcance / responsable | Comprobación y propuesta | Criterio de recuperación |
| --- | --- | --- | --- |
| 1 | 22 rechazos sin imagen; Ecommerce + Technology | Filtrar por `Missing product image`, obtener el conjunto exacto afectado y cotejar `image_link` enviado con la imagen del producto/variación y su fuente Woo autorizada. Determinar si el origen es el dato o el exportador; no asumir que falta también en la web. Preparar la mínima corrección en origen para revisión humana. | Imagen correcta y accesible en el dato enviado; los mismos artículos dejan de tener ese rechazo después del procesamiento/rastreo. |
| 2 | 2 precios inválidos; Ecommerce | Filtrar `Invalid price`; Merchant indica precio enviado menor o igual a cero. Cotejar artículo/variación, moneda, impuestos y precio de destino con Woo actual. No inventar un precio ni derivarlo del título o del ID Merchant. | Precio real superior a cero, consistente entre Woo, destino y feed; desaparición de ese rechazo. |
| 3 | 1 imagen de formato no admitido; Technology | Filtrar `Unsupported image type [image_link]`; comprobar URL, redirecciones, MIME y bytes de la respuesta. No deducir el formato por la extensión ni atribuirlo a WebP sin prueba. Preparar una URL que entregue una imagen válida. | Google procesa una imagen admitida del producto correcto y desaparece el rechazo. |
| 4 | Políticas; Ecommerce + operador | Revisar detalle de costes/excepciones de devolución y cobertura peninsular frente a las políticas públicas. Resolver el resumen `Free` frente a `Customer responsibility` antes de proponer cambios. | Matriz por producto/zona documentada y coherente; discrepancias confirmadas separadas de dudas de la UI. |
| 5 | Adquisición; Growth | Verificar en Ads el aviso MC-08 y el mandato de pausa antes de cualquier propuesta. Mantener los límites financieros de EAI-008/EAI-024. | Estado Ads fechado y explicación de la pausa; activación solo con aprobación independiente, presupuesto y medición suficientes. |

Guías oficiales consultadas el 2026-09-12, usadas como documentación y no como
evidencia del estado de Enki: [imagen ausente](https://support.google.com/merchants/answer/12158124?hl=es),
[precio inválido](https://support.google.com/merchants/answer/12158688?hl=es) e
[imagen no admitida](https://support.google.com/merchants/answer/12159031?hl=es).
La última guía admite, entre otros, WebP; el texto abreviado de la incidencia
en la UI solo enumera JPEG/PNG/GIF. Ninguno identifica el formato del artículo
afectado. Google advierte que los cambios pueden tardar 24–72 horas en reflejarse;
ese plazo no es una garantía de aprobación.

## Gates y límites del cierre

- Esta entrega diagnostica el estado visible; **no corrige** los 25 rechazos.
  No se descargó el feed completo ni se realizó matching Merchant–Woo. Antes
  de implementar, congelar el conjunto exacto de artículos y la evidencia de
  origen; los IDs Merchant no prueban por sí solos identidad Woo o SKU.
- Cualquier cambio exige autorización exacta y evidencia antes/después. No se
  han pulsado Update, Save, Allow ads, Add exception ni Request review, ni se
  han modificado productos, feeds, políticas, campañas o permisos.
- Tras una corrección autorizada: verificar el siguiente procesamiento,
  reconsultar las tres incidencias y registrar aprobación por artículo y
  destino. No declarar recuperación solo porque el archivo haya procesado bien.
- Si aparece una suspensión nueva: conservar el mensaje exacto, país/destino,
  fecha, evidencia y elegibilidad de revisión; contrastar identidad, sitio y
  feed, y someter la apelación exacta al operador. No enviar apelaciones
  preventivas ni intentar saltarse periodos de bloqueo. Véase la
  [guía de revisión de Google](https://support.google.com/merchants/answer/13585221?hl=es).
- No se infieren la causa de una suspensión histórica, una fecha de recuperación,
  la salud de otras cuentas ni rentabilidad publicitaria. La evidencia manual
  actual no sustituye el export/matching reproducible requerido por EAI-024.
- La entrega operativa debe conservar este informe como artefacto accesible
  desde ENK-6 antes del cierre del diagnóstico. Su disposición y cualquier
  seguimiento se registran en el issue; cerrar el diagnóstico no autoriza
  correcciones ni reanuda los agentes.
