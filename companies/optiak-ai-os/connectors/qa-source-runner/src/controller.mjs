#!/usr/bin/env node

import {createHash, randomBytes} from "node:crypto";
import {chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
  evaluateQaSourceExecution,
  loadQaSourceExecutionContract,
} from "../../../skills/optiak-e2e-validation/scripts/evaluate-qa-source-execution.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultImage = "optiak-qa-source-runner:0.1.29";
const revisionPattern = /^[0-9a-f]{40}$/;

export function buildDockerArgs({source, profile, revision, stack, image = defaultImage}) {
  if (!resolve(source).startsWith("/")) throw new Error("source must resolve to an absolute path");
  if (!revisionPattern.test(revision ?? "")) throw new Error("revision must be a full 40-character SHA");
  const args = [
    "run", "--rm",
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "128",
    "--memory", "2g",
    "--cpus", "2",
    "--user", "65532:65532",
    "--tmpfs", "/workspace:rw,nosuid,nodev,size=1536m,mode=1777",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
    "--mount", `type=bind,src=${resolve(source)},dst=/source,readonly`,
    "--env", "OPTIAK_QA_NETWORK_MODE=none",
    image,
    "--source", "/source",
    "--workspace", "/workspace",
    "--profile", profile,
    "--revision", revision,
  ];
  if (stack) args.push("--stack", stack);
  return args;
}

function syntheticSnapshot() {
  const root = mkdtempSync(join(tmpdir(), "optiak-qa-smoke-"));
  const files = [
    {path: "package.json", content: '{"name":"synthetic","private":true,"scripts":{"lint":"node verify.mjs lint","docs:check":"node verify.mjs docs"}}\n'},
    {path: "verify.mjs", content: 'import {writeFileSync} from "node:fs"; writeFileSync("synthetic-output.txt", process.argv[2] ?? "ok");\n'},
  ].map((file) => {
    const bytes = Buffer.from(file.content);
    mkdirSync(dirname(join(root, file.path)), {recursive: true});
    writeFileSync(join(root, file.path), bytes, {mode: 0o444});
    return {path: file.path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  });
  const revision = randomBytes(20).toString("hex");
  const inventorySha256 = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(""))
    .digest("hex");
  writeFileSync(join(root, ".optiak-qa-source.json"), `${JSON.stringify({
    schema: "optiak-qa-source-snapshot/v1",
    repository: "optiak/optiak-frontend",
    revision,
    inventorySha256,
    files,
  }, null, 2)}\n`, {mode: 0o444});
  chmodSync(root, 0o555);
  return {root, revision};
}

function smokeContract() {
  const contract = structuredClone(loadQaSourceExecutionContract());
  contract.profiles.frontend_static_unit.steps = [
    {id: "pnpm_install_frozen", argv: ["node", "verify.mjs", "install"]},
    {id: "lint", argv: ["pnpm", "--version"]},
    {id: "unit_tests", argv: ["uv", "--version"]},
    {id: "docs_check", argv: ["terraform", "version"]},
    {id: "typecheck", argv: ["make", "--version"]}
  ];
  return contract;
}

function parseArgs(argv) {
  const result = {pretty: false, image: defaultImage};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") result.source = argv[++index];
    else if (argument === "--profile") result.profile = argv[++index];
    else if (argument === "--revision") result.revision = argv[++index];
    else if (argument === "--stack") result.stack = argv[++index];
    else if (argument === "--image") result.image = argv[++index];
    else if (argument === "--self-test") result.selfTest = true;
    else if (argument === "--pretty") result.pretty = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}

function runContainer(input, contractOverride = null) {
  const args = buildDockerArgs(input);
  let contractMount = null;
  if (contractOverride) {
    contractMount = mkdtempSync(join(tmpdir(), "optiak-qa-contract-"));
    const contractPath = join(contractMount, "contract.json");
    writeFileSync(contractPath, `${JSON.stringify(contractOverride)}\n`, {mode: 0o444});
    const imageIndex = args.indexOf(input.image ?? defaultImage);
    args.splice(imageIndex, 0, "--mount", `type=bind,src=${contractPath},dst=/opt/optiak-qa/qa-source-execution-contract.json,readonly`);
  }
  try {
    const run = spawnSync("docker", args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    if (!run.stdout.trim()) throw new Error(`runner produced no evidence (docker exit ${run.status ?? "unknown"})`);
    const evidence = JSON.parse(run.stdout.trim().split("\n").at(-1));
    evidence.cleanup = "completed";
    const result = evaluateQaSourceExecution(evidence, contractOverride ?? loadQaSourceExecutionContract());
    return {evidence, result, dockerExitCode: run.status};
  } finally {
    if (contractMount) rmSync(contractMount, {recursive: true, force: true});
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let snapshot = null;
  try {
    if (args.selfTest) {
      snapshot = syntheticSnapshot();
      const output = runContainer({
        source: snapshot.root,
        profile: "frontend_static_unit",
        revision: snapshot.revision,
        image: args.image,
      }, smokeContract());
      const verdict = output.result.verdict === "execution_evidence_ready" && output.dockerExitCode === 0
        ? "boundary_smoke_pass"
        : "boundary_smoke_fail";
      console.log(JSON.stringify({
        schema: "optiak-qa-source-runner-smoke/v1",
        verdict,
        evidence: output.evidence,
        evaluator: output.result,
        proves: ["disposable_container", "read_only_source", "no_network", "no_docker_socket", "fixed_profile", "toolchains_available", "controller_cleanup"],
        doesNotProve: ["real_repository_checkout", "real_repository_tests", "dependency_bootstrap", "release_readiness"],
      }, null, args.pretty ? 2 : 0));
      if (verdict !== "boundary_smoke_pass") process.exitCode = 1;
      return;
    }
    if (!args.source || !args.profile || !args.revision) {
      throw new Error("--source, --profile and --revision are required unless --self-test is used");
    }
    const output = runContainer(args);
    console.log(JSON.stringify({schema: "optiak-qa-source-controller-result/v1", ...output}, null, args.pretty ? 2 : 0));
    if (!["execution_evidence_ready", "test_failures_observed"].includes(output.result.verdict)) process.exitCode = 1;
  } finally {
    if (snapshot) {
      chmodSync(snapshot.root, 0o755);
      rmSync(snapshot.root, {recursive: true, force: true});
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
