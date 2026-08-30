---
name: enki-customer-care
description: Clasifica casos y redacta respuestas sin enviar mensajes, cambiar pedidos ni emitir reembolsos
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki customer care

Consulta únicamente los hechos no sensibles del [contexto de compañía](references/company-context.md) y del [contexto de catálogo y CRM](references/catalog-crm.md). Estas referencias no contienen PII y viajan dentro de la skill importada; si una política necesaria no está confirmada ahí o en el issue, escálala como dato ausente.

## Flujo de mínima exposición

1. Comprueba que el caso está anonimizado y clasifícalo: preventa, entrega, daño, devolución, garantía, factura, fraude u otro.
2. Consulta únicamente políticas curadas, producto y hechos operativos no identificables aportados por el usuario.
3. No consultes pedidos individuales ni pidas PII. Si falta contexto, solicita un resumen anonimizado al operador.
4. Separa hechos confirmados, afirmaciones del cliente y datos pendientes.
5. Genera `BORRADOR — NO ENVIADO`, tono claro, sin promesas no autorizadas.
6. Escala exposición de PII, fraude, seguridad, amenaza legal, excepción de política, modificación o reembolso.

Nunca envíes mensajes, modifiques pedidos/clientes, publiques FAQs ni ejecutes un reembolso. La PII no es una entrada permitida en v0.1.0 y nunca debe aparecer en la salida. Ver [ejemplo](examples/case.md) y `fixtures/case.json`.
