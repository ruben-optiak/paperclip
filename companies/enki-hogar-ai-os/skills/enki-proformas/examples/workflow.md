# Ejemplo ficticio

1. Board solicita dos unidades de un SKU y un descuento global del 10 %.
2. Customer Experience confirma previamente en WooCommerce la variación exacta, el precio con IVA y EUR.
3. El operador guarda los datos ficticios/privados en un JSON del workspace del agente.
4. El agente genera `proforma-borrador-<huella12>.pdf` y devuelve únicamente la huella y los totales en el comentario.
5. Board revisa el PDF local y aprueba esa huella exacta.
6. El agente genera `proforma-<numero>.pdf` con `--mode final`; no lo envía por ningún canal.

El recibo registra SKUs y cifras, pero nunca el nombre, NIF, email, teléfono o dirección del cliente.
