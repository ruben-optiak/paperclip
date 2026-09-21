# Proformas con PII acotada

Customer Experience prepara proformas PDF a partir de productos verificados y un fichero privado aportado por Board. Este flujo no consulta clientes ni pedidos y no envía el documento.

## Frontera de datos

- Resuelve SKU, variación, moneda y precio con IVA mediante WooCommerce antes de cargar PII.
- Aunque la fuente comercial sea el precio final de WooCommerce, la proforma muestra por línea el producto, la cantidad, el precio unitario sin IVA, el descuento, el tipo de IVA y el precio total antes del descuento (`cantidad × precio unidad`). El resumen consolida todos los descuentos en una sola línea monetaria aplicada sobre importes sin IVA. Los portes sin IVA quedan fuera de la base imponible y de la cuota: se muestran después del IVA y se suman para obtener el total.
- Guarda el request y la configuración de empresa dentro del workspace privado del agente o fuera de cualquier repositorio. Nunca los adjuntes a un issue ni los copies a comentarios, documentos, logs o Git.
- El PDF es el único artefacto que puede contener nombre, NIF/CIF, email, teléfono o dirección. No lo subas como attachment compartido; entrégalo a Board desde el workspace privado.
- El recibo generado es compartible porque solo conserva hashes, referencias de producto, totales, modo y evidencia de cero envíos.
- El nombre de fichero está derivado de la huella o del número de proforma; nunca incluye el nombre del cliente.

## Configuración privada

Crea dos ficheros fuera de Git a partir de los fixtures sanitizados de `skills/enki-proformas/fixtures/`:

- `company-config.json`: razón social, NIF, dirección, email/teléfono, web, banco, IBAN, texto legal completo de privacidad y logo. El texto legal puede ocupar hasta 1.600 caracteres y debe ser el aprobado para GRUPO ENKI O.E.; mantenlo en esta configuración privada, no en Git. Mantén `demoMode: true` hasta validar todo; una proforma final lo rechaza.
- `proforma-request.json`: número generado y persistido, fecha/validez, cliente, facturación/entrega, líneas resueltas, descuento, portes, IVA, pago y notas breves.

No uses el PDF histórico como fuente automática del siguiente número. Genera el identificador con `--print-new-proforma-number`; devuelve un timestamp Unix numérico de 10 dígitos. Guárdalo en el request antes de calcular la huella y no lo vuelvas a generar durante revisiones. No generes dos proformas en el mismo segundo. Es un identificador comercial compacto, no una serie fiscal correlativa.

## Operación

1. Genera y persiste el número con `--print-new-proforma-number`.
2. Calcula la huella sin generar el documento con `--print-request-sha256`.
3. Genera el borrador. El nombre exigido es `proforma-borrador-<huella12>.pdf` y contiene una marca de agua. Para revisar únicamente el aspecto de la versión final puedes añadir `--final-appearance`; esto no cambia el modo interno, la huella ni la prohibición de envío, y usa `proforma-revision-<huella12>.pdf` para distinguirlo del final autorizado.
4. Comprueba identidad fiscal, entrega, referencias, cantidades, precio unitario sin IVA, descuentos, portes sin IVA, base imponible, tipo y cuota de IVA, total con IVA y validez.
   Si el pago es por transferencia, comprueba también el IBAN y que el concepto muestre el nombre del comprador y el número de proforma.
5. Board aprueba la huella completa de 64 caracteres. Cualquier byte lógico cambiado en el JSON produce otra huella.
6. Cambia la configuración real a `demoMode: false` y genera con `--mode final --authorization-sha256 <huella>`. El nombre exigido es `proforma-<numero>.pdf`.
7. Conserva el recibo PII-free y el PDF en el workspace privado. La operación declara `externalWrites: 0` y `messageSent: false`.

El script falla ante campos desconocidos, fechas inválidas, descuentos fuera de rango, moneda distinta de EUR, más de un modelo fiscal v1, configuración demo en modo final, nombre de salida no canónico o autorización distinta.

## Pendiente deliberado

WhatsApp y email están fuera de alcance. No hay herramientas, credenciales, plantillas de envío ni permiso para comunicar la proforma. Su incorporación necesitará una revisión separada de identidad, minimización, consentimiento, destinatario exacto, retención, idempotencia y aprobación.
