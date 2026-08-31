function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(env, name, fallback, minimum, maximum) {
  const value = env[name] === undefined || env[name] === "" ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function databaseConfig(env = process.env, {admin = false} = {}) {
  return {
    host: env.SUPPORT_DB_HOST?.trim() || "enki-product-support-db",
    port: integer(env, "SUPPORT_DB_PORT", 5432, 1, 65535),
    database: env.SUPPORT_DB_NAME?.trim() || "enki_support_knowledge",
    username: admin ? (env.SUPPORT_DB_ADMIN_USER?.trim() || "postgres") : (env.SUPPORT_DB_USER?.trim() || "enki_support_reader"),
    password: required(env, admin ? "SUPPORT_DB_ADMIN_PASSWORD" : "SUPPORT_DB_READER_PASSWORD"),
    max: integer(env, "SUPPORT_DB_POOL_SIZE", admin ? 2 : 10, 1, 30),
  };
}

export function embeddingConfig(env = process.env) {
  const values = {
    baseUrl: env.SUPPORT_EMBEDDING_BASE_URL?.trim() || "",
    apiKey: env.SUPPORT_EMBEDDING_API_KEY?.trim() || "",
    model: env.SUPPORT_EMBEDDING_MODEL?.trim() || "",
  };
  const present = Object.values(values).filter(Boolean).length;
  if (present !== 0 && present !== 3) {
    throw new Error("SUPPORT_EMBEDDING_BASE_URL, SUPPORT_EMBEDDING_API_KEY and SUPPORT_EMBEDDING_MODEL must be configured together");
  }
  return present === 0 ? null : {...values, timeoutMs: integer(env, "SUPPORT_EMBEDDING_TIMEOUT_MS", 15000, 1000, 60000)};
}

export function serverConfig(env = process.env) {
  const token = required(env, "SUPPORT_MCP_TOKEN");
  if (token.length < 24 || /^change-me/i.test(token)) throw new Error("SUPPORT_MCP_TOKEN must be a non-placeholder secret with at least 24 characters");
  return {
    host: env.SUPPORT_MCP_HOST?.trim() || "0.0.0.0",
    port: integer(env, "SUPPORT_MCP_PORT", 8030, 1, 65535),
    token,
    database: databaseConfig(env),
    embeddings: embeddingConfig(env),
  };
}
