# Migración de catálogos históricos a contratos v1

Este runbook define cómo convertir los artefactos históricos de `enki-hogar` a los contratos versionados de Enki AI OS sin perder evidencia ni crear una segunda fuente de verdad. La migración produce únicamente archivos locales de revisión. No importa, publica ni modifica WooCommerce.

## Contratos de destino

- `enki-catalog-run/v1`: manifiesto inmutable de una ejecución, sus fuentes, reglas, runtime, artefactos, etapas y decisión.
- `enki-catalog-field-evidence/v1`: una observación de un único campo de una única entidad, con valor crudo, normalizado, fuente, localización exacta, confianza y lineage.
- `enki-catalog-change-set/v1`: diferencia revisable entre el snapshot comercial actual y el candidato respaldado por evidencia. Su máxima autoridad es entrar en un borrador local de exportación.

Los schemas canónicos viven en `references/contracts/`. La skill `enki-catalog-qa` contiene mirrors gobernados por hash, fixtures saneados y `scripts/validate_catalog_contracts.mjs`.

## Principios que no se negocian

1. WooCommerce live sigue siendo la única verdad comercial actual. El CSV completo recién exportado es solo una fotografía inmutable para comparar.
2. Un PDF oficial puede ser autoridad para precio de tarifa y hechos técnicos, pero no demuestra stock, publicación, URL ni precio vigente en Woo.
3. Se conserva siempre el valor crudo. El valor normalizado añade interpretación; nunca lo reemplaza.
4. Cada campo tiene su propia evidencia. Una fila consolidada con veinte columnas se descompone en hasta veinte observaciones, no en un objeto opaco.
5. Las coordenadas se conservan cuando existen. Si el histórico solo conserva página, se registra `pdf_page`; un campo crítico con esa precisión no puede aprobarse hasta reconstruir geometría o revisarlo contra evidencia suficiente.
6. Una regla manual es una regla versionada, no una fuente. Se registra con nombre, versión y SHA-256.
7. Estados como `validated`, `resolved` o `auto_clear` del histórico no prueban aprobación Board. Se migran conservadoramente como candidato o pendiente de revisión.
8. No se copian rutas absolutas. Se reemplazan por rutas lógicas relativas y, si interesa demostrar qué locator histórico se vio, se conserva únicamente su SHA-256 en `legacyLocatorSha256`.
9. `needs_manual_review.csv` es una vista derivada. No es un registro canónico y debe poder regenerarse desde decisiones, confianza y bloqueos.
10. Ningún contrato v1 contiene secretos, PII, credenciales, tokens, `.env`, exports de clientes o paths privados.

## Snapshot de entrada

Antes de migrar:

1. Congela una copia de los CSV históricos y del PDF oficial en un directorio de run fuera de Git.
2. Genera SHA-256 del PDF, export Woo completo, CSV históricos y reglas manuales.
3. Registra fecha y zona horaria del snapshot. No uses la fecha de modificación del fichero como sustituto de `snapshotAt` si conoces la fecha real de obtención.
4. Rechaza el run si faltan el PDF oficial o el export Woo completo y reciente para la comparación solicitada.
5. Asigna un `runKey` nuevo. Un cambio de input, runtime o reglas crea otra revisión o run; nunca reescribe el anterior.

Estructura lógica recomendada:

```text
catalog-runs/<run-key>/
├── sources/
│   ├── <marca>/catalogo-oficial.pdf
│   └── woocommerce/products-full.csv
├── rules/
├── pages/
├── artifacts/
│   ├── catalog-field-evidence.jsonl
│   └── catalog-change-set.json
└── catalog-run.json
```

Los paths guardados en los contratos empiezan en la raíz lógica del run (`sources/...`, `pages/...`, `artifacts/...`). La ruta del host nunca forma parte del documento.

## Mapeo de datasets históricos

