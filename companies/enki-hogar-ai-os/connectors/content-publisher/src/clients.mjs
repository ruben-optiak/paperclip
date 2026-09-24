import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {basename} from "node:path";

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

function productReviewMeta(product) {
  const approvedMetaKeys = new Set([
    "_yoast_wpseo_title",
    "_yoast_wpseo_metadesc",
    "_yoast_wpseo_focuskw",
    "_enki_manufacturer_reference",
    "_enki_product_bundle_sha256",
    "_enki_paperclip_issue",
    "_enki_approval_document",
    "_enki_approval_revision",
  ]);
  return Object.fromEntries((Array.isArray(product?.meta_data) ? product.meta_data : [])
    .filter((item) => approvedMetaKeys.has(item?.key))
    .map((item) => [item.key, String(item?.value ?? "")]));
}

function productView(product) {
  return {
    external_id: Number.isSafeInteger(Number(product?.id)) ? String(product.id) : null,
    status: typeof product?.status === "string" ? product.status : "unknown",
    type: typeof product?.type === "string" ? product.type : "unknown",
    name: typeof product?.name === "string" ? product.name : "",
    slug: typeof product?.slug === "string" ? product.slug : "",
    sku: typeof product?.sku === "string" ? product.sku : "",
    global_unique_id: typeof product?.global_unique_id === "string" ? product.global_unique_id : "",
    catalog_visibility: typeof product?.catalog_visibility === "string" ? product.catalog_visibility : "unknown",
    description_html: boundedText(product?.description ?? ""),
    short_description_html: boundedText(product?.short_description ?? "", 10_000),
    category_ids: Array.isArray(product?.categories) ? product.categories.map((item) => Number(item?.id)).filter(Number.isSafeInteger).sort((left, right) => left - right) : [],
    brand_ids: Array.isArray(product?.brands) ? product.brands.map((item) => Number(item?.id)).filter(Number.isSafeInteger).sort((left, right) => left - right) : [],
    tag_ids: Array.isArray(product?.tags) ? product.tags.map((item) => Number(item?.id)).filter(Number.isSafeInteger).sort((left, right) => left - right) : [],
    attributes: Array.isArray(product?.attributes) ? product.attributes.map((item) => ({
      id: Number(item?.id),
      options: Array.isArray(item?.options) ? item.options.map(String) : [],
      visible: item?.visible === true,
      variation: item?.variation === true,
    })).filter((item) => Number.isSafeInteger(item.id)).sort((left, right) => left.id - right.id) : [],
    regular_price: typeof product?.regular_price === "string" ? product.regular_price : "",
    sale_price: typeof product?.sale_price === "string" ? product.sale_price : "",
    manage_stock: product?.manage_stock === true,
    stock_quantity: product?.stock_quantity !== null && product?.stock_quantity !== undefined && Number.isSafeInteger(Number(product.stock_quantity))
      ? Number(product.stock_quantity)
      : null,
    stock_status: typeof product?.stock_status === "string" ? product.stock_status : "unknown",
    canonical_url: typeof product?.permalink === "string" ? product.permalink : null,
    image_ids: Array.isArray(product?.images) ? product.images.map((item) => Number(item?.id)).filter(Number.isSafeInteger) : [],
    review_meta: productReviewMeta(product),
  };
}

function variationView(variation) {
  return {
    external_id: Number.isSafeInteger(Number(variation?.id)) ? String(variation.id) : null,
    status: typeof variation?.status === "string" ? variation.status : "unknown",
    sku: typeof variation?.sku === "string" ? variation.sku : "",
    global_unique_id: typeof variation?.global_unique_id === "string" ? variation.global_unique_id : "",
    regular_price: typeof variation?.regular_price === "string" ? variation.regular_price : "",
    sale_price: typeof variation?.sale_price === "string" ? variation.sale_price : "",
    manage_stock: variation?.manage_stock === true,
    stock_quantity: variation?.stock_quantity !== null && variation?.stock_quantity !== undefined && Number.isSafeInteger(Number(variation.stock_quantity))
      ? Number(variation.stock_quantity)
      : null,
    stock_status: typeof variation?.stock_status === "string" ? variation.stock_status : "unknown",
    image_id: Number.isSafeInteger(Number(variation?.image?.id)) ? Number(variation.image.id) : null,
    attributes: Array.isArray(variation?.attributes) ? variation.attributes.map((item) => ({
      id: Number(item?.id),
      option: typeof item?.option === "string" ? item.option : "",
    })).filter((item) => Number.isSafeInteger(item.id)).sort((left, right) => left.id - right.id) : [],
    review_meta: productReviewMeta(variation),
  };
}

export class WordPressMediaClient {
  constructor(config, {fetch: fetchImpl = globalThis.fetch} = {}) {
    this.baseUrl = config.baseUrl;
    this.authorization = `Basic ${Buffer.from(`${config.mediaUsername}:${config.mediaAppPassword}`).toString("base64")}`;
    this.fetch = fetchImpl;
  }

