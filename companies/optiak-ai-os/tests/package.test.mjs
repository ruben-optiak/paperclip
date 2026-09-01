import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(skill, name) {
  const path = join(packageDir, "skills", skill, "references", "fixtures", `${name}.md`);
  const markdown = readFileSync(path, "utf8");
  const fencedJson = markdown.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(fencedJson, `${skill}/${name}.md has no fenced JSON object`);
  return JSON.parse(fencedJson[1]);
}

test("every skill ships a CLI-portable offline fixture", () => {
  const skills = readdirSync(join(packageDir, "skills"));
  assert.equal(skills.length, 12);
  for (const skill of skills) {
    const fixtures = readdirSync(join(packageDir, "skills", skill, "references", "fixtures"))
      .filter((path) => path.endsWith(".md"));
    assert.ok(fixtures.length > 0, `${skill} has no fixture`);
    for (const path of fixtures) {
      const name = path.slice(0, -3);
      assert.doesNotThrow(() => fixture(skill, name));
    }
  }
});

test("change control fails closed by risk", () => {
  const data = fixture("optiak-change-control", "actions");
  assert.deepEqual(data.cases.map((item) => item.expectedLevel), ["green", "yellow", "orange", "red"]);
});

test("PR fixture requires independent changes", () => {
  const data = fixture("optiak-pr-review", "pr");
  assert.notEqual(data.author, data.reviewer);
  assert.equal(data.expectedVerdict, "request_changes");
  assert.ok(data.headRevision.startsWith("fixture-"));
});

test("incident fixture cannot imply a production incident", () => {
  const data = fixture("optiak-incident-triage", "alert");
  assert.equal(data.environment, "staging");
  assert.equal(data.productionImpact, false);
  assert.equal(data.expectedSeverity, "SEV3");
});

test("disconnected E2E fixture remains blocked", () => {
  const data = fixture("optiak-e2e-validation", "journey");
  assert.equal(data.environment, "fixture");
  assert.equal(data.expectedResultWithoutConnection, "blocked");
  assert.equal(data.mutationLevel, "yellow");
});

test("docs fixture does not invent live authority", () => {
  const data = fixture("optiak-docs-drift", "claims");
  assert.equal(data.claims[0].authorityConnected, false);
  assert.equal(data.claims[0].expectedClassification, "blocked_on_authority");
});

test("release evidence with missing gates is not ready", () => {
  const data = fixture("optiak-release-readiness", "release");
  assert.equal(data.gates.stagingE2E, "missing");
  assert.equal(data.expectedVerdict, "not_ready");
});

test("source map keeps future authorities disconnected", () => {
  const sourceMap = readFileSync(join(packageDir, "references", "source-map.yaml"), "utf8");
  assert.equal((sourceMap.match(/status: disconnected/g) || []).length, 7);
  assert.match(sourceMap, /wholeSiteSnapshotsAllowed: false/);
});

test("runtime defaults to paused, sandboxed, managed MCP", () => {
  const paperclip = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
  assert.equal((paperclip.match(/type: codex_local/g) || []).length, 10);
  assert.equal((paperclip.match(/dangerouslyBypassApprovalsAndSandbox: false/g) || []).length, 10);
  assert.equal((paperclip.match(/managedMcpOnly: true/g) || []).length, 10);
  assert.equal((paperclip.match(/enabled: false/g) || []).length, 14);
});

test("local instance remains isolated behind host port 3200", () => {
  const override = readFileSync(join(packageDir, "runtime", "docker-compose.paperclip.yml"), "utf8");
  const helper = readFileSync(join(packageDir, "scripts", "local-instance.sh"), "utf8");

  assert.match(override, /PAPERCLIP_AUTH_BASE_URL_MODE:\s*"auto"/);
  assert.match(override, /BETTER_AUTH_TRUSTED_ORIGINS/);
  assert.match(override, /PAPERCLIP_INSTANCE_ID/);
  assert.match(override, /PAPERCLIP_API_URL:\s*"http:\/\/localhost:3100"/);
  assert.doesNotMatch(override, /PAPERCLIP_API_URL:\s*"http:\/\/localhost:3200"/);
  assert.match(override, /optiak/);
  assert.match(helper, /paperclip-optiak/);
  assert.match(helper, /docker-paperclip-optiak/);
  assert.match(helper, /OPTIAK_PAPERCLIP_PORT:-3200/);
  assert.doesNotMatch(helper, /enki-hogar|enki-connectors/);
});