| Dataset histórico | Destino v1 | Regla de migración |
| --- | --- | --- |
| `pdf_pages.csv` | artefacto `page_manifest` del run | Conserva página, layout, stage y contadores. Convierte `image_path` a `pages/page-NNNN.png`; no lo trata como hecho de producto. |
| `pdf_text_blocks_raw.csv` | localización `pdf_region` | Conserva `page`, `block_index`, texto y `x0,y0,x1,y1`. Las cajas relevantes se etiquetan `reference`, `value`, `header`, `unit` o `context`. |
| `pdf_catalog_master.csv` | evidencia candidata por campo | Crea una evidencia por cada campo no vacío. Conserva SKU/ref, página, valor crudo, normalizado, confianza y SHA de la fila. `evidence_refs` se traduce a path lógico y coordenadas si aún pueden enlazarse. |
| `catalog_master_operativo.csv` | evidencia derivada | No se declara como fuente oficial. Cada valor apunta mediante `derivedFromEvidenceKeys` a la evidencia cruda que lo originó y registra transformación/regla. |
| export Woo completo | evidencia actual por celda | Lee por posición, incluso con cabeceras duplicadas. Conserva número de fila, SHA de fila, índice cero-based, encabezado original y encabezado deduplicado. |
| `comparativa_catalogo_vs_web.csv` | `catalog-change-set/v1` | Separa `current` de `candidate`; ambos referencian evidencia. Conserva estado, motivo, base fiscal y fila histórica. |
| `pdf_extraction_issues.csv` | decisión/confianza de evidencia | Migra el tipo de incidencia y detalle a `confidence.reasons` y `decision.note`; una ambigüedad de fuente pasa a `blocked_source_conflict`. |
| `pdf_validation_queue.csv` | revisión y decisión pendiente | Conserva campo, actual, issue, acción sugerida y SHA de fila. Una resolución histórica no se convierte en aprobación Board sin actor y timestamp verificables. |
| `manual_resolution_rules.csv` | `run.rulesets[]` | Snapshot inmutable con versión y SHA-256. Su autoridad es `versioned_operator_rule_not_source_truth`. |
| `needs_manual_review.csv` | vista regenerable | No se ingiere como autoridad. Puede registrarse en `migrationRefs` para reconciliar conteos, pero la cola se vuelve a calcular. |

Los masters específicos de Enki Espejos, Mundilite o Chicandbath pueden tener columnas adicionales. Se mapean a nombres de campo estables y conservan la cabecera histórica en lineage; las heurísticas de cada marca pertenecen a adaptadores versionados, no al contrato común.

## Identidad y modelo de producto

La identidad se resuelve antes de comparar valores:

- `manufacturerRef` y `canonicalSku` identifican la referencia de fabricante y su SKU normalizado.
- `wooIdentity` conserva por separado product ID, variation ID, SKU, parent SKU, EAN y slug observados.
- `entity.kind` distingue `simple`, `parent`, `variation`, `configurator_option`, `component`, `assisted_sale` y `unknown`.
- El nombre o slug parecido nunca basta para hacer matching.
- Una opción informativa no se convierte en variación vendible y un configurador no se expande como producto cartesiano sin evidencia explícita.

Si la identidad es ambigua, el change se marca `ambiguous_identity` y no es exportable.

## Precisión de evidencia

### PDF con geometría

Usa `pdf_region` y conserva:

- hash y path lógico del PDF;
- número de página uno-based;
- hash/path de la imagen renderizada;
- ancho y alto de página en puntos PDF;
- cajas de referencia, valor, unidad, encabezado local y contexto.

Todas las cajas deben tener área positiva y quedar dentro de página. En tablas densas, el precio debe emparejarse espacialmente con la referencia. Un encabezado local o subgrupo prevalece sobre un encabezado global cuando así lo demuestra el layout.

### PDF histórico sin geometría recuperable

Usa `pdf_page`, explica `reasonGeometryUnavailable` y conserva la página. No inventes coordenadas. Los campos críticos permanecen `needs_review` hasta disponer de precisión suficiente.

### CSV WooCommerce

Usa `csv_cell`. `rowNumber` cuenta la cabecera como fila 1 y `columnIndex` empieza en cero. Guarda simultáneamente:

