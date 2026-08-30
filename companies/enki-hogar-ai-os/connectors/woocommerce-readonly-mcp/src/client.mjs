const MAX_RETRIES = 2;
const MAX_PAGINATION_CONCURRENCY = 6;

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

  async paginate(path, params = {}, maxPages = 20, {concurrency = 1} = {}) {
    const requestedMaxPages = Number.isFinite(maxPages) ? Math.floor(maxPages) : 20;
    const requestedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
    const boundedMaxPages = Math.max(1, requestedMaxPages);
    const boundedConcurrency = Math.max(1, Math.min(MAX_PAGINATION_CONCURRENCY, requestedConcurrency));
    const first = await this.get(path, {...params, page: 1, per_page: 100});
    if (!Array.isArray(first.data)) throw new Error("WooCommerce returned a non-list response");

    const rows = [...first.data];
    const totalPagesHeader = Number.parseInt(first.headers.get("x-wp-totalpages") || "", 10);
    const totalPages = Number.isSafeInteger(totalPagesHeader) && totalPagesHeader > 0 ? totalPagesHeader : null;
    const totalItemsHeader = Number.parseInt(first.headers.get("x-wp-total") || "", 10);
    const totalItems = Number.isSafeInteger(totalItemsHeader) && totalItemsHeader >= 0 ? totalItemsHeader : null;
    if (totalPages === 1 || (totalPages === null && first.data.length < 100)) {
      return {rows, truncated: false, pagesFetched: 1, totalPages: totalPages ?? 1, totalItems};
    }

    if (totalPages !== null) {
      const lastPage = Math.min(totalPages, boundedMaxPages);
      for (let firstPage = 2; firstPage <= lastPage; firstPage += boundedConcurrency) {
        const pageNumbers = Array.from(
          {length: Math.min(boundedConcurrency, lastPage - firstPage + 1)},
          (_, index) => firstPage + index,
        );
        const batch = await Promise.all(pageNumbers.map((page) => this.get(path, {...params, page, per_page: 100})));
        for (const result of batch) {
          if (!Array.isArray(result.data)) throw new Error("WooCommerce returned a non-list response");
          rows.push(...result.data);
        }
      }
      return {rows, truncated: totalPages > boundedMaxPages, pagesFetched: lastPage, totalPages, totalItems};
    }

    for (let page = 2; page <= boundedMaxPages; page += 1) {
      const result = await this.get(path, {...params, page, per_page: 100});
      if (!Array.isArray(result.data)) throw new Error("WooCommerce returned a non-list response");
      rows.push(...result.data);
      if (result.data.length < 100) return {rows, truncated: false, pagesFetched: page, totalPages: page, totalItems};
    }
    return {rows, truncated: true, pagesFetched: boundedMaxPages, totalPages: null, totalItems};
  }
}
