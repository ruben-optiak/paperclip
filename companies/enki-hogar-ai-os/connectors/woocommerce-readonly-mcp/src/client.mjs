const MAX_RETRIES = 2;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WooCommerceReadClient {
  constructor(config, options = {}) {
    this.baseUrl = config.baseUrl;
    this.authorization = `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64")}`;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || wait;
  }

  async get(path, params = {}) {
    if (!path.startsWith("/")) throw new Error("WooCommerce path must be absolute within the API");
    const url = new URL(`/wp-json/wc/v3${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const response = await this.fetch(url, {
        method: "GET",
        headers: {authorization: this.authorization, accept: "application/json"},
      });
      if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
        const retryAfter = Number.parseInt(response.headers.get("retry-after") || "1", 10);
        await this.sleep(Math.min(Number.isFinite(retryAfter) ? retryAfter : 1, 5) * 1000);
        continue;
      }
      if (!response.ok) {
        const requestId = response.headers.get("x-request-id");
        throw new Error(`WooCommerce GET failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}`);
      }
      return {data: await response.json(), headers: response.headers};
    }
    throw new Error("WooCommerce retry limit reached");
  }

  async paginate(path, params = {}, maxPages = 20) {
    const rows = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.get(path, {...params, page, per_page: 100});
      if (!Array.isArray(result.data)) throw new Error("WooCommerce returned a non-list response");
      rows.push(...result.data);
      const totalPages = Number.parseInt(result.headers.get("x-wp-totalpages") || String(page), 10);
      if (result.data.length < 100 || page >= totalPages) return {rows, truncated: false};
      if (page === maxPages) truncated = true;
    }
    return {rows, truncated};
  }
}
