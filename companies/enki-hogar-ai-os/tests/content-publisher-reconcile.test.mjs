import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {reconcileContentPublisher} from "../scripts/reconcile-content-publisher.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const desired = JSON.parse(readFileSync(join(packageDir, "policies", "desired-state.yaml"), "utf8"));
const publisher = desired.connections.find((connection) => connection.key === "content_publisher");

function fixtureState() {
  return {
    agents: desired.profiles.map((profile) => ({
      id: `agent-${profile.agentSlug}`,
      slug: profile.agentSlug,
      name: profile.agentName,
      status: "paused",
      runtimeConfig: {heartbeat: {enabled: false}},
    })),
    routines: desired.routines.map((routine) => ({
      id: `routine-${routine.key}`,
      title: routine.title,
      status: "paused",
      triggers: routine.triggers.map((trigger) => ({...trigger, enabled: false})),
    })),
    profiles: desired.profiles.map((profile) => ({
      id: `profile-${profile.agentSlug}`,
      profileKey: profile.profileKey,
      entries: [],
    })),
    connections: desired.connections
      .filter((connection) => connection.key !== "content_publisher")
      .map((connection) => ({id: `connection-${connection.key}`, name: connection.name, installs: []})),
    policies: desired.policies
      .filter((policy) => policy.name !== "Enki require Board approval for publishing")
      .map((policy) => ({
        id: `policy-${policy.priority}`,
        name: policy.name,
        policyType: policy.policyType,
        priority: policy.priority,
        enabled: policy.enabled,
        selectors: {riskLevels: policy.requiredRiskLevels},
      })),
    secrets: [{
      id: "publisher-secret-id",
      key: "content_publisher_mcp_token",
      status: "active",
    }],
    catalog: publisher.tools.map((toolName, index) => {
      const isWrite = publisher.writeTools.includes(toolName);
      return {
        id: `publisher-tool-${index}`,
        toolName,
        status: "active",
        isReadOnly: !isWrite,
        isWrite,
        isDestructive: false,
      };
    }),
  };
}

function mockRequest(state, calls) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({path, method: options.method ?? "GET", authorization: options.headers?.Authorization, body});
    let status = 200;
    let payload;
    if (options.method === "POST" && path.endsWith("/tools/connections")) {
      payload = {
        id: "publisher-connection-id",
        installs: [],
        ...body,
      };
      state.connections.push(payload);
      status = 201;
    } else if (options.method === "POST" && path.endsWith("/catalog/refresh")) {
      payload = {catalog: state.catalog, discoveredCount: state.catalog.length, quarantinedCount: 0};
    } else if (options.method === "POST" && path.endsWith("/tools/policies")) {
      payload = {id: "publisher-policy-id", ...body};
      state.policies.push(payload);
      status = 201;
    } else if (options.method === "POST" && path.includes("/tool-profiles/") && path.endsWith("/entries")) {
      const profileId = path.split("/").at(-2);
      const profile = state.profiles.find((candidate) => candidate.id === profileId);
      payload = {id: `profile-entry-${profile.entries.length + 1}`, ...body};
      profile.entries.push(payload);
      status = 201;
    } else if (options.method === "PATCH" && path.endsWith("/tool-connections/publisher-connection-id")) {
      const connection = state.connections.find((candidate) => candidate.id === "publisher-connection-id");
      Object.assign(connection, body);
      payload = connection;
    } else if (options.method === "PATCH" && path.includes("/tool-applications/")) {
      payload = {id: path.split("/").at(-1), ...body};
    } else if (options.method === "POST" && path.endsWith("/health-check")) {
      payload = {connection: state.connections.find((candidate) => candidate.id === "publisher-connection-id")};
    } else if (path.endsWith("/tools/connections")) payload = {connections: state.connections};
    else if (path.endsWith("/tools/profiles")) payload = {profiles: state.profiles};
    else if (path.endsWith("/tools/policies")) payload = {policies: state.policies};
    else if (path.endsWith("/agents")) payload = state.agents;
    else if (path.endsWith("/routines")) payload = state.routines;
    else if (path.endsWith("/secrets")) payload = state.secrets;
    else return {ok: false, status: 404, text: async () => JSON.stringify({error: "not found"})};
    return {ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload)};
  };
}

