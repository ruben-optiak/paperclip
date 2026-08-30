export const order = {
  id: 1001,
  status: "processing",
  date_created_gmt: "2026-08-27T08:00:00",
  date_modified_gmt: "2026-08-27T09:00:00",
  currency: "EUR",
  total: "121.00",
  total_tax: "21.00",
  shipping_total: "5.00",
  discount_total: "4.00",
  line_items: [{product_id: 10, variation_id: 0, name: "Fixture product", sku: "FIX-10", quantity: 2, total: "100.00", total_tax: "21.00"}],
  refunds: [{id: 2, total: "-10.00"}],
};

export function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json", ...headers}});
}
