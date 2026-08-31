#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {chmod, lstat, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const PUBLISHING_DEFAULTS = {
  CONTENT_PUBLISHER_MCP_TOKEN: null,
  CONTENT_PUBLISH_WRITE_MODE: "disabled",
};

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

function configuredSecret(raw) {
  const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  return /^[A-Za-z0-9_-]{43,}$/.test(value) && !/^change-me(?:-|$)/i.test(value);
}

export async function initializePublishingSecrets(envFile, {
  randomValue = () => randomBytes(48).toString("base64url"),
} = {}) {
  const target = resolve(envFile);
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Environment target must be a regular file, not a symlink");
  if (stats.size > 64 * 1024) throw new Error("Environment file exceeds the 64 KiB safety limit");

  const original = await readFile(target, "utf8");
  const entries = new Map();
  for (const line of original.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || !Object.hasOwn(PUBLISHING_DEFAULTS, match[1])) continue;
    if (entries.has(match[1])) throw new Error(`Duplicate environment key: ${match[1]}`);
    entries.set(match[1], match[2]);
  }

  if (entries.has("CONTENT_PUBLISHER_MCP_TOKEN") && !configuredSecret(entries.get("CONTENT_PUBLISHER_MCP_TOKEN"))) {
    throw new Error("CONTENT_PUBLISHER_MCP_TOKEN exists but is empty, weak, or still a placeholder");
  }
  if (entries.has("CONTENT_PUBLISH_WRITE_MODE") && entries.get("CONTENT_PUBLISH_WRITE_MODE").trim() !== "disabled") {
    throw new Error("Existing CONTENT_PUBLISH_WRITE_MODE must be disabled during initialization");
  }

  const additions = [];
  const generated = [];
  const existing = [];
  if (entries.has("CONTENT_PUBLISHER_MCP_TOKEN")) existing.push("CONTENT_PUBLISHER_MCP_TOKEN");
  else {
    const secret = String(randomValue());
    if (!configuredSecret(secret)) throw new Error("Generated publishing bearer is not a high-entropy URL-safe secret");
    additions.push(`CONTENT_PUBLISHER_MCP_TOKEN=${secret}`);
    generated.push("CONTENT_PUBLISHER_MCP_TOKEN");
  }
  if (entries.has("CONTENT_PUBLISH_WRITE_MODE")) existing.push("CONTENT_PUBLISH_WRITE_MODE");
  else additions.push("CONTENT_PUBLISH_WRITE_MODE=disabled");

  if (additions.length === 0) return {generated, existing, writeMode: "disabled", mode: "unchanged"};
  const separator = original.length === 0 || original.endsWith("\n") ? "" : "\n";
  const next = `${original}${separator}\n# Governed content publisher: generated locally; never commit.\n${additions.join("\n")}\n`;
  const temporary = join(dirname(target), `.${basename(target)}.publishing-secrets-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(temporary, next, {encoding: "utf8", mode: 0o600, flag: "wx"});
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return {generated, existing, writeMode: "disabled", mode: "updated_atomically"};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options["env-file"]) throw new Error("--env-file is required");
  const result = await initializePublishingSecrets(options["env-file"]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`init-local-publishing-secrets: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
