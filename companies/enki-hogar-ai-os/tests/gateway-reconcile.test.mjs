import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {reconcileAgentGateways} from "../scripts/reconcile-agent-gateways.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const desired = JSON.parse(readFileSync(join(packageDir, "policies", "desired-state.yaml"), "utf8"));

function fixtureState() {
  const agents = desired.profiles.map((profile) => ({
    id: `agent-${profile.agentSlug}`,
    slug: profile.agentSlug,
    name: profile.agentName,
    status: "paused",
  }));
  const profiles = desired.profiles.map((profile) => ({
    id: `profile-${profile.agentSlug}`,
    profileKey: profile.profileKey,
    status: "active",
    defaultAction: "deny",
    entries: [],
    bindings: [{targetType: "agent", targetId: `agent-${profile.agentSlug}`}],
  }));
  return {agents, profiles, connections: [], gateways: []};
}

function mockRequest(state, calls) {
  return async (url, options = {}) => {
    calls.push({url, method: options.method, authorization: options.headers?.Authorization});
    const path = new URL(url).pathname;
    let status = 200;
    let payload;
    if (options.method === "POST" && path.endsWith("/tools/gateways")) {
      const body = JSON.parse(options.body);
      const gateway = {id: `gateway-${state.gateways.length + 1}`, status: "active", tokens: [], ...body};
      state.gateways.push(gateway);
      const profile = state.profiles.find((candidate) => candidate.id === gateway.profileId);
      profile.bindings.push({targetType: "gateway", targetId: gateway.id});
      status = 201;
      payload = gateway;
    } else if (options.method === "PATCH" && path.includes("/tool-gateway/gateways/")) {
      const body = JSON.parse(options.body);
      const id = path.split("/").at(-1);
      const gateway = state.gateways.find((candidate) => candidate.id === id);
      Object.assign(gateway, body);
      delete gateway.companyId;
      payload = gateway;
    } else if (path.endsWith("/agents")) payload = state.agents;
    else if (path.endsWith("/tools/profiles")) payload = {profiles: state.profiles};
    else if (path.endsWith("/tools/connections")) payload = {connections: state.connections};
    else if (path.endsWith("/tools/gateways")) payload = {gateways: state.gateways};
    else return {ok: false, status: 404, text: async () => '{"error":"not found"}'};
    return {ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload)};
  };
}

test("gateway audit is GET-only and fails closed when gateways are missing", async () => {
  const state = fixtureState();
  const calls = [];
  const result = await reconcileAgentGateways({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    request: mockRequest(state, calls),
  });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "audit");
  assert.equal(calls.every((call) => call.method === undefined), true);
  assert.equal(calls.every((call) => call.authorization === "Bearer board-fixture-token"), true);
  assert.equal(calls.every((call) => !call.url.includes("board-fixture-token")), true);
});

test("apply creates six agent-scoped gateways and immediately leaves them disabled", async () => {
  const state = fixtureState();
  const calls = [];
  const result = await reconcileAgentGateways({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    applyDisabled: true,
    request: mockRequest(state, calls),
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.mode, "apply-disabled");
  assert.equal(state.gateways.length, 6);
  assert.equal(calls.filter((call) => call.method === "POST").length, 6);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 6);
  for (const gateway of state.gateways) {
    assert.equal(gateway.status, "disabled");
    assert.equal(gateway.defaultProfileMode, "gateway_only");
    assert.equal(gateway.contextScopeType, "agent");
    assert.equal(gateway.contextScopeId, gateway.agentId);
    assert.deepEqual(gateway.tokens, []);
  }
});

test("gateway audit rejects a stale binding from any additional profile", async () => {
  const state = fixtureState();
  const calls = [];
  const request = mockRequest(state, calls);
  const applied = await reconcileAgentGateways({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    applyDisabled: true,
    request,
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.findings));
  for (const gateway of state.gateways) gateway.status = "active";
  state.profiles[1].bindings.push({targetType: "gateway", targetId: state.gateways[0].id});

  const audited = await reconcileAgentGateways({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    request,
  });
  assert.equal(audited.ok, false);
  assert.equal(audited.findings.some((finding) => /exactly one profile binding/.test(finding)), true);
});

test("apply refuses stale extra profile bindings before mutating a gateway", async () => {
  const state = fixtureState();
  const calls = [];
  const request = mockRequest(state, calls);
  await reconcileAgentGateways({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    applyDisabled: true,
    request,
  });
  state.profiles[1].bindings.push({targetType: "gateway", targetId: state.gateways[0].id});
  const mutationCountBefore = calls.filter((call) => call.method === "POST" || call.method === "PATCH").length;

  await assert.rejects(
    reconcileAgentGateways({
      apiUrl: "http://paperclip.test",
      companyId: "company-fixture",
      token: "board-fixture-token",
      applyDisabled: true,
      request,
    }),
    /exactly one binding/,
  );
  const mutationCountAfter = calls.filter((call) => call.method === "POST" || call.method === "PATCH").length;
  assert.equal(mutationCountAfter, mutationCountBefore);
});
