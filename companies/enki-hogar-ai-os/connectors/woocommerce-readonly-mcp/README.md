# WooCommerce read-only MCP

Stateless MCP HTTP service at `/mcp`, with a non-sensitive `/health` endpoint. It uses only WooCommerce `GET` requests and deliberately has no generic request tool or write operation.

Required runtime variables: `WOO_BASE_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`. `WOO_MCP_TOKEN` protects `/mcp` with bearer authentication. Use a WooCommerce API key whose real permission is **Read**, not Read/Write.

Published tools:

- `woo_sales_summary`
- `woo_orders_summary` — aggregate-only; it never returns order rows or identifiers
- `woo_get_product`
- `woo_low_stock`
- `woo_catalog_summary`

The catalog contains no order lookup, customer data, create, update, delete, refund, price, stock, or bulk-order operation. Every successful tool response uses `enki-evidence-envelope/v1`.
