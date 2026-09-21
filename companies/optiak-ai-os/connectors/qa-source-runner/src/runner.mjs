#!/usr/bin/env node

import {createHash} from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, join, normalize, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultContractPath = process.env.QA_CONTRACT_PATH
  ?? resolve(moduleDir, "../../../skills/optiak-e2e-validation/references/qa-source-execution-contract.json");
const revisionPattern = /^[0-9a-f]{40}$/;
const manifestName = ".optiak-qa-source.json";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function safeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) return false;
  const normalized = normalize(path);
  return normalized === path && !normalized.startsWith(`..${sep}`) && normalized !== ".." && !normalized.startsWith(sep);
}

export function validateSourceManifest(manifest, sourceDir, expected) {
  if (manifest?.schema !== "optiak-qa-source-snapshot/v1") throw new Error("invalid source snapshot schema");
  if (manifest.repository !== expected.repository) throw new Error("snapshot repository does not match profile");
  if (manifest.revision !== expected.revision || !revisionPattern.test(manifest.revision ?? "")) {
    throw new Error("snapshot must match the exact full revision");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("snapshot file inventory is empty");
  const paths = new Set();
  for (const file of manifest.files) {
    if (!safeRelativePath(file?.path) || file.path === manifestName || paths.has(file.path)) {
      throw new Error(`invalid snapshot path: ${file?.path ?? "unknown"}`);
    }
    paths.add(file.path);
    const absolute = join(sourceDir, file.path);
    const stats = lstatSync(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`snapshot entry is not a regular file: ${file.path}`);
    if (stats.size !== file.bytes || sha256File(absolute) !== file.sha256) {
      throw new Error(`snapshot digest mismatch: ${file.path}`);
    }
  }
  const inventoryDigest = createHash("sha256")
    .update(manifest.files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(""))
    .digest("hex");
  if (inventoryDigest !== manifest.inventorySha256) throw new Error("snapshot inventory digest mismatch");
  return inventoryDigest;
}

function assertSourceReadOnly(sourceDir) {
  const probe = join(sourceDir, `.optiak-write-probe-${process.pid}`);
  try {
    copyFileSync(join(sourceDir, manifestName), probe, constants.COPYFILE_EXCL);
    rmSync(probe, {force: true});
    throw new Error("source mount is writable");
  } catch (error) {
    if (error instanceof Error && error.message === "source mount is writable") throw error;
    if (!["EACCES", "EROFS", "EPERM"].includes(error?.code)) throw error;
  }
}

function copySnapshot(manifest, sourceDir, workspaceDir) {
  mkdirSync(workspaceDir, {recursive: true});
  for (const file of manifest.files) {
    const target = join(workspaceDir, file.path);
    mkdirSync(dirname(target), {recursive: true});
    copyFileSync(join(sourceDir, file.path), target);
  }
}

function validateStack(profile, stack) {
  if (!profile.requiredInput) return null;
  if (!safeRelativePath(stack ?? "") || !(profile.allowedStackPrefixes ?? []).some((prefix) => stack.startsWith(prefix))) {
    throw new Error("stack must be an exact path under an allowlisted prefix");
  }
  if (stack.split("/").includes("..")) throw new Error("stack traversal is forbidden");
  return stack.replace(/\/$/, "");
}

function stepArgv(step, stack) {
  const argv = step.argv ?? step.argvTemplate;
  if (!Array.isArray(argv) || argv.length === 0) throw new Error(`invalid argv for ${step.id}`);
  return argv.map((value) => value.replaceAll("{{stack}}", stack ?? ""));
}

function sanitizedEnvironment(profile) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp/qa-home",
    CI: "1",
    NO_COLOR: "1",
    UV_OFFLINE: "1",
    PNPM_CONFIG_OFFLINE: "true",
    TF_IN_AUTOMATION: "1",
    CHECKPOINT_DISABLE: "1",
    ...profile.environment,
  };
}

export function executeProfile({contract, profileId, sourceDir, workspaceDir, revision, stack}) {
  const profile = contract.profiles?.[profileId];
  if (!profile) throw new Error(`unsupported profile ${profileId}`);
  if (!revisionPattern.test(revision ?? "")) throw new Error("revision must be a full 40-character SHA");
  if (process.env.OPTIAK_QA_NETWORK_MODE !== "none") throw new Error("runner requires network mode none");
  if (process.getuid?.() === 0) throw new Error("runner must not execute as root");
  if (process.env.DOCKER_HOST || existsSync("/var/run/docker.sock") || existsSync("/run/docker.sock")) {
    throw new Error("Docker socket or host is forbidden in the runner");
  }
  accessSync(sourceDir, constants.R_OK);
  assertSourceReadOnly(sourceDir);

  const manifest = JSON.parse(readFileSync(join(sourceDir, manifestName), "utf8"));
  const beforeDigest = validateSourceManifest(manifest, sourceDir, {repository: profile.repository, revision});
  const exactStack = validateStack(profile, stack);
  copySnapshot(manifest, sourceDir, workspaceDir);
  mkdirSync("/tmp/qa-home", {recursive: true});

  const startedAt = new Date();
  const start = Date.now();
  const stepResults = [];
  let artifactBytes = 0;
  for (const step of profile.steps) {
    const argv = stepArgv(step, exactStack);
    const remainingMs = Math.max(1, contract.runtime.maximumJobSeconds * 1000 - (Date.now() - start));
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: workspaceDir,
      env: sanitizedEnvironment(profile),
      encoding: "utf8",
      timeout: remainingMs,
      maxBuffer: contract.runtime.maximumArtifactBytes,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    artifactBytes += Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
    stepResults.push({
      id: step.id,
      exitCode: Number.isInteger(result.status) ? result.status : 124,
      stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
      stderrSha256: createHash("sha256").update(stderr).digest("hex"),
      outputBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
      timedOut: result.error?.code === "ETIMEDOUT",
    });
  }
  const completedAt = new Date();
  const afterDigest = validateSourceManifest(manifest, sourceDir, {repository: profile.repository, revision});
  return {
    schema: "optiak-qa-source-execution-evidence/v1",
    evidenceScope: "connected_ephemeral_qa",
    agentSlug: contract.executionAgent,
    repository: profile.repository,
    revision,
    profile: profileId,
    runtimeBoundary: contract.runtime.requiredBoundary,
    sharedControlPlaneUsed: false,
    repositoryCredentialVisibleToTests: false,
    productionCredentialsPresent: false,
    customerDataPresent: false,
    dockerSocketMounted: false,
    externalWrites: 0,
    sourceChangesPersisted: beforeDigest !== afterDigest,
    sourceInventorySha256: beforeDigest,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: Math.ceil((completedAt.getTime() - startedAt.getTime()) / 1000),
    artifactBytes,
    cleanup: "controller_pending",
    stepResults,
  };
}

function parseArgs(argv) {
  const result = {source: "/source", workspace: "/workspace"};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") result.source = argv[++index];
    else if (argument === "--workspace") result.workspace = argv[++index];
    else if (argument === "--profile") result.profile = argv[++index];
    else if (argument === "--revision") result.revision = argv[++index];
    else if (argument === "--stack") result.stack = argv[++index];
    else if (argument === "--contract") result.contract = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile || !args.revision) throw new Error("--profile and --revision are required");
  const contract = JSON.parse(readFileSync(args.contract ?? defaultContractPath, "utf8"));
  const evidence = executeProfile({
    contract,
    profileId: args.profile,
    sourceDir: resolve(args.source),
    workspaceDir: resolve(args.workspace),
    revision: args.revision,
    stack: args.stack,
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