  url(path) {
    if (!path.startsWith("/")) throw new Error("WordPress media API path must be absolute");
    return new URL(`/wp-json/wp/v2${path}`, this.baseUrl);
  }

  async uploadWebp(path, {alt, title, expectedSha256}) {
    const filename = basename(path);
    if (!/^[a-z0-9][a-z0-9._-]*\.webp$/.test(filename)) throw new Error("Product media filename is unsafe");
    const bytes = await readFile(path);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256) throw new Error("Product media changed after bundle review");
    const created = await call(this.fetch, this.url("/media"), {
      method: "POST",
      headers: {
        authorization: this.authorization,
        accept: "application/json",
        "content-type": "image/webp",
        "content-disposition": `attachment; filename="${filename}"`,
      },
      body: bytes,
    }, "WordPress POST /media");
    if (!Number.isSafeInteger(Number(created?.id))) throw new Error("WordPress did not return an ID for uploaded product media");
    const updated = await call(this.fetch, this.url(`/media/${Number(created.id)}`), {
      method: "POST",
      headers: {
        authorization: this.authorization,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({alt_text: alt, title}),
    }, `WordPress POST /media/${Number(created.id)}`);
    return {
      id: Number(updated?.id ?? created.id),
      source_url: typeof updated?.source_url === "string" ? updated.source_url : typeof created?.source_url === "string" ? created.source_url : null,
      alt,
      name: title,
    };
  }
}

export class WooCommerceProductClient {
  constructor(config, {fetch: fetchImpl = globalThis.fetch} = {}) {
    this.baseUrl = config.baseUrl;
    this.authorization = `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64")}`;
    this.fetch = fetchImpl;
  }

