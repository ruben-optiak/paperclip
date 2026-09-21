import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {createHash} from "node:crypto";
import {buildDockerArgs} from "../src/controller.mjs";
import {validateSourceManifest} from "../src/runner.mjs";

function snapshot() {
  const root = mkdtempSync(join(tmpdir(), "optiak-qa-test-"));
  mkdirSync(join(root, "src"));
  const content = Buffer.from("export const ok = true;\n");
  writeFileSync(join(root, "src", "index.mjs"), content);
  const files = [{path: "src/index.mjs", bytes: content.length, sha256: createHash("sha256").update(content).digest("hex")}];
  const inventorySha256 = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(""))
    .digest("hex");
  return {root, manifest: {schema: "optiak-qa-source-snapshot/v1", repository: "optiak/optiak", revision: "1".repeat(40), inventorySha256, files}};
}

test("source manifest binds exact repository, revision and file digests", () => {
  const value = snapshot();
  try {
    assert.match(validateSourceManifest(value.manifest, value.root, {
      repository: "optiak/optiak",
      revision: "1".repeat(40),
    }), /^[0-9a-f]{64}$/);
    assert.throws(() => validateSourceManifest(value.manifest, value.root, {
      repository: "optiak/optiak-frontend",
      revision: "1".repeat(40),
    }), /repository/);
  } finally {
    rmSync(value.root, {recursive: true, force: true});
  }
});

test("container arguments enforce the disposable boundary without a Docker socket", () => {
  const args = buildDockerArgs({
    source: "/tmp/snapshot",
    profile: "frontend_static_unit",
    revision: "2".repeat(40),
  });
  const serialized = JSON.stringify(args);
  assert.ok(args.includes("none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("ALL"));
  assert.ok(args.includes("no-new-privileges"));
  assert.match(serialized, /dst=\/source,readonly/);
  assert.doesNotMatch(serialized, /docker\.sock|DOCKER_HOST|PAPERCLIP|TOKEN|SECRET/);
  assert.equal(args.includes("--privileged"), false);
});

test("controller exposes profile and stack values only as runner arguments", () => {
  const args = buildDockerArgs({
    source: "/tmp/snapshot",
    profile: "iac_static_validate",
    revision: "3".repeat(40),
    stack: "environments/staging",
  });
  assert.deepEqual(args.slice(-8), [
    "--workspace", "/workspace",
    "--profile", "iac_static_validate",
    "--revision", "3".repeat(40),
    "--stack", "environments/staging",
  ]);
});
