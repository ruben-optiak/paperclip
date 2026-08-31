# WooCommerce read-only MCP

Stateless MCP HTTP service at `/mcp`, with a non-sensitive `/health` endpoint. It uses only WooCommerce `GET` requests and deliberately has no generic request tool or write operation.

Required runtime variables: `WOO_BASE_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`. `WOO_MCP_TOKEN` protects `/mcp` with bearer authentication. Use a WooCommerce API key whose real permission is **Read**, not Read/Write.

Published tools:

- `woo_sales_summary`
- `woo_orders_summary` — aggregate-only; it never returns order rows or identifiers
- `woo_get_product`
- `woo_get_product_structure` — live parent/simple product plus bounded variations; an exact variation SKU is expanded through its variable parent
- `woo_low_stock`
- `woo_catalog_summary`

`woo_low_stock` requests only inventory-safe product fields and fetches known
pages in batches of at most six requests. Use `max_pages: 10` for the Enki
smoke test; the response records actual and available pages so truncation stays
visible. Pages use a stable product-ID order, and the connector defensively
deduplicates IDs while reporting raw rows, unique products and WooCommerce's
declared total. Results distinguish exact quantity matches from products that
WooCommerce explicitly marks `outofstock` without exposing a top-level
quantity. Variable-product parents commonly omit that quantity; the response
therefore marks variation-level low-stock coverage as partial instead of
treating a missing value as zero.

`woo_get_product_structure` accepts one exact parent ID, parent/simple SKU, or variation SKU. A variation SKU is resolved to its declared variable parent, verified against that parent's variation collection, and kept in the result even when a bounded page cap makes sibling coverage partial. The `resolution` object records the exact match and root product. The tool returns current sellable attributes, variation SKU, price, status and stock without persisting them elsewhere. Arbitrary Woo metadata is removed; only `_enki_original_pdf_sku` is exposed as the non-secret bridge to approved manufacturer references. Use a complete fresh Woo export for bulk reconciliation.

The catalog contains no order lookup, customer data, create, update, delete, refund, set-price, set-stock, or bulk-order operation. Every successful tool response uses `enki-evidence-envelope/v1`.
