import { readFileSync } from "node:fs";
import { PublisherError } from "./errors.mjs";

function integer(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PublisherError("invalid_runtime_config");
  }
  return parsed;
}

function secretFile(path, required) {
  if (!path) {
    if (required) throw new PublisherError("missing_runtime_secret_file");
    return null;
  }
  try {
    const value = readFileSync(path, "utf8").trim();
    if (!value) throw new Error("empty");
    return value;
  } catch {
    throw new PublisherError("unreadable_runtime_secret_file");
  }
}

export function readConfig(env = process.env) {
  const writeMode = env.LINEAR_TICKET_PUBLISHER_WRITE_MODE ?? "disabled";
  if (!["disabled", "enabled"].includes(writeMode)) throw new PublisherError("invalid_runtime_config");
  const enabled = writeMode === "enabled";
  const teamId = secretFile(env.LINEAR_TEAM_ID_FILE, enabled);
  if (teamId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(teamId)) {
    throw new PublisherError("invalid_runtime_config");
  }
  return {
    host: env.LINEAR_TICKET_PUBLISHER_HOST ?? "127.0.0.1",
    port: integer(env.LINEAR_TICKET_PUBLISHER_PORT, 8788, 1, 65535),
    journalPath: env.LINEAR_TICKET_PUBLISHER_JOURNAL_PATH ?? "./journal.sqlite",
    writeMode,
    requestTimeoutMs: integer(env.LINEAR_TICKET_PUBLISHER_REQUEST_TIMEOUT_MS, 10000, 1000, 15000),
    teamId,
    oauthClientId: secretFile(env.LINEAR_OAUTH_CLIENT_ID_FILE, enabled),
    oauthClientSecret: secretFile(env.LINEAR_OAUTH_CLIENT_SECRET_FILE, enabled),
    mcpToken: secretFile(env.LINEAR_TICKET_PUBLISHER_MCP_TOKEN_FILE, true),
  };
}
