import assert from "node:assert/strict";
import test from "node:test";
import {parseCsv} from "../src/csv.mjs";
import {assertDate, assertLogicalLocator, assertSafeText, assertTechnicalFactKey, looksLikeMachinePath, parseEntityRef} from "../src/normalization.mjs";

test("CSV parser handles BOM, quoted commas, CRLF and quoted newlines", () => {
  const rows = parseCsv('\uFEFFentity_key,name,summary\r\na-1,"Lavabo, mini","línea 1\n línea 2"\r\n');
  assert.deepEqual(rows, [{entity_key: "a-1", name: "Lavabo, mini", summary: "línea 1\n línea 2"}]);
});

test("CSV parser permits header-only optional support sections while enforcing the exact schema", () => {
  assert.deepEqual(parseCsv("from_entity_key,relation_type\n", ["from_entity_key", "relation_type"]), []);
  assert.throws(() => parseCsv("relation_type,from_entity_key\n", ["from_entity_key", "relation_type"]), /exactly these ordered headers/);
});

test("logical source locators reject filesystem paths and credentials", () => {
  assert.equal(assertLogicalLocator("enki-source://demo/manual"), "enki-source://demo/manual");
  assert.equal(assertLogicalLocator("enki-repo://enki-hogar/productos"), "enki-repo://enki-hogar/productos");
  assert.throws(() => assertLogicalLocator("/private/catalog.csv"), /logical locator/);
  assert.throws(() => assertLogicalLocator("https://example.invalid/catalog?token=bad"), /credentials/);
  assert.throws(() => assertLogicalLocator("https://user:pass@example.invalid/catalog"), /credentials/);
});

test("support text rejects commercial values, PII, credentials and machine paths", () => {
  assert.throws(() => assertSafeText("PVP: 120", "fact"), /live\/commercial value/);
  assert.throws(() => assertSafeText("120 EUR", "fact"), /live\/commercial value/);
  assert.throws(() => assertSafeText("persona@example.invalid", "fact"), /PII/);
  assert.throws(() => assertSafeText(["sk", "examplecredential123456789"].join("-"), "fact"), /credential-like/);
  assert.throws(() => assertSafeText("client_secret=not-allowed-here", "fact"), /credential-like/);
  assert.throws(() => assertSafeText(["", "Users", "example", "catalog.pdf"].join("/"), "fact"), /machine-specific path/);
  assert.equal(assertSafeText("Consultar precio y stock actuales en WooCommerce.", "fact"), "Consultar precio y stock actuales en WooCommerce.");
  assert.equal(looksLikeMachinePath("3/8 inch"), false);
});

test("support dates reject calendar rollovers", () => {
  assert.equal(assertDate("2028-02-29", "snapshot"), "2028-02-29");
  assert.throws(() => assertDate("2026-02-30", "snapshot"), /real date/);
});

test("commercial fact keys and malformed entity refs are rejected", () => {
  assert.throws(() => assertTechnicalFactKey("sale_price"), /Forbidden commercial/);
  assert.throws(() => assertTechnicalFactKey("stock_quantity"), /Forbidden commercial/);
  assert.deepEqual(parseEntityRef("enki:espejos:lux-050101"), {brandSlug: "enki", domainSlug: "espejos", entityKey: "lux-050101"});
  assert.throws(() => parseEntityRef("lux-050101"), /brand:domain/);
});
