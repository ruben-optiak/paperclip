---
name: enki-unit-economics
description: Calcula ventas, margen, ROAS y CAC sin inventar costes, atribución ni datos ausentes
license: MIT AND LicenseRef-Enki-Hogar-Internal
---

# Enki unit economics

Usa como contrato normativo la [copia runtime de `metric-contracts.yaml`](references/metric-contracts.yaml). No redefinas una métrica a partir de memoria o conveniencia del análisis.

## Definiciones mínimas

- `ROAS = valor de conversión atribuido / gasto publicitario`.
- `CAC = gasto atribuible / clientes nuevos confirmados`.
- `margen bruto = ventas netas - COGS`; no calcular si COGS no existe.
- No mezclar ventas brutas, netas, impuestos, envíos y reembolsos sin conciliación.

Para cada cifra incluye fórmula, entradas, fuente, moneda, periodo y calidad. Si falta una entrada, devuelve `no calculable` y enumera el dato requerido. Presenta escenarios solo como escenarios etiquetados, nunca como resultados observados.

No apruebes gasto, precio, reembolso ni campaña. Ver [ejemplo](examples/unit-economics.md) y `fixtures/economics.json`.
