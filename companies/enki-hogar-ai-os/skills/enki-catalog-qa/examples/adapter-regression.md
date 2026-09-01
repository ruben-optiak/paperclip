# Ejemplo de gate de adaptadores

El registro runtime vive bajo `scripts/catalog-pipeline/adapters/` en el paquete fuente. Sus cuatro definiciones están fijadas por SHA-256 y conforman [catalog-adapter/v1](../references/catalog-adapter-v1.schema.json).

El harness ejecuta cada definición sobre los seis fixtures saneados sin usar `pairing` ni `expected` para producir la salida. Después compara los pares con el oracle EAI-019.

Resumen válido:

```json
{
  "adapters": 4,
  "fixtures": 6,
  "expectedPairs": 21,
  "producedPairs": 21,
  "subjectCoverage": 1,
  "pairErrorCount": 0,
  "pairErrorRate": 0,
  "fixturePassRate": 1
}
```

Cada resultado identifica `adapterKey`, versión, hash de definición, fixture/hash, snapshot, página y `ruleKey`. También declara `isLiveCommercialTruth: false`, `isExternalMutationAuthority: false` y `canGenerateWooImport: false`.

Si llega un snapshot nuevo, el resultado correcto no es «usar el adaptador más parecido»: es denegar por alcance, crear un fixture mínimo saneado, revisar visualmente el riesgo y publicar una versión nueva del adaptador.
