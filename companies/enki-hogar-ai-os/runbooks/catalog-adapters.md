# Core de extracción y adaptadores de marca

Este runbook gobierna el core de adaptadores `0.2.0`, conservado dentro de `enki-catalog-pipeline` `0.3.0`, el registro `enki-catalog-adapter-registry/v1` y las definiciones `enki-catalog-adapter/v1` de EAI-020.

La frontera es deliberada:

```text
snapshot oficial congelado
  → raster + inventario geométrico (EAI-017)
  → candidatos clasificados de página
  → adaptador exacto de marca/snapshot/página
  → parejas observadas + métricas locales (EAI-020)
  → evidencia/change set v1 + QA humana (EAI-018)
  → reconciliación Woo segura y audit posterior (EAI-021)
```

El runtime no aprende una página desconocida, no genera un master comercial, no consulta WooCommerce y no produce un CSV de importación. Su salida `enki-catalog-adapter-result/v1` es observación local sin autoridad comercial o externa.

## Diseño y ownership

El core común contiene únicamente validación de cajas, orden estable, agrupación geométrica, métricas y `row_left_to_right`. Esta última estrategia se promovió porque el oracle la demuestra independientemente en Buades, Enki Espejos y Mundilite.

`matrix_by_headers` permanece en el módulo Chicandbath. Una única marca no basta para elevar una heurística al core. El registro documenta la evidencia de cada promoción y el gate rechaza una estrategia core sin al menos dos marcas exactas.

| Adaptador | Versión | Alcance cerrado | Fixtures | Pares | Cobertura/error requeridos |
| --- | --- | --- | ---: | ---: | --- |
| `buades-2026-04-11-v1` | `1.0.0` | snapshot `2026-04-11`, páginas 17 y 39 | 2 | 6 | `1 / 0` |
| `enki-espejos-2026-05-31-v1` | `1.0.0` | snapshot `2026-05-31`, páginas 11 y 22 | 2 | 7 | `1 / 0` |
| `mundilite-2026-04-27-v1` | `1.0.0` | snapshot `2026-04-27`, página 12 | 1 | 4 | `1 / 0` |
| `chicandbath-2026-07-11-v1` | `1.0.0` | snapshot `2026-07-11`, página 60 | 1 | 4 | `1 / 0` |

`1 / 0` significa cobertura de sujetos del 100% y tasa de error de pares 0. Además, cada definición exige pass rate de fixtures 100%. Snapshot, página, features, definición y fixture están fijados por SHA-256; cualquier valor desconocido falla cerrado.

## Gate independiente

Desde la raíz del repo:

```sh
PYTHONPATH=companies/enki-hogar-ai-os/scripts/catalog-pipeline/src \
PYTHONDONTWRITEBYTECODE=1 uv run \
  --project companies/enki-hogar-ai-os/scripts/catalog-pipeline \
  --locked --isolated --no-env-file \
  python -m enki_catalog_pipeline adapter-regression \
  --manifest companies/enki-hogar-ai-os/skills/enki-catalog-qa/fixtures/catalog-regression/v1/manifest.json
```

El resultado válido contiene exactamente:

- cuatro adaptadores y seis fixtures;
- 21 pares esperados y 21 producidos;
- `subjectCoverage: 1`;
- `pairErrorCount: 0` y `pairErrorRate: 0`;
- `fixturePassRate: 1`;
- autoridad comercial, Woo y mutación externa en `false`.

La extracción se ejecuta sin leer `expected` ni `pairing` del fixture. Solo después, el harness compara las parejas producidas con `expected.pairs` del oracle EAI-019. Por eso una modificación del oracle no puede hacer pasar el adaptador: primero fallan sus hashes; una revisión legítima requiere un fixture nuevo, definición nueva y revisión explícita.

## Cambiar o añadir un adaptador

1. Congela el nuevo snapshot oficial y prepara sus páginas fuera de Git.
2. Conserva el fallo mínimo como fixture saneado nuevo; no edites un caso histórico para ocultar drift.
3. Mantén en el adaptador todo lo específico de título, familia, página, acabado, configurador o rango.
4. Solo promueve una primitiva al core cuando al menos dos marcas independientes la demuestren y registra ambas en `corePromotions`.
5. Crea una definición nueva; no reescribas una versión usada por evidencia histórica.
6. Actualiza hashes, schema, pruebas positivas y una mutación negativa representativa.
7. Exige cobertura 1, error 0 y el gate completo antes de un replay.

## Lo que EAI-020 sí y no desbloquea

EAI-021 consume estos resultados únicamente mediante un [perfil de reconciliación posicional](catalog-reconciliation.md) exacto. No autoriza ejecutar un catálogo más reciente bajo una definición antigua, procesar todas las marcas, reabrir `ENK-7`, importar WooCommerce, publicar, cambiar precio/stock ni cargar la proyección de soporte.

Un PDF nuevo aunque sea de la misma marca es `unknown snapshot` hasta que se compare visualmente, se añada un fixture saneado y se versione su adaptador. Las parejas resultantes siguen necesitando los contratos EAI-018, evidencia de campo, QA humana y una aprobación separada para incluirse siquiera en un borrador local.
