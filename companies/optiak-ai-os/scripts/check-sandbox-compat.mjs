#!/usr/bin/env node

import {existsSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(packageDir, "runtime", "compatibility.lock.json");
const paperclipPath = join(packageDir, ".paperclip.yaml");
const composePath = join(packageDir, "runtime", "docker-compose.paperclip.yml");

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

export function evaluateStaticCompatibility({lock, paperclip, compose}) {
  const errors = [];
  const expectedFlags = lock.codex?.expectedLegacyFlagOccurrences;
  const legacyFlags = count(paperclip, /features\.use_legacy_landlock=true/g);

  if (lock.schema !== "optiak-runtime-compatibility/v1") errors.push("unexpected compatibility schema");
  if (lock.codex?.targetBackendStatus !== "blocked") errors.push("target backend must remain blocked until live migration evidence exists");
  if (lock.codex?.currentBackend !== "legacy_landlock") errors.push("current backend must match the versioned agent configuration");
  if (!Number.isInteger(expectedFlags) || expectedFlags !== 10) errors.push("expected legacy flag count must be ten while blocked");
  if (legacyFlags !== expectedFlags) errors.push(`legacy flag count drift: expected ${expectedFlags}, observed ${legacyFlags}`);
  if (count(paperclip, /default_permissions="optiak-review-network"/g) !== 10) errors.push("named read-only network profile count drift");
  if (count(paperclip, /permissions\.optiak-review-network\.extends=\\?":read-only\\?"/g) !== 10) errors.push("read-only profile extension count drift");
  if (count(paperclip, /permissions\.optiak-review-network\.network\.enabled=true/g) !== 10) errors.push("network profile count drift");
  if (count(paperclip, /approval_policy="never"/g) !== 10) errors.push("non-interactive approval policy count drift");
  if (count(paperclip, /dangerouslyBypassApprovalsAndSandbox: false/g) !== 10) errors.push("sandbox bypass policy count drift");

  const forbiddenRuntimeMarkers = [
    [/privileged:\s*true/i, "privileged"],
    [/SYS_ADMIN/i, "CAP_SYS_ADMIN"],
    [/seccomp\s*[:=]\s*unconfined/i, "seccomp_unconfined"],
    [/apparmor\s*[:=]\s*unconfined/i, "apparmor_unconfined"],
    [/danger-full-access/i, "danger_full_access"],
  ];
  for (const [pattern, label] of forbiddenRuntimeMarkers) {
    if (pattern.test(compose)) errors.push(`forbidden control-plane runtime relaxation: ${label}`);
  }

  return {
    contractValid: errors.length === 0,
    migrationState: lock.codex?.targetBackendStatus ?? "unknown",
    legacyFlagOccurrences: legacyFlags,
    errors,
  };
}

function stderrClass(result) {
  const stderr = result.stderr || "";
  if (/No permissions to create a new namespace|needs access to create user namespaces|user namespace/i.test(stderr)) {
    return "user_namespace_unavailable";
  }
  return result.status === 0 ? null : "unclassified_failure";
}

export function classifySandboxProbe(input) {
  const currentFallbackVerified = input.legacyReadStatus === 0
    && input.legacyWriteStatus !== 0
    && input.legacyWriteArtifact === false;
  const modernReadAvailable = input.modernReadStatus === 0;
  const modernWriteDenied = modernReadAvailable
    && input.modernWriteStatus !== 0
    && input.modernWriteArtifact === false;
  const modernSandboxVerified = modernReadAvailable && modernWriteDenied;
  const modernErrorClass = stderrClass({status: input.modernReadStatus, stderr: input.modernReadStderr});
  const observedState = modernSandboxVerified
    ? "ready_for_live_regression"
    : currentFallbackVerified && modernErrorClass === "user_namespace_unavailable"
      ? "blocked"
      : "unsafe_or_unknown";

  return {
    currentFallbackVerified,
    modernReadAvailable,
    modernWriteDenied,
    modernSandboxVerified,
    migrationReady: modernSandboxVerified,
    modernErrorClass,
    observedState,
  };
}

function runCodex(args) {
  return spawnSync("codex", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });
}

