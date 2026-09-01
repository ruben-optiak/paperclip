# Regresión multimarca de catálogo

Este runbook gobierna la suite `enki-catalog-regression-suite/v1`. Su objetivo es detectar cambios accidentales en conteos, geometría, estados QA, roles de producto y lectura posicional de WooCommerce antes de ejecutar un catálogo real.

La suite no es un catálogo, no es una copia de las tarifas y no contiene imágenes ni datos comerciales reales. Conserva únicamente patrones geométricos mínimos derivados de una revisión visual histórica y sustituye referencias, precios, textos y nombres de opción por valores inventados. Los SHA-256 de `source` identifican de forma determinista la fuente lógica sintética de cada caso; no son checksums de los PDFs reales ni implican que esos binarios estén incluidos.

## Cobertura v1

| Marca | Snapshot/página revisada | Fixture saneado | Riesgo fijado |
| --- | --- | --- | --- |
| Buades | `2026-04-11`, página 17 | `buades-table-multi-price` | tabla por columnas; varios SKU pueden compartir el siguiente precio válido a su derecha |
| Buades | `2026-04-11`, página 39 | `buades-detail-card` | detalle con una pareja referencia/precio por fila |
| Enki Espejos | `2026-05-31`, página 11 | `enki-espejos-grid` | ficha/grid con tabla compacta de variantes |
| Enki Espejos | `2026-05-31`, página 22 | `enki-espejos-columns` | dos tablas independientes en la misma banda vertical; no se pueden cruzar columnas |
| Mundilite | `2026-04-27`, página 12 | `mundilite-finish-matrix` | una referencia base y cuatro precios según acabado; el parent no hereda un precio inexistente |
| Chicandbath | `2026-07-11`, página 60 | `chicandbath-configurator-matrix` | matriz ancho/precio y separación entre opción de configurador, componente y venta asistida |

La selección es deliberadamente mínima. No conserva PDFs, rasters, logos, fotografías, descripciones, referencias de fabricante ni importes originales.

## Gate local

Ejecuta el validador autocontenido desde la raíz del repositorio:

```sh
node companies/enki-hogar-ai-os/skills/enki-catalog-qa/scripts/validate_catalog_regression.mjs \
  --manifest companies/enki-hogar-ai-os/skills/enki-catalog-qa/fixtures/catalog-regression/v1/manifest.json
```

El resultado válido debe informar:

- `6` fixtures;
- las cuatro marcas requeridas;
- `table`, `grid`, `detail`, `columns`, `multi_sku_price`, `finish_matrix` y `configurator`;
- `21` pares geométricos y `21` registros `enki-catalog-field-evidence/v1`;
- `2` cabeceras Woo duplicadas preservadas por posición.

`scripts/check.sh` y `scripts/validate-package.mjs` ejecutan este gate automáticamente. El manifiesto fija SHA-256 de cada fixture y del CSV Woo; cualquier edición exige revisar el cambio y actualizar el hash de forma explícita.

## Qué comprueba

1. Todas las cajas tienen área positiva y permanecen dentro de la página lógica.
2. `row_left_to_right` asigna precios por fila y dirección. Cuando hay menos precios que referencias, un precio se comparte únicamente hasta el siguiente precio situado a la derecha.
3. `matrix_by_headers` exige simultáneamente una referencia/configuración a la izquierda y una cabecera de columna encima.
4. Los pares calculados coinciden exactamente con el oracle versionado.
5. Conteos de elementos, evidencias, roles de entidad y estados QA coinciden con el esperado.
6. Cada pareja se proyecta a evidencia de campo v1 con cajas de referencia, valor y cabecera, sin autoridad comercial o de escritura.
7. Las cabeceras Woo duplicadas se renombran determinísticamente por posición (`__2`, `__3`, etc.) sin sobrescribir valores.
8. Fixtures y manifiesto rechazan rutas absolutas, UUID de base de datos, email/PII, credenciales, tokens y nombres de fichero sensibles.

`auto_clear` en un fixture solo expresa la expectativa del extractor. Se proyecta como observación, nunca como aprobación Board. `needs_review` y `needs_manual_review` se proyectan conservadoramente a revisión pendiente.

## Añadir o cambiar un fixture

1. Congela y revisa visualmente una página de un snapshot histórico fuera de Git.
2. Identifica el fallo mínimo que debe sobrevivir: relación espacial, cabecera local, matriz, rol de entidad o estado QA.
3. Crea un JSON nuevo con geometría reducida y valores totalmente inventados. No copies texto comercial, SKU, precio, imagen, path ni dato personal.
4. Añade el oracle exacto de pares y conteos.
5. Añade el fichero al manifiesto con SHA-256.
6. Añade una mutación negativa que demuestre que el riesgo concreto es detectable.
7. Ejecuta el test dirigido y después el gate completo.

Una nueva marca o regla no sustituye automáticamente una anterior. Si cambia el layout o el adaptador, conserva el fixture histórico cuando siga representando un riesgo real y añade una revisión nueva.

## Frontera con EAI-020 y datos reales

Esta suite aporta el corpus/oracle y permanece inmutable. EAI-020 ya conecta mediante el [core y los cuatro adaptadores versionados](catalog-adapters.md), pero no mueve el oracle dentro del runtime: primero produce parejas ignorando `expected` y `pairing`, y solo después las compara. Las reglas desconocidas siguen fallando cerrado.

Los adaptadores alimentan la [reconciliación posicional de EAI-021](catalog-reconciliation.md) y su replay acotado. No autorizan `ENK-7`, un barrido de todos los catálogos, un CSV de importación ni ningún cambio en WooCommerce. Un run real sigue necesitando PDF oficial congelado, export Woo completo y reciente, contratos v1, QA humana y aprobación separada.
