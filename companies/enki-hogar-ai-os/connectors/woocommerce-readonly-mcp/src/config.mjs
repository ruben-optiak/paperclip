function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function readConfig(env = process.env) {
  const baseUrl = required(env, "WOO_BASE_URL").replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) {
    throw new Error("WOO_BASE_URL must use HTTPS outside localhost");
  }
  return {
    baseUrl,
    consumerKey: required(env, "WOO_CONSUMER_KEY"),
    consumerSecret: required(env, "WOO_CONSUMER_SECRET"),
    token: required(env, "WOO_MCP_TOKEN"),
    host: env.WOO_MCP_HOST?.trim() || "0.0.0.0",
    port: Number.parseInt(env.WOO_MCP_PORT || "8020", 10),
  };
}
