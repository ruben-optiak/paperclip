#!/usr/bin/env node

import {createHash} from "node:crypto";
import {copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, join, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const allowedRepositories = new Set(["optiak/optiak", "optiak/optiak-frontend", "optiak/iac-infra"]);
const revisionPattern = /^[0-9a-f]{40}$/;

function git(source, args) {
  const result = spawnSync("git", ["-C", source, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}

function safeTrackedPath(path) {
  return path.length > 0 && !path.startsWith(sep) && path !== ".." && !path.startsWith(`..${sep}`) && !path.includes("\0");
}

export function stageSource({source, repository, revision, output}) {
  if (!allowedRepositories.has(repository)) throw new Error("repository is not allowlisted");
  if (!revisionPattern.test(revision ?? "")) throw new Error("revision must be a full 40-character SHA");
  const sourceDir = resolve(source);
  const outputDir = resolve(output);
  if (outputDir === sourceDir || outputDir.startsWith(`${sourceDir}${sep}`)) {
    throw new Error("snapshot output must be outside the source checkout");
  }
  const head = git(sourceDir, ["rev-parse", "HEAD"]).trim();
  if (head !== revision) throw new Error("checkout HEAD does not match requested revision");
  if (git(sourceDir, ["status", "--porcelain=v1", "--untracked-files=no"]).trim()) {
    throw new Error("tracked source checkout must be clean");
  }
  const tracked = git(sourceDir, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  if (tracked.length === 0) throw new Error("source checkout has no tracked files");
  mkdirSync(outputDir, {recursive: false, mode: 0o755});
  const files = [];
  for (const path of tracked) {
    if (!safeTrackedPath(path)) throw new Error(`unsafe tracked path: ${path}`);
    const sourcePath = join(sourceDir, path);
    const stats = lstatSync(sourcePath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`only regular tracked files are allowed: ${path}`);
    const targetPath = join(outputDir, path);
    mkdirSync(dirname(targetPath), {recursive: true, mode: 0o755});
    copyFileSync(sourcePath, targetPath);
    const bytes = readFileSync(targetPath);
    files.push({path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
  }
  const inventorySha256 = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(""))
    .digest("hex");
  const manifest = {
    schema: "optiak-qa-source-snapshot/v1",
    repository,
    revision,
    inventorySha256,
    files,
  };
  writeFileSync(join(outputDir, ".optiak-qa-source.json"), `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o444});
  return manifest;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") result.source = argv[++index];
    else if (argument === "--repository") result.repository = argv[++index];
    else if (argument === "--revision") result.revision = argv[++index];
    else if (argument === "--output") result.output = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.source || !args.repository || !args.revision || !args.output) {
      throw new Error("--source, --repository, --revision and --output are required");
    }
    const manifest = stageSource(args);
    console.log(JSON.stringify({
      schema: manifest.schema,
      repository: manifest.repository,
      revision: manifest.revision,
      trackedFileCount: manifest.files.length,
      inventorySha256: manifest.inventorySha256,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
