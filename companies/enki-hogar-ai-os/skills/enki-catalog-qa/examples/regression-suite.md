# Ejemplo de regresión multimarca

El manifiesto saneado vive en `fixtures/catalog-regression/v1/manifest.json`. Contiene seis casos mínimos y valores inventados; no es evidencia de precio, stock, surtido o disponibilidad real.

Ejecuta:

```sh
node scripts/validate_catalog_regression.mjs \
  --manifest fixtures/catalog-regression/v1/manifest.json
```

Un resultado válido informa cuatro marcas, siete features, veintiún pares geométricos y veintiuna observaciones compatibles con `enki-catalog-field-evidence/v1`.

Ejemplo conceptual del caso Buades denso:

```text
REF-A   REF-B   110.00 EUR   REF-C   145.00 EUR
  └───────┴──────────┘          └──────────┘
```

`REF-A` y `REF-B` comparten el primer precio situado a su derecha; `REF-C` usa el siguiente. El oracle impide que un cambio de parser asigne el primer precio a las tres referencias o cruce una columna independiente.

En Chicandbath, el oracle cruza fila y cabecera:

```text
                  60 cm       80 cm
CONFIG-A          310.00      335.00
COMPONENT-B       125.00      145.00
```

Las cuatro celdas mantienen su ancho y rol. No se convierten automáticamente en combinaciones Woo vendibles y permanecen en revisión manual.
