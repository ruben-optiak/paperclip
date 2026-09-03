import {resolve} from "node:path";

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

export function serverConfig(env = process.env) {
  const token = required(env, "CATALOGUE_EVIDENCE_MCP_TOKEN");
  if (token.length < 24 || /^change-me/i.test(token)) {
    throw new Error("CATALOGUE_EVIDENCE_MCP_TOKEN must be a non-placeholder secret with at least 24 characters");
  }
  return {
    host: env.CATALOGUE_EVIDENCE_MCP_HOST?.trim() || "0.0.0.0",
    port: integer(env, "CATALOGUE_EVIDENCE_MCP_PORT", 8050, 1, 65535),
    token,
    publicationRoot: resolve(required(env, "CATALOGUE_EVIDENCE_ROOT")),
    maxCropBytes: integer(env, "CATALOGUE_EVIDENCE_MAX_CROP_BYTES", 1_000_000, 1, 5_000_000),
  };
}
