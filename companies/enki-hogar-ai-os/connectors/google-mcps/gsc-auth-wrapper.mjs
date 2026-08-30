import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

export const GSC_OAUTH_CLIENT_PATH = "/run/secrets/google/oauth-client.json";
export const GSC_TOKEN_PATH = "/run/secrets/gsc/tokens.json";

export function readInstalledOAuthClient(filePath = GSC_OAUTH_CLIENT_PATH) {
  let document;
  try {
    document = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("GSC OAuth client JSON is unreadable or invalid");
  }

  const clientId = document?.installed?.client_id;
  const clientSecret = document?.installed?.client_secret;
  if (typeof clientId !== "string" || clientId.length === 0 || typeof clientSecret !== "string" || clientSecret.length === 0) {
    throw new Error("GSC OAuth client JSON must contain installed client credentials");
  }
  return {clientId, clientSecret};
}

export function buildGscEnvironment(baseEnvironment, credentials) {
  return {
    ...baseEnvironment,
    GOOGLE_CLIENT_ID: credentials.clientId,
    GOOGLE_CLIENT_SECRET: credentials.clientSecret,
    GSC_TOKEN_PATH,
  };
}

export function launchGscServer({
  baseEnvironment = process.env,
  command = "/usr/local/bin/gsc-mcp-server",
  oauthClientPath = GSC_OAUTH_CLIENT_PATH,
  spawnProcess = spawn,
} = {}) {
  const credentials = readInstalledOAuthClient(oauthClientPath);
  return spawnProcess(command, [], {
    env: buildGscEnvironment(baseEnvironment, credentials),
    stdio: "inherit",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let child;
  try {
    child = launchGscServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to start GSC MCP server");
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.once("error", () => {
    console.error("Unable to start GSC MCP server");
    process.exit(1);
  });
  child.once("exit", (code) => process.exit(code ?? 1));
}
