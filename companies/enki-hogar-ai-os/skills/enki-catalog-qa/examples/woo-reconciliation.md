# Ejemplo de reconciliación Woo segura

Este ejemplo usa exclusivamente `fixtures/catalog-reconciliation/v1/`; sus SKUs, IDs, precios y textos son inventados.

## Entrada bloqueada

- Perfil: `enki-catalog-reconciliation-profile/v1`, con SHA y tres filas exactas del export previo.
- Cabeceras: 14 posiciones; `Title`, `Regular Price` e `Images` aparecen dos veces y quedan diferenciadas como primera ocurrencia y `__2`.
- Alcance: un padre y una variación. La tercera fila queda fuera de alcance, pero se vigila durante el audit.
- Candidatos: cinco campos con evidencia independiente. El precio se compara en EUR bruto incluyendo IVA, no mezclando neto con bruto.

## Resultado esperado

`woo-reconcile` observa cinco campos:

- dos coinciden: título de producto del padre y acabado de la variación;
- tres difieren: precio bruto de la variación, SEO title del padre e imagen principal del padre;
- solo esas tres diferencias aparecen en `catalog-change-set.json`, todas `needs_review`, no elegibles y sin autoridad de importación;
- el título de adjunto, el segundo precio y la galería no se confunden con las primeras columnas homónimas.

El runtime no crea un CSV de importación ni llama a WooCommerce. Una ejecución sobre `woo-after-expected.csv` devuelve cinco coincidencias y cero cambios: esa es la prueba de idempotencia.

## Audit posterior

`woo-audit` compara el export previo, el posterior y el change set exacto:

- `woo-after-expected.csv`: verifica 3/3 cambios, cero cambios inesperados y cero deriva de identidad; PASS saneado.
- `woo-after-drift.csv`: aunque verifica los tres campos esperados, detecta una relación padre modificada y un stock fuera de alcance alterado; FAIL. El reporte conserva únicamente hashes para filas y valores fuera de alcance.

En un run operacional el audit solo acepta cambios `approved_for_local_export` por Board. El modo saneado existe para probar el mecanismo sin fingir una aprobación real.
