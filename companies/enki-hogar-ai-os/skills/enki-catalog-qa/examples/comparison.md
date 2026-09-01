# Comparación de catálogo

Ejemplo humano derivado del bundle saneado de `fixtures/catalog-contracts/valid/`. No contiene datos reales ni actuales.

- Run: `catalog-run-buades-sanitized-2026-08-31`
- Snapshot comercial: export Woo completo con SHA-256 y fecha.
- Fuente candidata: PDF oficial con SHA-256, página y cajas geométricas.
- Autoridad: revisión local; `externalWritesBlocked: true`.

| Entidad/campo | Actual Woo | Candidato oficial | Evidencia | Confianza | Estado |
| --- | --- | --- | --- | --- | --- |
| `buades-ref-demo-001 / regular_price_eur_gross` | `106,00` → `106.00 EUR` | `88,47 € + IVA` → `107.05 EUR` | Woo fila 42, columna 26; PDF página 37, cajas de referencia/valor/encabezado | alta (`0.94`) | necesita revisión Board; no exportable |

El valor crudo se conserva junto al normalizado. La diferencia no autoriza una escritura ni demuestra que el PDF sea el precio comercial live. Si Board la aprobara, solo podría entrar en un borrador local y seguiría siendo obligatorio revisar un export Woo completo posterior a cualquier importación humana.