  url(path, params = {}) {
    if (!path.startsWith("/")) throw new Error("WooCommerce API path must be absolute");
    const url = new URL(`/wp-json/wc/v3${path}`, this.baseUrl);
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
    }, `WooCommerce ${method} ${path}`);
  }

  async findBySku(sku) {
    const rows = await this.request("GET", "/products", {params: {sku, status: "any", per_page: 10}});
    if (!Array.isArray(rows)) throw new Error("WooCommerce returned a non-list product response");
    const exact = rows.filter((entry) => entry?.sku === sku);
    if (exact.length > 1) throw new Error(`WooCommerce returned multiple products for SKU ${sku}`);
    return exact[0] ? productView(exact[0]) : null;
  }

  async resolveBrandBySlug(slug) {
    const rows = await this.request("GET", "/products/brands", {params: {slug, per_page: 100}});
    if (!Array.isArray(rows)) throw new Error("WooCommerce returned a non-list brand response");
    const exact = rows.filter((entry) => entry?.slug === slug);
    if (exact.length !== 1 || !Number.isSafeInteger(Number(exact[0]?.id))) {
      throw new Error(`WooCommerce brand is missing or ambiguous: ${slug}`);
    }
    return {id: Number(exact[0].id), name: String(exact[0].name ?? ""), slug};
  }

  reviewMetadata(manufacturerReference, approval) {
    return [
      {key: "_enki_manufacturer_reference", value: manufacturerReference},
      {key: "_enki_product_bundle_sha256", value: approval.bundleSha256},
      {key: "_enki_paperclip_issue", value: approval.issueIdentifier},
      {key: "_enki_approval_document", value: approval.documentKey},
      {key: "_enki_approval_revision", value: approval.revisionId},
    ];
  }

  async createDraft(product, images, approval, {brandId = null} = {}) {
    const body = {
      name: product.name,
      slug: product.slug,
      type: product.type,
      status: "draft",
      catalog_visibility: "hidden",
      sku: product.sku,
      ...(product.gtin ? {global_unique_id: product.gtin} : {}),
      description: product.descriptionHtml,
      short_description: product.shortDescriptionHtml,
      categories: product.categories.map((id) => ({id})),
      ...(brandId ? {brands: [{id: brandId}]} : {}),
      tags: product.tags.map((id) => ({id})),
      attributes: product.attributes,
      images: images
        .filter((image) => image.gallery !== false)
        .map((image) => ({id: image.id, name: image.name, alt: image.alt})),
      ...(product.commerce.regularPrice ? {regular_price: product.commerce.regularPrice} : {}),
      ...(product.commerce.salePrice ? {sale_price: product.commerce.salePrice} : {}),
      manage_stock: product.commerce.manageStock,
      ...(product.commerce.stockQuantity === undefined ? {} : {stock_quantity: product.commerce.stockQuantity}),
      stock_status: product.commerce.stockStatus,
      meta_data: [
        {key: "_yoast_wpseo_title", value: product.seo.title},
        {key: "_yoast_wpseo_metadesc", value: product.seo.description},
        {key: "_yoast_wpseo_focuskw", value: product.seo.focusKeyword},
        ...this.reviewMetadata(product.manufacturerReference, approval),
      ],
    };
    const parent = productView(await this.request("POST", "/products", {body}));
    if (product.type !== "variable") return parent;
    if (!parent.external_id) throw new Error("WooCommerce did not return a variable parent product ID");
    const imageByPosition = new Map(images.map((image) => [image.position, image]));
    const variations = [];
    try {
      for (const child of product.variations) {
        const childImage = child.imagePosition === undefined ? null : imageByPosition.get(child.imagePosition);
        const childBody = {
          status: "private",
          sku: child.sku,
          ...(child.gtin ? {global_unique_id: child.gtin} : {}),
          regular_price: child.commerce.regularPrice,
          ...(child.commerce.salePrice ? {sale_price: child.commerce.salePrice} : {}),
          manage_stock: child.commerce.manageStock,
          ...(child.commerce.stockQuantity === undefined ? {} : {stock_quantity: child.commerce.stockQuantity}),
          stock_status: child.commerce.stockStatus,
          attributes: child.attributes,
          ...(childImage ? {image: {id: childImage.id}} : {}),
          meta_data: this.reviewMetadata(child.manufacturerReference, approval),
        };
        variations.push(variationView(await this.request(
          "POST",
          `/products/${parent.external_id}/variations`,
          {body: childBody},
        )));
      }
    } catch {
      const createdIds = variations.map((item) => item.external_id).filter(Boolean).join(",") || "none";
      throw new Error(`WooCommerce variable draft is incomplete; reconcile parent ${parent.external_id} and created variations ${createdIds} before retrying`);
    }
    return {...parent, variations};
  }

  async getProduct(id) {
    return productView(await this.request("GET", `/products/${id}`));
  }

  async getVariation(productId, variationId) {
    return variationView(await this.request("GET", `/products/${productId}/variations/${variationId}`));
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

  async publishFacebookMultiPhoto({message, images}) {
    const pageId = this.requireFacebook();
    const photoIds = [];
    for (const image of images) {
      const photo = await this.request("POST", this.config.graphBaseUrl, `/${encodeURIComponent(pageId)}/photos`, {
        form: {url: image.image_url, published: "false"},
      });
      if (!photo?.id) throw new Error("Meta did not return an ID for a Facebook Page photo");
      photoIds.push(String(photo.id));
    }
    const attachedMedia = Object.fromEntries(photoIds.map((id, index) => [`attached_media[${index}]`, JSON.stringify({media_fbid: id})]));
    const published = await this.request("POST", this.config.graphBaseUrl, `/${encodeURIComponent(pageId)}/feed`, {
      form: {message, ...attachedMedia},
    });
    if (!published?.id) throw new Error("Meta did not return an ID for the Facebook multi-photo post");
    return {
      provider: "facebook",
      operation: "published",
      external_id: String(published.id),
      photo_ids: photoIds,
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

  async waitForInstagramContainer(containerId, deadline) {
    while (Date.now() < deadline) {
      const status = await this.request("GET", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(containerId)}`, {
        params: {fields: "status_code"},
      });
      if (status?.status_code === "FINISHED") return;
      if (status?.status_code === "ERROR" || status?.status_code === "EXPIRED") {
        throw new Error("Meta could not process an Instagram media container");
      }
      if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, deadline - Date.now())));
    }
    throw new Error("Instagram media container is not ready; reconcile before retrying");
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

  async publishInstagramCarousel({images, caption}) {
    const userId = this.requireInstagram();
    // Approved Paperclip calls have a 60 s ceiling; leave time for final publish.
    const processingDeadline = Date.now() + 35_000;
    const childIds = [];
    for (const image of images) {
      const child = await this.request("POST", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/media`, {
        form: {image_url: image.image_url, is_carousel_item: "true", alt_text: image.alt_text},
      });
      if (!child?.id) throw new Error("Meta did not return an Instagram carousel item ID");
      childIds.push(String(child.id));
      await this.waitForInstagramContainer(String(child.id), processingDeadline);
    }
    const parent = await this.request("POST", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/media`, {
      form: {media_type: "CAROUSEL", children: childIds.join(","), caption},
    });
    if (!parent?.id) throw new Error("Meta did not return an Instagram carousel container ID");
    await this.waitForInstagramContainer(String(parent.id), processingDeadline);
    const published = await this.request("POST", this.config.instagramGraphBaseUrl, `/${encodeURIComponent(userId)}/media_publish`, {
      form: {creation_id: parent.id},
    });
    if (!published?.id) throw new Error("Meta did not return an Instagram carousel media ID");
    return {
      provider: "instagram",
      operation: "published",
      external_id: String(published.id),
      container_id: String(parent.id),
      child_container_ids: childIds,
      canonical_url: null,
      status: "published",
      published_at: new Date().toISOString(),
    };
  }
}

export {wordpressPostView};
