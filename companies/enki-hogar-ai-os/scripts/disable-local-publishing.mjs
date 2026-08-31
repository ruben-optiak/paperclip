#!/usr/bin/env node
import {randomBytes} from "node:crypto";
import {chmod, lstat, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const WRITE_MODE_KEY = "CONTENT_PUBLISH_WRITE_MODE";

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

export async function disableLocalPublishing(envFile) {
  const target = resolve(envFile);
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Environment target must be a regular file, not a symlink");
  if (stats.size > 64 * 1024) throw new Error("Environment file exceeds the 64 KiB safety limit");

  const original = await readFile(target, "utf8");
  const lines = original.split(/\r?\n/);
  const indexes = lines
    .map((line, index) => line.startsWith(`${WRITE_MODE_KEY}=`) ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) throw new Error(`Duplicate environment key: ${WRITE_MODE_KEY}`);

  if (indexes.length === 1 && lines[indexes[0]].slice(WRITE_MODE_KEY.length + 1).trim() === "disabled") {
    await chmod(target, 0o600);
    return {key: WRITE_MODE_KEY, mode: "disabled", file: "unchanged"};
  }
  if (indexes.length === 1) lines[indexes[0]] = `${WRITE_MODE_KEY}=disabled`;
  else {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("# Governed content publisher kill switch.", `${WRITE_MODE_KEY}=disabled`, "");
  }

  const next = lines.join("\n");
  const temporary = join(dirname(target), `.${basename(target)}.disable-publishing-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(temporary, next, {encoding: "utf8", mode: 0o600, flag: "wx"});
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return {key: WRITE_MODE_KEY, mode: "disabled", file: "updated_atomically"};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options["env-file"]) throw new Error("--env-file is required");
  const result = await disableLocalPublishing(options["env-file"]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`disable-local-publishing: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
