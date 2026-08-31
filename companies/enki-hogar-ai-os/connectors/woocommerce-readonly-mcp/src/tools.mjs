import {z} from "zod";
import {createEvidenceEnvelope} from "./evidence.mjs";
import {aggregateOrders, productStructureView, productView, stockQuantity, variationView} from "./sanitize.mjs";
import {madridPeriodParams, parseLocalDate} from "./time.mjs";

export const SALES_RECOGNIZED_STATUSES = Object.freeze(["processing", "completed", "refunded"]);
const ORDER_STATUSES = Object.freeze(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash", "checkout-draft", "any"]);
const INVENTORY_FIELDS = Object.freeze([
  "id",
  "name",
  "slug",
  "sku",
  "status",
  "type",
  "catalog_visibility",
  "stock_status",
  "manage_stock",
  "stock_quantity",
  "backorders",
  "categories",
  "attributes",
  "date_modified_gmt",
]);
const INVENTORY_PAGE_CONCURRENCY = 6;
const PRODUCT_STRUCTURE_FIELDS = Object.freeze([
  "id", "parent_id", "name", "slug", "permalink", "sku", "status", "type", "catalog_visibility",
  "purchasable",
  "price", "regular_price", "sale_price", "stock_status", "manage_stock", "stock_quantity",
  "backorders", "categories", "attributes", "date_modified_gmt", "meta_data",
]);
const VARIATION_STRUCTURE_FIELDS = Object.freeze([
  "id", "parent_id", "sku", "status", "purchasable", "price", "regular_price", "sale_price",
  "stock_status", "manage_stock", "stock_quantity", "backorders", "attributes",
  "date_modified_gmt", "meta_data",
]);
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

function collectUniqueInventoryProducts(rows) {
  const products = [];
  const seenIds = new Set();
  let duplicateCount = 0;
  let missingIdentityCount = 0;
  for (const product of rows) {
    const identity = product.id === null || product.id === undefined ? null : String(product.id);
    if (identity === null) {
      missingIdentityCount += 1;
      continue;
    }
    if (seenIds.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    seenIds.add(identity);
    products.push(product);
  }
  return {products, duplicateCount, missingIdentityCount};
}

async function resolveExactProduct(client, {product_id, sku}) {
  if (product_id) {
    const product = (await client.get(`/products/${product_id}`, {_fields: PRODUCT_STRUCTURE_FIELDS.join(",")})).data;
    return {rootProduct: product, requestedVariation: null, resolutionKind: "product"};
  }
  const rows = (await client.get("/products", {
    sku,
    per_page: 10,
    _fields: PRODUCT_STRUCTURE_FIELDS.join(","),
  })).data;
  if (!Array.isArray(rows)) throw new Error("WooCommerce returned a non-list product response");
  const exact = rows.filter((row) => typeof row?.sku === "string" && row.sku.trim() === sku);
  if (exact.length === 0) throw new Error(`No WooCommerce product or variation has exact SKU ${sku}`);
  if (exact.length > 1) throw new Error(`WooCommerce returned more than one product with exact SKU ${sku}`);
  const requestedProduct = exact[0];
  if (requestedProduct.type !== "variation") {
    return {rootProduct: requestedProduct, requestedVariation: null, resolutionKind: "product"};
  }

  const parentId = Number(requestedProduct.parent_id);
  if (!Number.isSafeInteger(parentId) || parentId <= 0) {
    throw new Error(`WooCommerce variation with exact SKU ${sku} does not declare a valid parent_id`);
  }
  const rootProduct = (await client.get(`/products/${parentId}`, {
    _fields: PRODUCT_STRUCTURE_FIELDS.join(","),
  })).data;
  if (Number(rootProduct?.id) !== parentId || rootProduct?.type !== "variable") {
    throw new Error(`WooCommerce variation with exact SKU ${sku} does not resolve to its expected variable parent ${parentId}`);
  }
  return {rootProduct, requestedVariation: requestedProduct, resolutionKind: "variation"};
}

function exactVariationIdentity(row, requestedVariation, requestedSku) {
  const rowId = Number(row?.id);
  const requestedId = Number(requestedVariation?.id);
  const idMatches = Number.isSafeInteger(rowId) && Number.isSafeInteger(requestedId) && rowId === requestedId;
  const rowSku = typeof row?.sku === "string" ? row.sku.trim() : "";
  return {idMatches, skuMatches: rowSku === requestedSku};
}

function mergeRequestedVariation(rows, requestedVariation, requestedSku, parentId, truncated) {
  if (!requestedVariation) return {rows, addedFromExactLookup: false};
  if (Number(requestedVariation.parent_id) !== Number(parentId)) {
    throw new Error(`WooCommerce variation with exact SKU ${requestedSku} reports a conflicting parent_id`);
  }

  const candidates = rows.filter((row) => {
    const identity = exactVariationIdentity(row, requestedVariation, requestedSku);
    return identity.idMatches || identity.skuMatches;
  });
  if (candidates.length > 1) {
    throw new Error(`WooCommerce parent ${parentId} contains ambiguous matches for exact variation SKU ${requestedSku}`);
  }
  if (candidates.length === 1) {
    const identity = exactVariationIdentity(candidates[0], requestedVariation, requestedSku);
    if (!identity.idMatches || !identity.skuMatches || Number(candidates[0].parent_id) !== Number(parentId)) {
      throw new Error(`WooCommerce parent ${parentId} contains a conflicting identity for exact variation SKU ${requestedSku}`);
    }
    return {rows, addedFromExactLookup: false};
  }
  if (!truncated) {
    throw new Error(`WooCommerce variation with exact SKU ${requestedSku} is absent from its declared parent ${parentId}`);
  }

  return {
    rows: [...rows, requestedVariation].sort((left, right) => Number(left?.id ?? 0) - Number(right?.id ?? 0)),
    addedFromExactLookup: true,
  };
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
    readTool("woo_get_product_structure", "Read one live WooCommerce product and its bounded variation structure. An exact variation SKU is expanded through its variable parent. This is the current authority for sellable options, prices and stock.", z.object({
      product_id: z.number().int().positive().optional(),
      sku: z.string().trim().min(1).max(100).optional(),
      max_pages: z.number().int().min(1).max(20).default(10),
    }).refine((value) => Boolean(value.product_id) !== Boolean(value.sku), "Provide exactly one of product_id or sku"), async ({product_id, sku, max_pages}) => {
      const {rootProduct: rawProduct, requestedVariation, resolutionKind} = await resolveExactProduct(client, {product_id, sku});
      const product = productStructureView(rawProduct);
      let variationPage = {rows: [], truncated: false, pagesFetched: 0, totalPages: 0, totalItems: 0};
      if (product.type === "variable") {
        variationPage = await client.paginate(
          `/products/${product.id}/variations`,
          {orderby: "id", order: "asc", _fields: VARIATION_STRUCTURE_FIELDS.join(",")},
          max_pages,
          {concurrency: INVENTORY_PAGE_CONCURRENCY},
        );
      }
      const mergedVariationPage = mergeRequestedVariation(
        variationPage.rows,
        requestedVariation,
        sku,
        product.id,
        variationPage.truncated,
      );
      const variations = mergedVariationPage.rows.map(variationView);
      const warnings = ["WooCommerce product responses do not declare currency; price values are live but currency must be established separately"];
      if (variationPage.truncated) warnings.push("The variation query reached the pagination limit; the product structure is incomplete");
      if (mergedVariationPage.addedFromExactLookup) {
        warnings.push("The requested variation was outside the bounded variation pages and was included from the exact-SKU lookup; sibling coverage remains incomplete");
      }
      return evidence({
        source: "woocommerce.product-structure",
        now,
        warnings,
        partial: true,
        contracts: ["enki-metrics/v1#woocommerce-product-structure"],
        data: {
          authority: {
            sellable_structure: "woocommerce_live",
            prices: "woocommerce_live",
            stock: "woocommerce_live",
            technical_support: "product_support_knowledge",
          },
          resolution: {
            input_kind: product_id ? "product_id" : "sku",
            match_kind: resolutionKind,
            matched_id: requestedVariation?.id ?? product.id,
            matched_sku: requestedVariation?.sku ?? product.sku,
            root_product_id: product.id,
          },
          product,
          variations,
          coverage: {
            variations_returned: variations.length,
            reported_total_variations: variationPage.totalItems,
            pages_fetched: variationPage.pagesFetched,
            total_pages: variationPage.totalPages,
            max_pages,
            truncated: variationPage.truncated,
          },
        },
      });
    }),
    readTool("woo_low_stock", "List product and SKU inventory at or below a threshold; no mutation is possible.", z.object({threshold: z.number().int().min(0).max(1000).default(5), max_pages: z.number().int().min(1).max(20).default(10)}), async ({threshold, max_pages}) => {
      const {rows, truncated, pagesFetched, totalPages, totalItems} = await client.paginate(
        "/products",
        {status: "publish", orderby: "id", order: "asc", _fields: INVENTORY_FIELDS.join(",")},
        max_pages,
        {concurrency: INVENTORY_PAGE_CONCURRENCY},
      );
      const {products: uniqueProducts, duplicateCount, missingIdentityCount} = collectUniqueInventoryProducts(rows);
      const exactQuantityMatches = uniqueProducts.filter((product) => product.manage_stock === true && stockQuantity(product.stock_quantity) !== null && stockQuantity(product.stock_quantity) <= threshold);
      const statusOnlyMatches = uniqueProducts.filter((product) => product.stock_status === "outofstock" && !exactQuantityMatches.includes(product));
      const invalidStock = uniqueProducts.filter((product) => product.manage_stock === true && stockQuantity(product.stock_quantity) === null && !statusOnlyMatches.includes(product));
      const variableParentsWithoutQuantity = uniqueProducts.filter((product) => product.type === "variable" && stockQuantity(product.stock_quantity) === null);
      const products = [...exactQuantityMatches, ...statusOnlyMatches].map(inventoryProductView);
      const warnings = [];
      if (duplicateCount > 0) warnings.push(`${duplicateCount} duplicate product row(s) were excluded by product id`);
      if (missingIdentityCount > 0) warnings.push(`${missingIdentityCount} product row(s) without an id were excluded because they cannot be deduplicated`);
      if (!truncated && totalItems !== null && uniqueProducts.length !== totalItems) warnings.push(`WooCommerce reported ${totalItems} published product(s), but ${uniqueProducts.length} unique product(s) were received`);
      if (invalidStock.length > 0) warnings.push(`${invalidStock.length} managed-stock product(s) were excluded because stock quantity is missing or invalid`);
      if (statusOnlyMatches.length > 0) warnings.push(`${statusOnlyMatches.length} product(s) marked out of stock were included without claiming an exact stock quantity`);
      if (variableParentsWithoutQuantity.length > 0) warnings.push(`${variableParentsWithoutQuantity.length} variable product parent(s) do not expose a top-level quantity; variation-level low-stock coverage is unavailable`);
      if (truncated) warnings.push("The product query reached the pagination limit");
      return evidence({
        source: "woocommerce.low-stock",
        now,
        warnings,
        partial: warnings.length > 0,
        contracts: ["enki-metrics/v1#woocommerce-inventory"],
        data: {
          threshold,
          count: products.length,
          exact_quantity_match_count: exactQuantityMatches.length,
          out_of_stock_status_only_count: statusOnlyMatches.length,
          excluded_invalid_stock_count: invalidStock.length,
          variable_parents_without_top_level_quantity_count: variableParentsWithoutQuantity.length,
          coverage: {
            published_products_scanned: uniqueProducts.length,
            raw_product_rows_scanned: rows.length,
            reported_total_published_products: totalItems,
            duplicate_product_rows_excluded: duplicateCount,
            missing_identity_rows_excluded: missingIdentityCount,
            pages_fetched: pagesFetched,
            total_pages: totalPages,
            max_pages,
          },
          products,
          truncated,
        },
      });
    }),
    readTool("woo_catalog_summary", "Read aggregate WooCommerce product totals without customer data.", z.object({}), async () => {
      const {data} = await client.get("/reports/products/totals");
      return evidence({source: "woocommerce.catalog-summary", now, contracts: ["enki-metrics/v1#woocommerce-catalog"], data: {totals: data}});
    }),
  ];
}
