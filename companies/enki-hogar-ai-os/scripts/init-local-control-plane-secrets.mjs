#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {chmod, lstat, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const REQUIRED_CONTROL_PLANE_SECRETS = [
  "PAPERCLIP_TOOL_ACTION_SIGNING_SECRET",
];

export const CONTROL_PLANE_INDEPENDENCE_KEYS = [
  "PAPERCLIP_AGENT_JWT_SECRET",
  "BETTER_AUTH_SECRET",
  "WOO_MCP_TOKEN",
  "GOOGLE_MCP_TOKEN",
  "SUPPORT_MCP_TOKEN",
  "CONTENT_PUBLISHER_MCP_TOKEN",
];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function unquote(raw) {
  return raw.trim().replace(/^(['"])(.*)\1$/, "$2");
}

function configuredSecret(raw) {
  const value = unquote(raw);
  return /^[A-Za-z0-9_-]{43,}$/.test(value) && !/^change-me(?:-|$)/i.test(value);
}

export async function initializeControlPlaneSecrets(envFile, {
  randomValue = () => randomBytes(48).toString("base64url"),
} = {}) {
  const target = resolve(envFile);
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Environment target must be a regular file, not a symlink");
  if (stats.size > 64 * 1024) throw new Error("Environment file exceeds the 64 KiB safety limit");

  const original = await readFile(target, "utf8");
  const entries = new Map();
  const watchedKeys = new Set([...REQUIRED_CONTROL_PLANE_SECRETS, ...CONTROL_PLANE_INDEPENDENCE_KEYS]);
  for (const line of original.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || !watchedKeys.has(match[1])) continue;
    if (entries.has(match[1])) throw new Error(`Duplicate environment key: ${match[1]}`);
    entries.set(match[1], match[2]);
  }

  const key = REQUIRED_CONTROL_PLANE_SECRETS[0];
  const existing = [];
  const generated = [];
  let secret;
  if (entries.has(key)) {
    if (!configuredSecret(entries.get(key))) throw new Error(`${key} exists but is empty, weak, or still a placeholder`);
    secret = unquote(entries.get(key));
    existing.push(key);
  } else {
    secret = String(randomValue(key));
    if (!configuredSecret(secret)) throw new Error(`Generated value for ${key} is not a high-entropy URL-safe secret`);
    generated.push(key);
  }

  for (const independentKey of CONTROL_PLANE_INDEPENDENCE_KEYS) {
    if (entries.has(independentKey) && secret === unquote(entries.get(independentKey))) {
      throw new Error(`${key} must be independent from ${independentKey}`);
    }
  }

  if (generated.length === 0) return {generated, existing, mode: "unchanged"};
  const separator = original.length === 0 || original.endsWith("\n") ? "" : "\n";
  const next = `${original}${separator}\n# Paperclip control plane: generated locally; never commit or reuse.\n${key}=${secret}\n`;
  const temporary = join(dirname(target), `.${basename(target)}.control-plane-secrets-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(temporary, next, {encoding: "utf8", mode: 0o600, flag: "wx"});
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return {generated, existing, mode: "updated_atomically"};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options["env-file"]) throw new Error("--env-file is required");
  const result = await initializeControlPlaneSecrets(options["env-file"]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`init-local-control-plane-secrets: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
