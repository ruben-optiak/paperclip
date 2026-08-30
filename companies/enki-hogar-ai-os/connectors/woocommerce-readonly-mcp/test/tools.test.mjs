import assert from "node:assert/strict";
import test from "node:test";
import {aggregateOrders} from "../src/sanitize.mjs";
import {createToolDefinitions, SALES_RECOGNIZED_STATUSES} from "../src/tools.mjs";
import {order} from "./fixtures.mjs";

const fixedNow = () => new Date("2026-08-29T06:00:00.000Z");

function toolByName(client, name) {
  return createToolDefinitions(client, {now: fixedNow}).find((tool) => tool.name === name);
}

async function payload(tool, input) {
  const toolResult = await tool.execute(input);
  assert.equal(toolResult.isError, undefined, toolResult.content[0].text);
  return JSON.parse(toolResult.content[0].text);
}

test("catalog publishes only the five expected read-only operations", () => {
  const tools = createToolDefinitions({}, {now: fixedNow});
  assert.deepEqual(tools.map(({name}) => name), [
    "woo_sales_summary",
    "woo_orders_summary",
    "woo_get_product",
    "woo_low_stock",
    "woo_catalog_summary",
  ]);
  assert.equal(tools.every(({annotations}) => annotations.readOnlyHint === true), true);
  assert.equal(tools.some(({name}) => /(create|update|delete|refund|write|set)/i.test(name)), false);
});

test("order aggregation contains totals but no order rows or identifiers", () => {
  const aggregate = aggregateOrders([order]);
  assert.equal(aggregate.data.monetary_by_currency.EUR.gross_revenue.value, "121.00");
  assert.equal(aggregate.data.monetary_by_currency.EUR.net_revenue.value, "111.00");
  assert.equal(aggregate.data.monetary_by_currency.EUR.refund_total.value, "10.00");
  assert.equal("orders" in aggregate.data, false);
  assert.equal(JSON.stringify(aggregate).includes(String(order.id)), false);
});

test("sales summary queries only recognized statuses and excludes unexpected rows", async () => {
  const calls = [];
  const completed = {...order, id: 1002, status: "completed", currency: "USD", total: "50.00", total_tax: "0.00", shipping_total: "0.00", discount_total: "0.00", refunds: []};
  const refunded = {...order, id: 1004, status: "refunded", currency: "EUR", total: "30.00", total_tax: "5.21", shipping_total: "0.00", discount_total: "0.00", refunds: [{id: 4, total: "-30.00"}]};
  const cancelled = {...order, id: 1003, status: "cancelled", total: "999.00"};
  const unidentified = {...order, id: undefined, status: "processing", total: "700.00"};
  const client = {paginate: async (_path, params) => {
    calls.push(params);
    return {rows: params.status === "processing" ? [order, cancelled, unidentified] : params.status === "completed" ? [completed] : [refunded], truncated: false};
  }};
  const envelope = await payload(toolByName(client, "woo_sales_summary"), {start_date: "2026-03-29", end_date: "2026-03-29"});

  assert.deepEqual(calls.map(({status}) => status), SALES_RECOGNIZED_STATUSES);
  assert.equal(calls.some(({status}) => status === "any"), false);
  assert.equal(calls.every(({after}) => after === "2026-03-28T23:00:00.000Z"), true);
  assert.equal(calls.every(({before}) => before === "2026-03-29T21:59:59.999Z"), true);
  assert.equal(envelope.data.order_count, 3);
  assert.deepEqual(envelope.data.sales_statuses, ["processing", "completed", "refunded"]);
  assert.equal(envelope.data.monetary_by_currency.EUR.gross_revenue.value, "151.00");
  assert.equal(envelope.data.monetary_by_currency.EUR.net_revenue.value, "111.00");
  assert.equal(envelope.data.monetary_by_currency.USD.gross_revenue.value, "50.00");
  assert.equal(envelope.data.gross_margin.quality, "unavailable");
  assert.equal(JSON.stringify(envelope).includes("999.00"), false);
  assert.equal(JSON.stringify(envelope).includes("700.00"), false);
  assert.equal(envelope.meta.warnings.some((warning) => warning.includes("without an id")), true);
  assert.deepEqual(envelope.meta.currencies, ["EUR", "USD"]);
  assert.equal(envelope.meta.currency, null);
  assert.equal(envelope.meta.status, "partial");
});

test("missing and invalid money remain incomplete instead of becoming zero", () => {
  const aggregate = aggregateOrders([
    {...order, id: 2001, total: undefined, shipping_total: "invalid", refunds: [{id: 1, total: null}]},
    {...order, id: 2002, total: "20.50", shipping_total: "2.00", refunds: []},
  ]);
  const eur = aggregate.data.monetary_by_currency.EUR;
  assert.equal(eur.gross_revenue.value, null);
  assert.equal(eur.gross_revenue.partial_value, "20.50");
  assert.equal(eur.gross_revenue.missing_count, 1);
  assert.equal(eur.shipping_total.value, null);
  assert.equal(eur.shipping_total.invalid_count, 1);
  assert.equal(eur.refund_total.value, null);
  assert.equal(aggregate.partial, true);
});