- SHA-256 del fichero y de la fila serializada canónicamente;
- índice de columna;
- encabezado original;
- encabezado deduplicado determinista, por ejemplo `Precio normal__26`.

Nunca uses un parser basado solo en nombre de cabecera cuando pueda haber duplicados.

## Traducción conservadora de estados

| Estado histórico | Decisión v1 máxima al migrar |
| --- | --- |
| extracción correcta, `auto_clear`, `validated` | `candidate` o `proposed` |
| `needs_review`, mismatch no resuelto | `needs_review` |
| conflicto entre fuentes autorizadas | `blocked_source_conflict` |
| descartado con registro histórico | `rejected` solo si existe decisión Board verificable; si no, `needs_review` con nota |
| `resolved`, `approved`, `manual_ok` sin actor/timestamp Board | `needs_review`; nunca reconstruir aprobación |
| superseded con decisión verificable | `superseded`; en otro caso conservar lineage y revisión pendiente |

Las decisiones terminales requieren `actorType: board`, `actorRef` y `decidedAt`. Incluso una aprobación válida declara `isExternalMutationAuthority: false`: autoriza únicamente incluir el cambio en un fichero local.

## Construcción del change set

1. Selecciona el export Woo completo mediante `scope.wooSnapshotSourceKey`.
2. Define alcance explícito por tipos de entidad, grupos de campo e inclusiones/exclusiones.
3. Para cada cambio, referencia evidencia actual y candidata con la misma `entityKey`, `entityKind`, grupo y nombre de campo.
4. Conserva valores crudos y normalizados en ambos lados.
5. Declara la base fiscal: bruto con IVA, neto sin IVA, desconocida o no aplicable. No compares importes con bases diferentes.
6. Calcula confianza y riesgo. SKU, EAN, compatibilidad, precio, stock y atributos que cambian la compra son críticos.
7. Mantén `exportEligibility.eligible: false` hasta decisión Board exacta y sin blockers.
8. Recalcula `summary` desde los cambios; no copies contadores históricos sin reconciliarlos.

Una baja es siempre `retire_entity_candidate`; nunca autoriza borrado. Un alta es `create_entity`, pero sigue siendo un borrador local.

## Validación

Valida primero los tres documentos contra JSON Schema 2020-12 en modo estricto y después ejecuta las invariantes cruzadas:

```sh
node skills/enki-catalog-qa/scripts/validate_catalog_contracts.mjs \
  --run catalog-run.json \
  --evidence evidence-current.json \
  --evidence evidence-candidate.json \
  --change-set catalog-change-set.json
```

El validador comprueba, entre otros:

- keys únicas y referencias existentes;
- coincidencia exacta de run, marca, procedencia, fuentes y checksums;
- paths relativos, portables y no sensibles;
- cajas PDF válidas y dentro de página;
- identidad/campo/valor coherentes entre evidencia y change set;
- snapshot Woo como única autoridad comercial actual;
- reglas versionadas existentes;
- contadores recalculados;
- aprobación Board y elegibilidad local coherentes;
- bloqueo permanente de escrituras externas.

Los ejemplos bajo `skills/enki-catalog-qa/fixtures/catalog-contracts/` y la [regresión multimarca](catalog-regression.md) son datos inventados y saneados. Sirven para comprobar contratos, conteos y relaciones geométricas, no para decidir nada sobre el catálogo real.

## Cierre y auditoría post-import

La migración termina cuando schemas y validación semántica pasan, los conteos históricos se reconcilian y toda pérdida de precisión está declarada. No termina con un import.

Si un humano decide importar posteriormente un borrador en WooCommerce:

1. conserva el change set aprobado y su checksum;
2. ejecuta la importación fuera de estos contratos, mediante el procedimiento humano gobernado;
3. genera un nuevo export Woo completo;
4. crea un run nuevo y repite comparación;
5. verifica altas/bajas inesperadas, duplicados, variaciones huérfanas y cambios fuera de alcance;
6. solo entonces cierra la operación.

Producción puede reutilizar un run aprobado únicamente cuando inputs, hashes, runtime y reglas son idénticos. Si cualquiera cambia, se crea otro run y se repite QA.
