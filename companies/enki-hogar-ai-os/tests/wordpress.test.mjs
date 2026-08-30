import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageDir, "skills", "wordpress-publisher", "scripts", "wordpress_publisher.py");
const fixture = join(packageDir, "skills", "wordpress-publisher", "fixtures", "post.md");
const run = (...args) => spawnSync("python3", [script, ...args], {encoding: "utf8"});

test("WordPress fixture renders locally without credentials", () => {
  const rendered = run("render", fixture);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /<h1>Guía de ejemplo<\/h1>/);
});

test("WordPress sync only works in dry-run and stays a draft", () => {
  const dryRun = run("sync", fixture, "--dry-run");
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const payload = JSON.parse(dryRun.stdout);
  assert.equal(payload.status, "draft");
  assert.equal(payload.notice, "BORRADOR — NO PUBLICADO");

  const blocked = run("sync", fixture);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /blocks WordPress writes/);
});