test("operational order summary is aggregate-only", async () => {
  const client = {paginate: async () => ({rows: [order], truncated: false})};
  const envelope = await payload(toolByName(client, "woo_orders_summary"), {start_date: "2026-08-28", end_date: "2026-08-28"});
  assert.equal(envelope.data.order_count, 1);
  assert.equal("orders" in envelope.data, false);
  assert.equal("monetary_by_currency" in envelope.data, false);
  assert.equal(JSON.stringify(envelope).includes(String(order.id)), false);
});

test("low stock uses stable pagination, deduplicates product ids, and reports coverage", async () => {
  const calls = [];
  const client = {paginate: async (...args) => {
    calls.push(args);
    return {rows: [
      {id: 1, name: "Low", sku: "LOW", type: "simple", stock_status: "instock", manage_stock: true, stock_quantity: 2, categories: [], attributes: []},
      {id: 2, name: "Enough", sku: "OK", type: "simple", stock_status: "instock", manage_stock: true, stock_quantity: 20, categories: [], attributes: []},
      {id: 3, name: "Unknown", sku: "UNKNOWN", type: "simple", stock_status: "instock", manage_stock: true, stock_quantity: null, categories: [], attributes: []},
      {id: 4, name: "Variable unavailable", sku: "VARIABLE", type: "variable", stock_status: "outofstock", manage_stock: false, stock_quantity: null, categories: [], attributes: []},
      {id: 4, name: "Variable unavailable duplicate", sku: "VARIABLE", type: "variable", stock_status: "outofstock", manage_stock: false, stock_quantity: null, categories: [], attributes: []},
      {id: 5, name: "Managed unavailable", sku: "MANAGED-OUT", type: "simple", stock_status: "outofstock", manage_stock: true, stock_quantity: null, categories: [], attributes: []},
    ], truncated: true, pagesFetched: 1, totalPages: 3, totalItems: 205};
  }};
  const envelope = await payload(toolByName(client, "woo_low_stock"), {threshold: 5, max_pages: 1});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/products");
  assert.equal(calls[0][1].status, "publish");
  assert.equal(calls[0][1].orderby, "id");
  assert.equal(calls[0][1].order, "asc");
  assert.match(calls[0][1]._fields, /stock_quantity/);
  assert.deepEqual(calls[0][3], {concurrency: 6});
  assert.equal(envelope.data.count, 3);
  assert.equal(envelope.data.products[0].sku, "LOW");
  assert.equal(envelope.data.products[1].sku, "VARIABLE");
  assert.equal(envelope.data.products[2].sku, "MANAGED-OUT");
  assert.equal(envelope.data.exact_quantity_match_count, 1);
  assert.equal(envelope.data.out_of_stock_status_only_count, 2);
  assert.equal(envelope.data.excluded_invalid_stock_count, 1);
  assert.equal(envelope.data.variable_parents_without_top_level_quantity_count, 1);
  assert.deepEqual(envelope.data.coverage, {
    published_products_scanned: 5,
    raw_product_rows_scanned: 6,
    reported_total_published_products: 205,
    duplicate_product_rows_excluded: 1,
    missing_identity_rows_excluded: 0,
    pages_fetched: 1,
    total_pages: 3,
    max_pages: 1,
  });
  assert.equal(envelope.data.truncated, true);
  assert.equal(envelope.meta.status, "partial");
  assert.equal(envelope.meta.warnings.some((warning) => warning.includes("variation-level")), true);
  assert.equal(envelope.meta.warnings.some((warning) => warning.includes("duplicate product")), true);
  assert.equal("price" in envelope.data.products[0], false);
});

test("every published tool returns the canonical evidence envelope", async () => {
  const product = {id: 10, name: "Fixture product", sku: "FIX-10", manage_stock: true, stock_quantity: 2, categories: [], attributes: []};
  const client = {
    paginate: async (path, params) => path === "/orders"
      ? {rows: [{...order, status: params.status === "any" ? "processing" : params.status}], truncated: false}
      : {rows: [product], truncated: false},
    get: async (path) => path === "/reports/products/totals" ? {data: [{slug: "publish", total: 1}]} : path === "/products" ? {data: [product]} : {data: product},
  };
  const inputs = {
    woo_sales_summary: {start_date: "2026-08-28", end_date: "2026-08-28"},
    woo_orders_summary: {start_date: "2026-08-28", end_date: "2026-08-28"},
    woo_get_product: {product_id: 10},
    woo_low_stock: {threshold: 5, max_pages: 1},
    woo_catalog_summary: {},
  };
  for (const tool of createToolDefinitions(client, {now: fixedNow})) {
    const envelope = await payload(tool, inputs[tool.name]);
    assert.equal(envelope.schema, "enki-evidence-envelope/v1", tool.name);
    assert.equal(envelope.meta.timezone, "Europe/Madrid", tool.name);
    assert.equal(envelope.meta.contracts.includes("enki-evidence-envelope/v1"), true, tool.name);
  }
});
