const WRITE_MODES = new Set(["disabled", "wordpress-drafts", "approved"]);
const PRODUCT_WRITE_MODES = new Set(["disabled", "woo-drafts"]);

function value(env, key) {
  return env[key]?.trim() || "";
}

function required(env, key) {
  const resolved = value(env, key);
  if (!resolved) throw new Error(`${key} is required`);
  return resolved;
}

function connectorToken(env) {
  const token = required(env, "CONTENT_PUBLISHER_MCP_TOKEN");
  if (token.length < 43 || /^change-me(?:-|$)/i.test(token)) {
    throw new Error("CONTENT_PUBLISHER_MCP_TOKEN must be a strong non-placeholder bearer");
  }
  return token;
}

function safeBaseUrl(raw, key) {
  const normalized = raw.replace(/\/+$/, "");
  const parsed = new URL(normalized);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) throw new Error(`${key} must use HTTPS outside localhost`);
  if (parsed.username || parsed.password) throw new Error(`${key} must not embed credentials`);
  return normalized;
}

function completeGroup(env, keys, label) {
  const present = keys.filter((key) => value(env, key));
  if (present.length > 0 && present.length !== keys.length) {
    const missing = keys.filter((key) => !value(env, key));
    throw new Error(`${label} configuration is incomplete; missing ${missing.join(", ")}`);
  }
  return present.length === keys.length;
}

function graphVersion(raw) {
  if (!/^v\d+\.\d+$/.test(raw)) throw new Error("META_GRAPH_API_VERSION must look like v24.0");
  return raw;
}

function port(raw) {
  const parsed = Number.parseInt(raw || "8040", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("CONTENT_PUBLISHER_MCP_PORT must be a valid TCP port");
  return parsed;
}

export function readConfig(env = process.env) {
  const writeMode = value(env, "CONTENT_PUBLISH_WRITE_MODE") || "disabled";
  if (!WRITE_MODES.has(writeMode)) throw new Error("CONTENT_PUBLISH_WRITE_MODE must be disabled, wordpress-drafts, or approved");
  const productWriteMode = value(env, "PRODUCT_PUBLISH_WRITE_MODE") || "disabled";
  if (!PRODUCT_WRITE_MODES.has(productWriteMode)) throw new Error("PRODUCT_PUBLISH_WRITE_MODE must be disabled or woo-drafts");

  const wordpressConfigured = completeGroup(
    env,
    ["WORDPRESS_BASE_URL", "WORDPRESS_USERNAME", "WORDPRESS_APP_PASSWORD"],
    "WordPress",
  );
  const productPublisherConfigured = completeGroup(
    env,
    [
      "WOO_PUBLISH_BASE_URL",
      "WOO_PUBLISH_CONSUMER_KEY",
      "WOO_PUBLISH_CONSUMER_SECRET",
      "PRODUCT_MEDIA_USERNAME",
      "PRODUCT_MEDIA_APP_PASSWORD",
    ],
    "WooCommerce product publisher",
  );
  const metaCommonPresent = ["META_GRAPH_API_VERSION", "META_GRAPH_ACCESS_TOKEN"].some((key) => value(env, key));
  const metaTargetPresent = ["META_FACEBOOK_PAGE_ID", "META_INSTAGRAM_USER_ID"].some((key) => value(env, key));
  const metaCommonConfigured = completeGroup(env, ["META_GRAPH_API_VERSION", "META_GRAPH_ACCESS_TOKEN"], "Meta");
  if (metaTargetPresent && !metaCommonConfigured) {
    throw new Error("Meta configuration is incomplete; missing META_GRAPH_API_VERSION, META_GRAPH_ACCESS_TOKEN");
  }
  if (metaCommonPresent && !metaTargetPresent) throw new Error("Meta configuration requires META_FACEBOOK_PAGE_ID or META_INSTAGRAM_USER_ID");

  const metaConfigured = metaTargetPresent && metaCommonConfigured;
  const graphApiVersion = metaConfigured ? graphVersion(value(env, "META_GRAPH_API_VERSION")) : null;
  const graphBaseUrl = safeBaseUrl(value(env, "META_GRAPH_BASE_URL") || "https://graph.facebook.com", "META_GRAPH_BASE_URL");
  const instagramGraphBaseUrl = safeBaseUrl(
    value(env, "META_INSTAGRAM_GRAPH_BASE_URL") || graphBaseUrl,
    "META_INSTAGRAM_GRAPH_BASE_URL",
  );

  return {
    host: value(env, "CONTENT_PUBLISHER_MCP_HOST") || "0.0.0.0",
    port: port(value(env, "CONTENT_PUBLISHER_MCP_PORT")),
    token: connectorToken(env),
    writeMode,
    productWriteMode,
    productBundleRoot: value(env, "PRODUCT_DRAFT_BUNDLE_ROOT") || null,
    ledgerPath: value(env, "CONTENT_PUBLISH_LEDGER_PATH") || "/data/publication-ledger.json",
    wordpress: wordpressConfigured ? {
      baseUrl: safeBaseUrl(value(env, "WORDPRESS_BASE_URL"), "WORDPRESS_BASE_URL"),
      username: value(env, "WORDPRESS_USERNAME"),
      appPassword: value(env, "WORDPRESS_APP_PASSWORD"),
    } : null,
    productPublisher: productPublisherConfigured ? {
      baseUrl: safeBaseUrl(value(env, "WOO_PUBLISH_BASE_URL"), "WOO_PUBLISH_BASE_URL"),
      consumerKey: value(env, "WOO_PUBLISH_CONSUMER_KEY"),
      consumerSecret: value(env, "WOO_PUBLISH_CONSUMER_SECRET"),
      mediaUsername: value(env, "PRODUCT_MEDIA_USERNAME"),
      mediaAppPassword: value(env, "PRODUCT_MEDIA_APP_PASSWORD"),
    } : null,
    meta: metaConfigured ? {
      graphApiVersion,
      graphBaseUrl,
      instagramGraphBaseUrl,
      accessToken: value(env, "META_GRAPH_ACCESS_TOKEN"),
      facebookPageId: value(env, "META_FACEBOOK_PAGE_ID") || null,
      instagramUserId: value(env, "META_INSTAGRAM_USER_ID") || null,
    } : null,
  };
}

export function assertProductWriteAllowed(config) {
  if (config.productWriteMode === "disabled") throw new Error("Product publishing writes are disabled by the connector kill switch");
  if (config.productWriteMode !== "woo-drafts") throw new Error("The connector permits WooCommerce product drafts only");
  if (!config.productBundleRoot) throw new Error("Product draft bundle is not configured");
  if (!config.productPublisher) throw new Error("WooCommerce product publishing is not configured");
}

export function assertWriteAllowed(config, provider, status = null) {
  if (config.writeMode === "disabled") throw new Error("Publishing writes are disabled by the connector kill switch");
  if (config.writeMode === "wordpress-drafts") {
    if (provider !== "wordpress" || status !== "draft") {
      throw new Error("The connector currently permits WordPress drafts only");
    }
  }
  if (provider === "wordpress" && !config.wordpress) throw new Error("WordPress is not configured");
  if ((provider === "facebook" || provider === "instagram") && !config.meta) throw new Error("Meta is not configured");
}
