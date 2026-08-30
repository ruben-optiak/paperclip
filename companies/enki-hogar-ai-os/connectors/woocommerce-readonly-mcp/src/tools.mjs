import {z} from "zod";
import {createEvidenceEnvelope} from "./evidence.mjs";
import {aggregateOrders, productView, stockQuantity} from "./sanitize.mjs";
import {madridPeriodParams, parseLocalDate} from "./time.mjs";

export const SALES_RECOGNIZED_STATUSES = Object.freeze(["processing", "completed", "refunded"]);
const ORDER_STATUSES = Object.freeze(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash", "checkout-draft", "any"]);
const date = z.string().refine((value) => {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}, "Use a real calendar date in YYYY-MM-DD format");
const periodSchema = z.object({start_date: date, end_date: date});

function periodParams(input) {
  return madridPeriodParams(input.start_date, input.end_date);
}

function result(value) {
  return {content: [{type: "text", text: JSON.stringify(value, null, 2)}]};
}

function failure(error) {
  return {isError: true, content: [{type: "text", text: error instanceof Error ? error.message : String(error)}]};
}

function readTool(name, description, schema, execute, extraAnnotations = {}) {
  return {
    name,
    description,
    schema,
    annotations: {title: description, readOnlyHint: true, destructiveHint: false, openWorldHint: true, ...extraAnnotations},
    execute: async (input) => {
      try {
        return result(await execute(schema.parse(input)));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function clockInstant(now) {
  const value = now();
  const dateValue = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(dateValue.getTime())) throw new Error("Connector clock returned an invalid instant");
  return dateValue.toISOString();
}

function evidence({source, data, now, period, currencies = [], warnings = [], partial = false, contracts = []}) {
  return createEvidenceEnvelope({
    source,
    data,
    fetchedAt: clockInstant(now),
    periodStart: period?.start_date ?? null,
    periodEnd: period?.end_date ?? null,
    currencies,
    status: partial ? "partial" : "ok",
    partial,
    warnings,
    contracts,
  });
}

function collectRecognizedSales(pages) {
  const rows = [];
  const seenIds = new Set();
  let duplicateCount = 0;
  let missingIdentityCount = 0;
  let unexpectedStatusCount = 0;
  for (const page of pages) {
    for (const order of page.rows) {
      if (!SALES_RECOGNIZED_STATUSES.includes(order.status)) {
        unexpectedStatusCount += 1;
        continue;
      }
      const identity = order.id === null || order.id === undefined ? null : String(order.id);
      if (identity === null) {
        missingIdentityCount += 1;
        continue;
      }
      if (identity !== null && seenIds.has(identity)) {
        duplicateCount += 1;
        continue;
      }
      seenIds.add(identity);
      rows.push(order);
    }
  }
  return {rows, duplicateCount, missingIdentityCount, unexpectedStatusCount};
}

function aggregateOrderCounts(rows) {
  const statusCounts = new Map();
  for (const order of rows) {
    const status = typeof order.status === "string" && order.status ? order.status : "unknown";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }
  return {order_count: rows.length, status_counts: Object.fromEntries([...statusCounts].sort(([left], [right]) => left.localeCompare(right)))};
}

function inventoryProductView(product) {
  const {price: _price, regular_price: _regularPrice, sale_price: _salePrice, ...inventoryProduct} = productView(product);
  return inventoryProduct;
}

export function createToolDefinitions(client, {now = () => new Date()} = {}) {
  return [
    readTool("woo_sales_summary", "Aggregate sales totals for a bounded period; contains no customer PII.", periodSchema, async (input) => {
      const params = periodParams(input);
      const pages = [];
      for (const status of SALES_RECOGNIZED_STATUSES) {
        pages.push({status, ...await client.paginate("/orders", {...params, status})});
      }
      const {rows, duplicateCount, missingIdentityCount, unexpectedStatusCount} = collectRecognizedSales(pages);
      const aggregate = aggregateOrders(rows);
      const truncated = pages.some((page) => page.truncated);
      const warnings = [...aggregate.warnings];
      if (truncated) warnings.push("At least one recognized sales-status query reached the pagination limit");
      if (duplicateCount > 0) warnings.push(`${duplicateCount} duplicate order(s) were excluded from the sales aggregation`);
      if (missingIdentityCount > 0) warnings.push(`${missingIdentityCount} order(s) without an id were excluded because they cannot be deduplicated`);
      if (unexpectedStatusCount > 0) warnings.push(`${unexpectedStatusCount} order(s) with an unrecognized sales status were excluded`);
      warnings.push("Gross margin is unavailable because this connector has no verified COGS source");
      const partial = warnings.length > 0;
      return evidence({
        source: "woocommerce.sales-summary",
        now,
        period: input,
        currencies: aggregate.currencies,
        warnings,
        partial,
        contracts: ["enki-metrics/v1#woocommerce-sales"],
        data: {
          period: input,
          sales_statuses: [...SALES_RECOGNIZED_STATUSES],
          queried_order_count_by_status: Object.fromEntries(pages.map((page) => [page.status, page.rows.length])),
          ...aggregate.data,
          gross_margin: {value: null, quality: "unavailable", reason: "verified_cogs_unavailable"},
          truncated,
        },
      });
    }),
    readTool("woo_orders_summary", "Aggregate operational order counts for a bounded period; returns no order rows and is not the recognized-sales metric.", periodSchema.extend({status: z.enum(ORDER_STATUSES).default("any")}), async (input) => {
      const params = {...periodParams(input), status: input.status};
      const {rows, truncated} = await client.paginate("/orders", params);
      const warnings = [];
      if (truncated) warnings.push("The order query reached the pagination limit");
      return evidence({
        source: "woocommerce.orders-summary",
        now,
        period: input,
        warnings,
        partial: truncated,
        contracts: ["enki-metrics/v1#woocommerce-order-diagnostics"],
        data: {
          period: {start_date: input.start_date, end_date: input.end_date},
          filter_status: input.status,
          ...aggregateOrderCounts(rows),
          truncated,
        },
      });
    }),
    readTool("woo_get_product", "Read one product by numeric ID or exact SKU.", z.object({product_id: z.number().int().positive().optional(), sku: z.string().trim().min(1).max(100).optional()}).refine((value) => Boolean(value.product_id) !== Boolean(value.sku), "Provide exactly one of product_id or sku"), async ({product_id, sku}) => {
      if (product_id) {
        const product = productView((await client.get(`/products/${product_id}`)).data);
        const warnings = ["WooCommerce product responses do not declare currency; price fields must not be aggregated or compared"];
        return evidence({source: "woocommerce.product", now, warnings, partial: true, contracts: ["enki-metrics/v1#woocommerce-product"], data: {product}});
      }
      const rows = (await client.get("/products", {sku, per_page: 10})).data;
      if (!Array.isArray(rows)) throw new Error("WooCommerce returned a non-list product response");
      const warnings = ["WooCommerce product responses do not declare currency; price fields must not be aggregated or compared"];
      return evidence({source: "woocommerce.product", now, warnings, partial: true, contracts: ["enki-metrics/v1#woocommerce-product"], data: {matches: rows.map(productView)}});
    }),
    readTool("woo_low_stock", "List product and SKU inventory at or below a threshold; no mutation is possible.", z.object({threshold: z.number().int().min(0).max(1000).default(5), max_pages: z.number().int().min(1).max(20).default(10)}), async ({threshold, max_pages}) => {
      const {rows, truncated} = await client.paginate("/products", {status: "publish"}, max_pages);
      const invalidStock = rows.filter((product) => product.manage_stock === true && stockQuantity(product.stock_quantity) === null);
      const products = rows.filter((product) => product.manage_stock === true && stockQuantity(product.stock_quantity) !== null && stockQuantity(product.stock_quantity) <= threshold).map(inventoryProductView);
      const warnings = [];
      if (invalidStock.length > 0) warnings.push(`${invalidStock.length} managed-stock product(s) were excluded because stock quantity is missing or invalid`);
      if (truncated) warnings.push("The product query reached the pagination limit");
      return evidence({
        source: "woocommerce.low-stock",
        now,
        warnings,
        partial: warnings.length > 0,
        contracts: ["enki-metrics/v1#woocommerce-inventory"],
        data: {threshold, count: products.length, excluded_invalid_stock_count: invalidStock.length, products, truncated},
      });
    }),
    readTool("woo_catalog_summary", "Read aggregate WooCommerce product totals without customer data.", z.object({}), async () => {
      const {data} = await client.get("/reports/products/totals");
      return evidence({source: "woocommerce.catalog-summary", now, contracts: ["enki-metrics/v1#woocommerce-catalog"], data: {totals: data}});
    }),
  ];
}
