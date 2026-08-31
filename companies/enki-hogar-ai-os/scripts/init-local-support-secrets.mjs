#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {chmod, lstat, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const REQUIRED_SUPPORT_SECRETS = [
  "SUPPORT_DB_ADMIN_PASSWORD",
  "SUPPORT_DB_READER_PASSWORD",
  "SUPPORT_MCP_TOKEN",
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

function configuredValue(raw) {
  const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  return value.length > 0 && !/^change-me(?:-|$)/i.test(value);
}

export async function initializeSupportSecrets(envFile, {
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
    if (!match || !REQUIRED_SUPPORT_SECRETS.includes(match[1])) continue;
    if (entries.has(match[1])) throw new Error(`Duplicate environment key: ${match[1]}`);
    entries.set(match[1], match[2]);
  }

  const existing = [];
  const generated = [];
  const additions = [];
  for (const key of REQUIRED_SUPPORT_SECRETS) {
    if (entries.has(key)) {
      if (!configuredValue(entries.get(key))) throw new Error(`${key} exists but is empty or still a placeholder`);
      existing.push(key);
      continue;
    }
    const value = String(randomValue(key));
    if (!/^[A-Za-z0-9_-]{43,}$/.test(value)) throw new Error(`Generated value for ${key} is not a high-entropy URL-safe secret`);
    additions.push(`${key}=${value}`);
    generated.push(key);
  }

  if (additions.length === 0) return {generated, existing, mode: "unchanged"};
  const separator = original.length === 0 || original.endsWith("\n") ? "" : "\n";
  const next = `${original}${separator}\n# Product-support knowledge: generated locally; never commit.\n${additions.join("\n")}\n`;
  const temporary = join(dirname(target), `.${basename(target)}.support-secrets-${process.pid}-${randomBytes(6).toString("hex")}`);
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
  const result = await initializeSupportSecrets(options["env-file"]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`init-local-support-secrets: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