function sandboxArgs(useLegacy, command) {
  return [
    "sandbox",
    "-c",
    "sandbox_mode=\"read-only\"",
    "-c",
    `features.use_legacy_landlock=${useLegacy ? "true" : "false"}`,
    "--",
    ...command,
  ];
}

function bounded(message) {
  return String(message || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function runLiveProbe(lock) {
  if (process.platform !== "linux") throw new Error("--live must run inside the Linux execution container");

  const version = runCodex(["--version"]);
  const features = runCodex(["features", "list"]);
  const legacyRead = runCodex(sandboxArgs(true, ["/bin/true"]));
  const modernRead = runCodex(sandboxArgs(false, ["/bin/true"]));
  const suffix = `${process.pid}-${Date.now()}`;
  const legacyPath = join(tmpdir(), `optiak-legacy-write-probe-${suffix}`);
  const modernPath = join(tmpdir(), `optiak-modern-write-probe-${suffix}`);
  const writeCommand = (path) => ["/bin/sh", "-c", 'printf probe > "$1"', "probe", path];
  const legacyWrite = runCodex(sandboxArgs(true, writeCommand(legacyPath)));
  const modernWrite = runCodex(sandboxArgs(false, writeCommand(modernPath)));
  const legacyWriteArtifact = existsSync(legacyPath);
  const modernWriteArtifact = existsSync(modernPath);
  rmSync(legacyPath, {force: true});
  rmSync(modernPath, {force: true});

  const classification = classifySandboxProbe({
    legacyReadStatus: legacyRead.status,
    legacyWriteStatus: legacyWrite.status,
    legacyWriteArtifact,
    modernReadStatus: modernRead.status,
    modernReadStderr: modernRead.stderr,
    modernWriteStatus: modernWrite.status,
    modernWriteArtifact,
  });
  const expectedState = lock.codex.targetBackendStatus === "blocked" ? "blocked" : "ready_for_live_regression";

  return {
    codexVersion: bounded(version.stdout || version.stderr),
    legacyFeature: bounded((features.stdout || "").split("\n").find((line) => line.startsWith("use_legacy_landlock"))),
    probes: {
      legacyReadExitCode: legacyRead.status,
      legacyWriteExitCode: legacyWrite.status,
      legacyWriteArtifact: legacyWriteArtifact ? "present" : "absent",
      modernReadExitCode: modernRead.status,
      modernWriteExitCode: modernWrite.status,
      modernWriteArtifact: modernWriteArtifact ? "present" : "absent",
      modernStderr: bounded(modernRead.stderr),
    },
    ...classification,
    expectedState,
    matchesLock: classification.observedState === expectedState,
  };
}

export function readStaticCompatibility() {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const staticResult = evaluateStaticCompatibility({
    lock,
    paperclip: readFileSync(paperclipPath, "utf8"),
    compose: readFileSync(composePath, "utf8"),
  });
  return {lock, staticResult};
}

function main() {
  const live = process.argv.includes("--live");
  const requireReady = process.argv.includes("--require-ready");
  const json = process.argv.includes("--json");
  const {lock, staticResult} = readStaticCompatibility();
  let liveResult = null;
  let error = null;

  try {
    if (live) liveResult = runLiveProbe(lock);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const result = {
    schema: "optiak-sandbox-compatibility-check/v1",
    contractValid: staticResult.contractValid,
    migrationReady: liveResult?.migrationReady ?? false,
    static: staticResult,
    live: liveResult,
    error,
  };

  if (json) console.log(JSON.stringify(result, null, 2));
  else if (staticResult.contractValid) {
    console.log(`Sandbox compatibility contract valid: migration ${staticResult.migrationState}; ${staticResult.legacyFlagOccurrences} guarded fallback flags.`);
  }

  if (!staticResult.contractValid || error || (liveResult && !liveResult.matchesLock)) process.exitCode = 1;
  if (requireReady && !liveResult?.migrationReady) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
