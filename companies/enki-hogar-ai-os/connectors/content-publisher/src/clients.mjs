const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

function htmlText(value) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function boundedText(value, maximum = 100_000) {
  if (typeof value !== "string") return "";
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}

function requestId(response) {
  return response.headers.get("x-request-id") || response.headers.get("x-fb-request-id");
}

async function decodeJson(response, label) {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error(`${label} returned an oversized response`);
  if (!response.ok) {
    const id = requestId(response);
    throw new Error(`${label} failed with HTTP ${response.status}${id ? ` (request ${id})` : ""}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function call(fetchImpl, url, init, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {...init, signal: controller.signal});
    return await decodeJson(response, label);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function wordpressPostView(post, {includeContent = false} = {}) {
  const view = {
    id: Number(post?.id),
    status: typeof post?.status === "string" ? post.status : "unknown",
    slug: typeof post?.slug === "string" ? post.slug : "",
    title: htmlText(post?.title?.rendered ?? post?.title),
    excerpt: htmlText(post?.excerpt?.rendered ?? post?.excerpt),
    canonical_url: typeof post?.link === "string" ? post.link : null,
    published_at: typeof post?.date_gmt === "string" ? post.date_gmt : post?.date ?? null,
    modified_at: typeof post?.modified_gmt === "string" ? post.modified_gmt : post?.modified ?? null,
    featured_media: Number.isSafeInteger(Number(post?.featured_media)) ? Number(post.featured_media) : null,
    categories: Array.isArray(post?.categories) ? post.categories.map(Number).filter(Number.isSafeInteger) : [],
    tags: Array.isArray(post?.tags) ? post.tags.map(Number).filter(Number.isSafeInteger) : [],
  };
  if (includeContent) view.content_html = boundedText(post?.content?.rendered ?? post?.content ?? "");
  return view;
}

export class WordPressClient {
  constructor(config, {fetch: fetchImpl = globalThis.fetch} = {}) {
    this.baseUrl = config.baseUrl;
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString("base64")}`;
    this.fetch = fetchImpl;
  }

  url(path, params = {}) {
    if (!path.startsWith("/")) throw new Error("WordPress API path must be absolute");
    const url = new URL(`/wp-json/wp/v2${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request(method, path, {params, body} = {}) {
    return call(this.fetch, this.url(path, params), {
      method,
      headers: {
        authorization: this.authorization,
        accept: "application/json",
        ...(body === undefined ? {} : {"content-type": "application/json"}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, `WordPress ${method} ${path}`);
  }

  async listPosts({status = "any", page = 1, perPage = 20} = {}) {
    // Published posts are public editorial history. Requesting them with
    // `context=edit` can make WordPress (or an authorization plugin) restrict
    // an Author integration user to posts it owns, which hides older posts
    // written by other authors. Non-public states still require edit context.
    const context = status === "publish" ? "view" : "edit";
    const rows = await this.request("GET", "/posts", {
      params: {
        context,
        status,
        page,
        per_page: perPage,
        orderby: "date",
        order: "desc",
        _fields: "id,status,slug,title,excerpt,link,date,date_gmt,modified,modified_gmt,featured_media,categories,tags",
      },
    });
    if (!Array.isArray(rows)) throw new Error("WordPress returned a non-list posts response");
    return {posts: rows.map((post) => wordpressPostView(post)), page, per_page: perPage};
  }

  async getPost(id) {
    // This tool reads rendered editorial content and does not need edit-only
    // fields. View context lets the least-privilege Author account inspect
    // published history owned by other WordPress users.
    return wordpressPostView(await this.request("GET", `/posts/${id}`, {params: {context: "view"}}), {includeContent: true});
  }

  async findPostBySlug(slug) {
    const rows = [];
    for (const status of ["publish", "future", "draft", "pending", "private"]) {
      // Detect public slug collisions across all authors. Non-public content
      // remains scoped to what the integration Author may edit.
      const context = status === "publish" ? "view" : "edit";
      const page = await this.request("GET", "/posts", {
        params: {context, slug, status, per_page: 10},
      });
      if (!Array.isArray(page)) throw new Error("WordPress returned a non-list slug response");
      rows.push(...page);
    }
    const exact = [...new Map(rows.filter((post) => post?.slug === slug).map((post) => [post.id, post])).values()];
    if (exact.length > 1) throw new Error(`WordPress returned multiple posts for slug ${slug}`);
    return exact[0] ?? null;
  }

  async resolveTerms(taxonomy, values, createMissing) {
    const ids = [];
    for (const raw of values) {
      if (typeof raw === "number") {
        ids.push(raw);
        continue;
      }
      const name = raw.trim();
      if (/^\d+$/.test(name)) {
        ids.push(Number(name));
        continue;
      }
      const rows = await this.request("GET", `/${taxonomy}`, {params: {search: name, per_page: 100}});
      const exact = Array.isArray(rows) ? rows.find((term) => String(term?.name).localeCompare(name, undefined, {sensitivity: "accent"}) === 0) : null;
      if (exact?.id) {
        ids.push(Number(exact.id));
        continue;
      }
      if (!createMissing) throw new Error(`WordPress ${taxonomy} term does not exist: ${name}`);
      const created = await this.request("POST", `/${taxonomy}`, {body: {name}});
      if (!created?.id) throw new Error(`WordPress did not return an ID for created ${taxonomy} term`);
      ids.push(Number(created.id));
    }
    return [...new Set(ids)];
  }

  async upsertPost(input) {
    const existing = input.post_id ? {id: input.post_id} : await this.findPostBySlug(input.slug);
    const categories = await this.resolveTerms("categories", input.categories, input.create_missing_terms);
    const tags = await this.resolveTerms("tags", input.tags, input.create_missing_terms);
    const body = {
      title: input.title,
      content: input.content_html,
      excerpt: input.excerpt,
      slug: input.slug,
      status: input.status,
      categories,
      tags,
      ...(input.date ? {date: input.date} : {}),
      ...(input.featured_media ? {featured_media: input.featured_media} : {}),
      ...(input.seo_description ? {meta: {_yoast_wpseo_metadesc: input.seo_description}} : {}),
    };
    const created = !existing;
    const post = await this.request("POST", existing ? `/posts/${existing.id}` : "/posts", {body});
    return {
      provider: "wordpress",
      operation: created ? "created" : "updated",
      external_id: String(post.id),
      canonical_url: typeof post.link === "string" ? post.link : null,
      status: post.status,
      slug: post.slug,
      published_at: post.date_gmt ?? post.date ?? null,
    };
  }
}

function metaItemView(item, channel) {
  return {
    channel,
    external_id: typeof item?.id === "string" ? item.id : null,
    message: boundedText(item?.message ?? item?.caption ?? "", 10_000),
    media_type: typeof item?.media_type === "string" ? item.media_type : null,
    canonical_url: typeof item?.permalink_url === "string" ? item.permalink_url : typeof item?.permalink === "string" ? item.permalink : null,
    published_at: item?.created_time ?? item?.timestamp ?? null,
  };
}

export class MetaClient {
  constructor(config, {fetch: fetchImpl = globalThis.fetch} = {}) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  url(baseUrl, path, params = {}) {
    const url = new URL(`/${this.config.graphApiVersion}${path}`, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request(method, baseUrl, path, {params, form} = {}) {
    return call(this.fetch, this.url(baseUrl, path, params), {
      method,
      headers: {
        authorization: `Bearer ${this.config.accessToken}`,
        accept: "application/json",
        ...(form === undefined ? {} : {"content-type": "application/x-www-form-urlencoded"}),
      },
      body: form === undefined ? undefined : new URLSearchParams(Object.entries(form).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString(),
    }, `Meta ${method} request`);
  }

  requireFacebook() {
    if (!this.config.facebookPageId) throw new Error("Facebook Page publishing is not configured");
    return this.config.facebookPageId;
  }

  requireInstagram() {
    if (!this.config.instagramUserId) throw new Error("Instagram publishing is not configured");
    return this.config.instagramUserId;
  }

  async listFacebookPosts({limit = 20} = {}) {
    const pageId = this.requireFacebook();
    const response = await this.request("GET", this.config.graphBaseUrl, `/${encodeURIComponent(pageId)}/published_posts`, {
      params: {fields: "id,message,created_time,permalink_url", limit},
    });
    return {posts: Array.isArray(response?.data) ? response.data.map((item) => metaItemView(item, "facebook")) : []};
  }

  async publishFacebookPost({message, link}) {
    const pageId = this.requireFacebook();
    const response = await this.request("POST", this.config.graphBaseUrl, `/${encodeURIComponent(pageId)}/feed`, {
      form: {message, link, published: "true"},
    });
    if (!response?.id) throw new Error("Meta did not return an ID for the Facebook Page post");
    return {
      provider: "facebook",
      operation: "published",
      external_id: String(response.id),
      canonical_url: null,
      status: "published",
      published_at: new Date().toISOString(),
    };
  }

  async listInstagramMedia({limit = 20} = {}) {
    const userId = this.requireInstagram();
    const response = await this.request("GET", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/media`, {
      params: {fields: "id,caption,media_type,permalink,timestamp", limit},
    });
    return {media: Array.isArray(response?.data) ? response.data.map((item) => metaItemView(item, "instagram")) : []};
  }

  async instagramPublishingLimit() {
    const userId = this.requireInstagram();
    const response = await this.request("GET", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/content_publishing_limit`, {
      params: {fields: "quota_usage,config"},
    });
    return {quota_usage: response?.data?.[0]?.quota_usage ?? response?.quota_usage ?? null};
  }

  async publishInstagramImage({image_url, caption, alt_text}) {
    const userId = this.requireInstagram();
    const container = await this.request("POST", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/media`, {
      form: {image_url, caption, alt_text},
    });
    if (!container?.id) throw new Error("Meta did not return an Instagram media container ID");
    const published = await this.request("POST", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/media_publish`, {
      form: {creation_id: container.id},
    });
    if (!published?.id) throw new Error("Meta did not return an Instagram media ID");
    return {
      provider: "instagram",
      operation: "published",
      external_id: String(published.id),
      container_id: String(container.id),
      canonical_url: null,
      status: "published",
      published_at: new Date().toISOString(),
    };
  }
}

export {wordpressPostView};
