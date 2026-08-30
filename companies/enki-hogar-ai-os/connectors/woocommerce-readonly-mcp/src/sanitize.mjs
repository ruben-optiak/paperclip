const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function decimal(value) {
  if (value === null || value === undefined || value === "") return {quality: "missing"};
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!DECIMAL_PATTERN.test(text)) return {quality: "invalid"};
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
  return {quality: "valid", coefficient, scale: fraction.length};
}

function formatDecimal(coefficient, scale) {
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const value = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && coefficient !== 0n ? `-${value}` : value;
}

function sumDecimals(values, {absolute = false} = {}) {
  const parsed = values.map(decimal);
  const valid = parsed.filter(({quality}) => quality === "valid");
  const missingCount = parsed.filter(({quality}) => quality === "missing").length;
  const invalidCount = parsed.filter(({quality}) => quality === "invalid").length;
  const scale = valid.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const coefficient = valid.reduce((sum, value) => {
    const normalized = value.coefficient * (10n ** BigInt(scale - value.scale));
    return sum + (absolute && normalized < 0n ? -normalized : normalized);
  }, 0n);
  const complete = missingCount === 0 && invalidCount === 0;
  const partialValue = formatDecimal(coefficient, scale);
  return {
    value: complete ? partialValue : null,
    quality: complete ? "complete" : "incomplete",
    valid_count: valid.length,
    missing_count: missingCount,
    invalid_count: invalidCount,
    ...(complete ? {} : {partial_value: valid.length > 0 ? partialValue : null}),
  };
}

function negateDecimal(value) {
  if (typeof value !== "string") return undefined;
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

function netRevenueMetric(grossRevenue, refundTotal) {
  const grossCandidate = grossRevenue.value ?? grossRevenue.partial_value;
  const refundCandidate = refundTotal.value ?? refundTotal.partial_value;
  const calculated = sumDecimals([grossCandidate, negateDecimal(refundCandidate)]);
  const complete = grossRevenue.quality === "complete" && refundTotal.quality === "complete";
  return {
    value: complete ? calculated.value : null,
    quality: complete ? "complete" : "incomplete",
    dependencies: ["gross_revenue", "refund_total"],
    ...(complete ? {} : {partial_value: calculated.quality === "complete" ? calculated.value : null}),
  };
}

function normalizedCurrency(value) {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return CURRENCY_PATTERN.test(currency) ? currency : null;
}

function decimalValue(value) {
  const parsed = decimal(value);
  return parsed.quality === "valid" ? formatDecimal(parsed.coefficient, parsed.scale) : null;
}

function refundValues(orders) {
  return orders.flatMap((order) => {
    if (!Array.isArray(order.refunds)) return [undefined];
    if (order.refunds.length === 0) return ["0"];
    return order.refunds.map((refund) => refund?.total);
  });
}

export function aggregateOrders(orders) {
  const statuses = new Map();
  const byCurrency = new Map();
  let ordersWithoutValidCurrency = 0;
  for (const order of orders) {
    const status = typeof order.status === "string" && order.status ? order.status : "unknown";
    statuses.set(status, (statuses.get(status) || 0) + 1);
    const currency = normalizedCurrency(order.currency);
    if (!currency) {
      ordersWithoutValidCurrency += 1;
      continue;
    }
    const currencyOrders = byCurrency.get(currency) || [];
    currencyOrders.push(order);
    byCurrency.set(currency, currencyOrders);
  }

  const currencies = [...byCurrency.keys()].sort();
  const monetaryByCurrency = Object.fromEntries(currencies.map((currency) => {
    const currencyOrders = byCurrency.get(currency);
    const grossRevenue = sumDecimals(currencyOrders.map((order) => order.total));
    const refundTotal = sumDecimals(refundValues(currencyOrders), {absolute: true});
    return [currency, {
      order_count: currencyOrders.length,
      gross_revenue: grossRevenue,
      net_revenue: netRevenueMetric(grossRevenue, refundTotal),
      tax_total: sumDecimals(currencyOrders.map((order) => order.total_tax)),
      shipping_total: sumDecimals(currencyOrders.map((order) => order.shipping_total)),
      discount_total: sumDecimals(currencyOrders.map((order) => order.discount_total)),
      refund_total: refundTotal,
    }];
  }));

  const warnings = [];
  if (ordersWithoutValidCurrency > 0) warnings.push(`${ordersWithoutValidCurrency} order(s) have a missing or invalid currency and were excluded from monetary aggregation`);
  if (currencies.length > 1) warnings.push("Multiple currencies are reported separately and were not combined");
  for (const [currency, metrics] of Object.entries(monetaryByCurrency)) {
    for (const [metric, value] of Object.entries(metrics)) {
      if (metric !== "order_count" && value.quality === "incomplete") warnings.push(`${currency} ${metric} is incomplete because source values are missing or invalid`);
    }
  }

  return {
    data: {
      order_count: orders.length,
      status_counts: Object.fromEntries([...statuses].sort(([left], [right]) => left.localeCompare(right))),
      orders_without_valid_currency: ordersWithoutValidCurrency,
      monetary_by_currency: monetaryByCurrency,
    },
    currencies,
    warnings,
    partial: warnings.length > 0,
  };
}

export function stockQuantity(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)$/.test(value.trim())) {
    const quantity = Number(value);
    return Number.isSafeInteger(quantity) ? quantity : null;
  }
  return null;
}

export function productView(product) {
  return {
    id: product.id ?? null,
    sku: typeof product.sku === "string" ? product.sku : null,
    name: typeof product.name === "string" ? product.name : null,
    slug: typeof product.slug === "string" ? product.slug : null,
    status: typeof product.status === "string" ? product.status : null,
    type: typeof product.type === "string" ? product.type : null,
    catalog_visibility: typeof product.catalog_visibility === "string" ? product.catalog_visibility : null,
    price: decimalValue(product.price),
    regular_price: decimalValue(product.regular_price),
    sale_price: decimalValue(product.sale_price),
    stock_status: typeof product.stock_status === "string" ? product.stock_status : null,
    manage_stock: typeof product.manage_stock === "boolean" ? product.manage_stock : null,
    stock_quantity: stockQuantity(product.stock_quantity),
    backorders: typeof product.backorders === "string" ? product.backorders : null,
    categories: Array.isArray(product.categories) ? product.categories.map(({id, name, slug}) => ({id, name, slug})) : null,
    attributes: Array.isArray(product.attributes) ? product.attributes.map(({id, name, variation, options}) => ({id, name, variation, options})) : null,
    date_modified_gmt: typeof product.date_modified_gmt === "string" ? product.date_modified_gmt : null,
  };
}
