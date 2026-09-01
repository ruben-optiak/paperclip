import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function json(path) {
  return JSON.parse(readFileSync(join(packageDir, path), "utf8"));
}

test("every skill ships an offline fixture", () => {
  const skills = readdirSync(join(packageDir, "skills"));
  assert.equal(skills.length, 12);
  for (const skill of skills) {
    const fixtures = readdirSync(join(packageDir, "skills", skill, "fixtures"));
    assert.ok(fixtures.length > 0, `${skill} has no fixture`);
    for (const fixture of fixtures.filter((path) => path.endsWith(".json"))) {
      assert.doesNotThrow(() => json(`skills/${skill}/fixtures/${fixture}`));
    }
  }
});

test("change control fails closed by risk", () => {
  const fixture = json("skills/optiak-change-control/fixtures/actions.json");
  assert.deepEqual(fixture.cases.map((item) => item.expectedLevel), ["green", "yellow", "orange", "red"]);
});

test("PR fixture requires independent changes", () => {
  const fixture = json("skills/optiak-pr-review/fixtures/pr.json");
  assert.notEqual(fixture.author, fixture.reviewer);
  assert.equal(fixture.expectedVerdict, "request_changes");
  assert.ok(fixture.headRevision.startsWith("fixture-"));
});

test("incident fixture cannot imply a production incident", () => {
  const fixture = json("skills/optiak-incident-triage/fixtures/alert.json");
  assert.equal(fixture.environment, "staging");
  assert.equal(fixture.productionImpact, false);
  assert.equal(fixture.expectedSeverity, "SEV3");
});

test("disconnected E2E fixture remains blocked", () => {
  const fixture = json("skills/optiak-e2e-validation/fixtures/journey.json");
  assert.equal(fixture.environment, "fixture");
  assert.equal(fixture.expectedResultWithoutConnection, "blocked");
  assert.equal(fixture.mutationLevel, "yellow");
});

test("docs fixture does not invent live authority", () => {
  const fixture = json("skills/optiak-docs-drift/fixtures/claims.json");
  assert.equal(fixture.claims[0].authorityConnected, false);
  assert.equal(fixture.claims[0].expectedClassification, "blocked_on_authority");
});

test("release evidence with missing gates is not ready", () => {
  const fixture = json("skills/optiak-release-readiness/fixtures/release.json");
  assert.equal(fixture.gates.stagingE2E, "missing");
  assert.equal(fixture.expectedVerdict, "not_ready");
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
  assert.match(helper, /paperclip-optiak/);
  assert.match(helper, /docker-paperclip-optiak/);
  assert.match(helper, /OPTIAK_PAPERCLIP_PORT:-3200/);
  assert.doesNotMatch(helper, /enki-hogar|enki-connectors/);
});
