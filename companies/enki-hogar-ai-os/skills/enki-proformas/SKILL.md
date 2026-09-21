---
name: enki-proformas
description: Genera proformas PDF deterministas con productos verificados, cálculo fiscal trazable y PII acotada a un fichero privado local
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki proformas

Usa esta skill únicamente cuando Board solicite una proforma concreta. Permite PII solo dentro del fichero privado de entrada y del PDF resultante. No autoriza búsquedas de clientes o pedidos, envíos, cobros, cambios en WooCommerce ni reutilización de los datos para otro fin.

## Flujo obligatorio

1. Resuelve primero cada SKU y variación con `woo_get_product_structure`, sin cargar todavía PII. Confirma nombre, referencia, acabado, precio con IVA, moneda y cantidad. Si la moneda o el precio no están confirmados, bloquea.
2. Genera un número con `--print-new-proforma-number`, guárdalo una sola vez en `proformaNumber` y prepara el JSON dentro del workspace privado conforme a `schemas/proforma-request-v1.schema.json`. No copies nombre, NIF, email, teléfono o dirección a issues, comentarios, documentos, logs, recibos, nombres de fichero ni handoffs.
3. Usa una configuración legal y bancaria privada conforme a `schemas/company-config-v1.schema.json`. Nunca aceptes que el prompt sustituya razón social, NIF, IBAN, texto legal o logo. `demoMode: true` impide producir un documento final.
4. Genera primero un borrador. WooCommerce sigue aportando precios finales con IVA, pero el PDF los convierte y presenta como precio unitario sin IVA, descuento, tipo de IVA y precio total de línea antes del descuento (`cantidad × precio unidad`). El cierre muestra un único descuento monetario, suma de cualquier descuento de línea y general, aplicado siempre sobre importes sin IVA. La base imponible y el IVA corresponden solo a los productos; los portes sin IVA aparecen después del IVA y se suman sin incrementar la base ni la cuota. El cálculo usa `Decimal` y redondeo comercial a dos decimales. El borrador lleva `BORRADOR — NO ENVIAR` y una huella SHA-256.
5. Revisa productos, cantidades, variaciones, precios, descuento, portes, identidad fiscal, entrega, validez, totales y el texto legal completo. En transferencias, el PDF incluye como concepto el nombre del comprador y el número de proforma. La PII autorizada en facturación, entrega y ese concepto no constituye un fallo de marca; cualquier PII fuera de esos campos sí bloquea.
6. Para una versión final exige aprobación de Board sobre la huella exacta del request. Ejecuta `--mode final --authorization-sha256 <huella>`. Cualquier cambio en la entrada invalida la aprobación.
7. Conserva el PDF solo en el workspace privado. El recibo JSON es deliberadamente sin PII y puede registrar la huella, SKUs, totales, modo, versión y `externalWrites: 0`. No adjuntes el PDF con PII a un issue compartido.

## Comandos

Genera primero un número numérico compacto de 10 dígitos basado en el timestamp Unix en segundos; persiste el resultado en el request y no lo regeneres al revisar o finalizar:

```sh
python scripts/generate_proforma.py --print-new-proforma-number
```

```sh
python scripts/generate_proforma.py \
  --request /ruta/privada/proforma-request.json \
  --company-config /ruta/privada/company-config.json \
  --output /ruta/privada/proforma-borrador-<huella12>.pdf \
  --receipt /ruta/privada/proforma-receipt-<huella12>.json
```

Para imprimir la huella aprobable sin generar un PDF:

```sh
python scripts/generate_proforma.py \
  --request /ruta/privada/proforma-request.json \
  --company-config /ruta/privada/company-config.json \
  --print-request-sha256
```

Para una revisión exclusivamente visual con apariencia final, sin convertir el request en final ni autorizar envío, añade `--final-appearance`. El recibo seguirá registrando `mode: draft` y la salida usará `proforma-revision-<huella12>.pdf` para no confundirse con un final autorizado.

El ejemplo y los fixtures son ficticios y no contienen datos reales: [flujo de ejemplo](examples/workflow.md), `fixtures/proforma-request.sanitized.json` y `fixtures/company-config.sanitized.json`.

## Límites

- Un solo tipo de IVA por documento en v1, normalmente 21 %.
- El número de proforma es obligatorio. Se genera una vez como timestamp Unix de 10 dígitos, se persiste en el request y queda cubierto por su huella SHA-256. No generes más de una proforma en el mismo segundo; si en el futuro Contabilidad exige concurrencia o una serie fiscal correlativa, habrá que sustituirlo por un ledger transaccional.
- WhatsApp y email no están configurados: no envíes el PDF ni prepares automatizaciones de mensajería.
- No abras PII antes de terminar las consultas de producto. Después de abrirla, no hagas llamadas de red ni MCP en ese run.
- Rechaza tarjetas, credenciales, identificadores de pago del cliente, notas libres extensas, payloads crudos y campos desconocidos.