test("publisher audit is GET-only and reports missing governed setup", async () => {
  const state = fixtureState();
  const calls = [];
  const result = await reconcileContentPublisher({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    request: mockRequest(state, calls),
  });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "audit");
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.equal(calls.every((call) => call.authorization === "Bearer board-fixture-token"), true);
  assert.equal(calls.some((call) => JSON.stringify(call).includes("publisher-secret-value")), false);
});

test("apply verifies the catalog before granting exact profile access and enabling the connection", async () => {
  const state = fixtureState();
  const calls = [];
  const result = await reconcileContentPublisher({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    apply: true,
    request: mockRequest(state, calls),
    runtimeFetcher: async () => ({}),
    runtimeEvaluator: () => ({ok: true, findings: []}),
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.equal(result.summary.catalogTools, 9);
  assert.equal(result.summary.profilesUpdated, 3);
  assert.equal(result.summary.providerWritesEnabled, false);

  const connection = state.connections.find((candidate) => candidate.id === "publisher-connection-id");
  assert.equal(connection.status, "active");
  assert.equal(connection.enabled, true);
  assert.equal(connection.config.quarantineNewEntries, true);
  assert.equal(connection.credentialRefs[0].secretId, "publisher-secret-id");

  const entriesByProfile = Object.fromEntries(state.profiles.map((profile) => [profile.profileKey, profile.entries.length]));
  assert.equal(entriesByProfile["enki.director.read-only"], 6);
  assert.equal(entriesByProfile["enki.growth.read-only"], 9);
  assert.equal(entriesByProfile["enki.technology.diagnostics"], 1);
  assert.equal(entriesByProfile["enki.finance-bi.read-only"], 0);
  assert.equal(entriesByProfile["enki.ecommerce-catalogue.read-only"], 0);
  assert.equal(entriesByProfile["enki.customer-experience.read-only"], 0);

  const connectionCreateIndex = calls.findIndex((call) => call.method === "POST" && call.path.endsWith("/tools/connections"));
  const catalogRefreshIndex = calls.findIndex((call) => call.path.endsWith("/catalog/refresh"));
  const policyCreateIndex = calls.findIndex((call) => call.method === "POST" && call.path.endsWith("/tools/policies"));
  const firstProfileEntryIndex = calls.findIndex((call) => call.method === "POST" && call.path.endsWith("/entries"));
  const connectionEnableIndex = calls.findIndex((call) => call.method === "PATCH" && call.path.includes("/tool-connections/"));
  assert.ok(connectionCreateIndex < catalogRefreshIndex);
  assert.ok(catalogRefreshIndex < policyCreateIndex);
  assert.ok(policyCreateIndex < firstProfileEntryIndex);
  assert.ok(firstProfileEntryIndex < connectionEnableIndex);
});

test("apply fails closed when a discovered write tool is quarantined", async () => {
  const state = fixtureState();
  state.catalog.find((entry) => entry.toolName === "wordpress_upsert_post").status = "quarantined";
  const calls = [];
  await assert.rejects(
    reconcileContentPublisher({
      apiUrl: "http://paperclip.test",
      companyId: "company-fixture",
      token: "board-fixture-token",
      apply: true,
      request: mockRequest(state, calls),
      runtimeFetcher: async () => ({}),
      runtimeEvaluator: () => ({ok: true, findings: []}),
    }),
    /unexpected status or risk classification/,
  );
  assert.equal(calls.some((call) => call.method === "POST" && call.path.endsWith("/tools/policies")), false);
  assert.equal(calls.some((call) => call.method === "PATCH" && call.path.includes("/tool-connections/")), false);
});

test("apply safely reuses the application left by an archived bootstrap connection", async () => {
  const state = fixtureState();
  state.connections.push({
    id: "archived-publisher-connection",
    applicationId: "publisher-application-id",
    name: publisher.name,
    status: "archived",
    enabled: false,
    installs: [],
  });
  const calls = [];
  const result = await reconcileContentPublisher({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    apply: true,
    request: mockRequest(state, calls),
    runtimeFetcher: async () => ({}),
    runtimeEvaluator: () => ({ok: true, findings: []}),
  });
  assert.equal(result.ok, true);
  const create = calls.find((call) => call.method === "POST" && call.path.endsWith("/tools/connections"));
  assert.equal(create.body.applicationId, "publisher-application-id");
  assert.equal(Object.hasOwn(create.body, "applicationName"), false);
  assert.equal(calls.some((call) => call.method === "PATCH" && call.path.endsWith("/tool-applications/publisher-application-id")), true);
});
