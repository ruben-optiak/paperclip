#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desiredPath = join(packageDir, "policies", "desired-state.yaml");

function readDesiredState() {
  return JSON.parse(readFileSync(desiredPath, "utf8"));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function agentMatches(agent, expected) {
  const metadata = object(agent.metadata);
  return agent.slug === expected.agentSlug
    || metadata.portableSlug === expected.agentSlug
    || metadata.agentSlug === expected.agentSlug
    || agent.name === expected.agentName;
}

function expectedGatewayAgent(desired, expected) {
  const profile = array(desired.profiles).find((candidate) => candidate.profileKey === expected.profileKey);
  return {...expected, agentName: profile?.agentName};
}

function gatewaySlug(gateway) {
  return gateway.slug ?? gateway.displaySlug ?? null;
}

function gatewayPayload(expected, agent, profile) {
  return {
    name: expected.name,
    slug: expected.slug,
    description: `Gateway gobernado y restringido al perfil ${expected.profileKey}.`,
    profileId: profile.id,
    defaultProfileMode: "gateway_only",
    contextScopeType: "agent",
    contextScopeId: agent.id,
    agentId: agent.id,
    metadata: {
      managedBy: "enki-hogar-ai-os",
      desiredStateVersion: "0.1.0",
      agentSlug: expected.agentSlug,
    },
  };
}

function activeGatewayClientTokens(gateway) {
  return array(gateway.tokens).filter((token) => token.subjectType === "gateway_client" && !token.revokedAt);
}

function gatewayProfileBindings(profiles, gatewayId) {
  return profiles.flatMap((profile) => array(profile.bindings)
    .filter((binding) => binding.targetType === "gateway" && binding.targetId === gatewayId)
    .map(() => ({profileId: profile.id, profileKey: profile.profileKey ?? profile.id})));
}

function inspectState({desired, agents, profiles, connections, gateways, expectedStatus}) {
  const findings = [];
  const expectedSlugs = new Set(array(desired.gateways).map((gateway) => gateway.slug));
  const profilesByKey = new Map(profiles.map((profile) => [profile.profileKey, profile]));

  for (const connection of connections) {
    if (array(connection.installs).length > 0) {
      findings.push(`Connection ${connection.name} has runtime installs; Enki requires named gateways and zero installs`);
    }
  }

  for (const rawExpected of array(desired.gateways)) {
    const expected = expectedGatewayAgent(desired, rawExpected);
    const matchingGateways = gateways.filter((gateway) => gatewaySlug(gateway) === expected.slug);
    if (matchingGateways.length !== 1) {
      findings.push(`Gateway ${expected.slug} count is ${matchingGateways.length}, expected 1`);
      continue;
    }
    const gateway = matchingGateways[0];
    const profile = profilesByKey.get(expected.profileKey);
    const agent = agents.find((candidate) => agentMatches(candidate, expected));
    if (!profile) findings.push(`Missing profile ${expected.profileKey}`);
    if (!agent) findings.push(`Missing agent ${expected.agentSlug}`);
    if (!profile || !agent) continue;
    if (gateway.name !== expected.name) findings.push(`Gateway ${expected.slug} has an unexpected name`);
    if (gateway.status !== expectedStatus) findings.push(`Gateway ${expected.slug} status is ${gateway.status}, expected ${expectedStatus}`);
    if (gateway.profileId !== profile.id) findings.push(`Gateway ${expected.slug} points at the wrong profile`);
    if (gateway.agentId !== agent.id) findings.push(`Gateway ${expected.slug} points at the wrong agent`);
    if (gateway.contextScopeType !== "agent" || gateway.contextScopeId !== agent.id) {
      findings.push(`Gateway ${expected.slug} is not scoped to its exact agent`);
    }
    if (gateway.defaultProfileMode !== "gateway_only") findings.push(`Gateway ${expected.slug} is not gateway_only`);
    const gatewayBindings = gatewayProfileBindings(profiles, gateway.id);
    if (gatewayBindings.length !== 1 || gatewayBindings[0].profileId !== profile.id) {
      findings.push(`Gateway ${expected.slug} must have exactly one profile binding to ${expected.profileKey}`);
    }
    if (activeGatewayClientTokens(gateway).length > 0) findings.push(`Gateway ${expected.slug} has a persistent gateway_client token`);
  }

  for (const gateway of gateways) {
    if (!expectedSlugs.has(gatewaySlug(gateway))) findings.push(`Unexpected gateway ${gatewaySlug(gateway) ?? gateway.id}`);
  }
  return findings;
}

async function responseJson(response, label) {
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${payload?.error ?? payload?.message ?? "unknown error"}`);
  }
  return payload;
}

function createApi({apiUrl, token, request = fetch}) {
  const base = apiUrl.replace(/\/+$/, "");
  const headers = {Authorization: `Bearer ${token}`, Accept: "application/json"};
  return async (path, options = {}) => responseJson(await request(`${base}${path}`, {
    method: options.method,
    headers: options.body === undefined ? headers : {...headers, "Content-Type": "application/json"},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), `${options.method ?? "GET"} ${path}`);
}

export async function reconcileAgentGateways({apiUrl, companyId, token, applyDisabled = false, request = fetch}) {
  const desired = readDesiredState();
  const api = createApi({apiUrl, token, request});
  const companyPath = `/api/companies/${encodeURIComponent(companyId)}`;

  const fetchState = async () => {
    const [agentPayload, profilePayload, connectionPayload, gatewayPayloadResult] = await Promise.all([
      api(`${companyPath}/agents`),
      api(`${companyPath}/tools/profiles`),
      api(`${companyPath}/tools/connections`),
      api(`${companyPath}/tools/gateways`),
    ]);
    return {
      agents: array(agentPayload.agents ?? agentPayload),
      profiles: array(profilePayload.profiles ?? profilePayload),
      connections: array(connectionPayload.connections ?? connectionPayload),
      gateways: array(gatewayPayloadResult.gateways ?? gatewayPayloadResult),
    };
  };

  let state = await fetchState();
  if (!applyDisabled) {
    const findings = inspectState({...state, desired, expectedStatus: "active"});
    return {ok: findings.length === 0, mode: "audit", findings, summary: {expectedGateways: array(desired.gateways).length}};
  }

  const unexpectedGateways = state.gateways.filter((gateway) =>
    !array(desired.gateways).some((expected) => expected.slug === gatewaySlug(gateway))
  );
  if (unexpectedGateways.length > 0) throw new Error("Refusing to apply while unexpected gateways exist");
  if (state.connections.some((connection) => connection.enabled === true || connection.status === "active")) {
    throw new Error("Refusing to mutate gateways while any connection is active or enabled");
  }
  if (state.connections.some((connection) => array(connection.installs).length > 0)) {
    throw new Error("Refusing to apply while any connection has runtime installs");
  }

  const profilesByKey = new Map(state.profiles.map((profile) => [profile.profileKey, profile]));
  for (const rawExpected of array(desired.gateways)) {
    const expected = expectedGatewayAgent(desired, rawExpected);
    const gateway = state.gateways.find((candidate) => gatewaySlug(candidate) === expected.slug);
    if (!gateway) continue;
    const profile = profilesByKey.get(expected.profileKey);
    const bindings = gatewayProfileBindings(state.profiles, gateway.id);
    if (!profile || bindings.length !== 1 || bindings[0].profileId !== profile.id) {
      throw new Error(`Refusing to reconcile gateway ${expected.slug} without exactly one binding to ${expected.profileKey}`);
    }
  }
  for (const rawExpected of array(desired.gateways)) {
    const expected = expectedGatewayAgent(desired, rawExpected);
    const agent = state.agents.find((candidate) => agentMatches(candidate, expected));
    const profile = profilesByKey.get(expected.profileKey);
    if (!agent || agent.status !== "paused") throw new Error(`Agent ${expected.agentSlug} must exist and be paused`);
    if (!profile || profile.status !== "active" || profile.defaultAction !== "deny") {
      throw new Error(`Profile ${expected.profileKey} must exist, be active, and default deny`);
    }
    if (array(profile.entries).some((entry) => entry.effect !== "include" || entry.selectorType !== "catalog_entry")) {
      throw new Error(`Profile ${expected.profileKey} contains a non-catalog or non-include entry`);
    }
    if (!array(profile.bindings).some((binding) => binding.targetType === "agent" && binding.targetId === agent.id)) {
      throw new Error(`Profile ${expected.profileKey} is not bound to ${expected.agentSlug}`);
    }
    const matches = state.gateways.filter((gateway) => gatewaySlug(gateway) === expected.slug);
    if (matches.length > 1) throw new Error(`Duplicate gateway slug: ${expected.slug}`);
    let gateway = matches[0] ?? null;
    const payload = gatewayPayload(expected, agent, profile);
    if (!gateway) {
      gateway = await api(`${companyPath}/tools/gateways`, {method: "POST", body: payload});
    } else if (gateway.profileId !== profile.id || gateway.agentId !== agent.id) {
      throw new Error(`Refusing to retarget existing gateway ${expected.slug}`);
    }
    await api(`/api/tool-gateway/gateways/${encodeURIComponent(gateway.id)}`, {
      method: "PATCH",
      body: {...payload, companyId, status: "disabled"},
    });
  }

  state = await fetchState();
  const findings = inspectState({...state, desired, expectedStatus: "disabled"});
  return {
    ok: findings.length === 0,
    mode: "apply-disabled",
    findings,
    summary: {
      expectedGateways: array(desired.gateways).length,
      configuredGateways: state.gateways.length,
      activeGatewayClientTokens: state.gateways.reduce((count, gateway) => count + activeGatewayClientTokens(gateway).length, 0),
    },
  };
}

function parseArgs(argv) {
  const values = new Set(argv);
  for (const value of values) {
    if (!["--apply-disabled", "--json", "--help"].includes(value)) throw new Error(`Unknown argument: ${value}`);
  }
  return {applyDisabled: values.has("--apply-disabled"), json: values.has("--json"), help: values.has("--help")};
}

function usage() {
  return [
    "Usage: reconcile-agent-gateways.mjs [--apply-disabled] [--json]",
    "",
    "Default mode is GET-only audit against the final active desired state.",
    "--apply-disabled creates or reconciles the six gateways, then leaves every gateway disabled.",
    "Apply mode refuses active connections, active agents, runtime installs, and unexpected gateways.",
    "Requires PAPERCLIP_COMPANY_ID and PAPERCLIP_BOARD_TOKEN.",
  ].join("\n");
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const result = await reconcileAgentGateways({
      apiUrl: process.env.PAPERCLIP_API_URL || "http://localhost:3100",
      companyId: process.env.PAPERCLIP_COMPANY_ID || (() => { throw new Error("PAPERCLIP_COMPANY_ID is required"); })(),
      token: process.env.PAPERCLIP_BOARD_TOKEN || (() => { throw new Error("PAPERCLIP_BOARD_TOKEN is required"); })(),
      applyDisabled: args.applyDisabled,
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok) console.log(`ENKI AGENT GATEWAYS: PASS (${result.summary.expectedGateways} gateways, ${result.mode})`);
    else {
      console.error(`ENKI AGENT GATEWAYS: FAIL (${result.findings.length} findings)`);
      for (const finding of result.findings) console.error(`- ${finding}`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Gateway reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
