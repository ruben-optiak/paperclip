#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {evaluateRuntimeDrift, fetchRuntimeState} from "./check-runtime-drift.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desiredPath = join(packageDir, "policies", "desired-state.yaml");
const publisherSecretKey = "content_publisher_mcp_token";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sorted(values) {
  return [...new Set(array(values).filter((value) => typeof value === "string"))].sort();
}

function sameStrings(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function readDesiredState() {
  return JSON.parse(readFileSync(desiredPath, "utf8"));
}

function endpointOf(connection) {
  const config = object(connection.transportConfig);
  return [config.url, config.endpoint, config.remoteUrl].find((value) => typeof value === "string") ?? null;
}

function connectionConfigEndpoint(connection) {
  const config = object(connection.config);
  return [config.url, config.endpoint, config.remoteUrl].find((value) => typeof value === "string") ?? null;
}

function agentMatches(agent, expected) {
  const metadata = object(agent.metadata);
  return agent.slug === expected.agentSlug
    || metadata.portableSlug === expected.agentSlug
    || metadata.agentSlug === expected.agentSlug
    || agent.name === expected.agentName;
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
    const message = payload?.error ?? payload?.message ?? "unknown error";
    throw new Error(`${label} failed with HTTP ${response.status}: ${message}`);
  }
  return payload;
}

function createApi({apiUrl, token, request}) {
  const base = apiUrl.replace(/\/+$/, "");
  const headers = {Authorization: `Bearer ${token}`, Accept: "application/json"};
  return async (path, options = {}) => responseJson(await request(`${base}${path}`, {
    method: options.method,
    headers: options.body === undefined ? headers : {...headers, "Content-Type": "application/json"},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), `${options.method ?? "GET"} ${path}`);
}

function desiredPublisher(desired) {
  const connection = array(desired.connections).find((entry) => entry.key === "content_publisher");
  if (!connection) throw new Error("Desired state is missing connections.content_publisher");
  const approval = array(desired.policies).find((entry) => entry.name === "Enki require Board approval for publishing");
  if (!approval) throw new Error("Desired state is missing the publishing approval policy");
  return {connection, approval};
}

function assertPausedPreconditions(desired, {agents, routines}) {
  for (const expected of array(desired.profiles)) {
    const matches = agents.filter((agent) => agentMatches(agent, expected));
    if (matches.length !== 1) throw new Error(`Expected exactly one paused agent for ${expected.agentSlug}`);
    const agent = matches[0];
    if (agent.status !== "paused") throw new Error(`Agent ${expected.agentSlug} must be paused before publishing setup`);
    if (object(object(agent.runtimeConfig).heartbeat).enabled !== false) {
      throw new Error(`Agent ${expected.agentSlug} heartbeat must be disabled before publishing setup`);
    }
  }
  for (const routine of routines) {
    if (routine.status !== "paused" || array(routine.triggers).some((trigger) => trigger.enabled === true)) {
      throw new Error(`Routine ${routine.title ?? routine.id} must be paused with all triggers disabled`);
    }
  }
}

function assertConnectionShape(connection, expected, secretId, {allowDraft = false} = {}) {
  if (connection.transport !== expected.transport || connection.authKind !== expected.authKind) {
    throw new Error(`${expected.name} has an unexpected transport or authentication kind`);
  }
  if (endpointOf(connection) !== expected.endpoint || connectionConfigEndpoint(connection) !== expected.endpoint) {
    throw new Error(`${expected.name} points at an unexpected endpoint`);
  }
  const refs = [...array(connection.credentialRefs), ...array(connection.credentialSecretRefs)];
  const exactRefs = refs.filter((ref) => ref.secretId === secretId
    && ref.placement === expected.requiredCredential.placement
    && (ref.key === expected.requiredCredential.key || ref.configPath === expected.requiredCredential.key)
    && ref.prefix === expected.requiredCredential.prefix);
  if (refs.length !== 1 || exactRefs.length !== 1) throw new Error(`${expected.name} does not have its exact secret-backed bearer binding`);
  if (array(connection.installs).length > 0) throw new Error(`${expected.name} must not have direct runtime installs`);
  if (!allowDraft && (connection.status !== expected.status || connection.enabled !== expected.enabled)) {
    throw new Error(`${expected.name} is not active and enabled`);
  }
}

function assertCatalog(catalog, expected) {
  const expectedNames = sorted(expected.tools);
  const actualNames = sorted(catalog.map((entry) => entry.toolName ?? entry.name));
  if (!sameStrings(actualNames, expectedNames)) {
    throw new Error(`Publisher catalog mismatch; expected ${expectedNames.join(", ")}, received ${actualNames.join(", ")}`);
  }
  const writeTools = new Set(array(expected.writeTools));
  const destructiveTools = new Set(array(expected.destructiveTools));
  for (const entry of catalog) {
    const name = entry.toolName ?? entry.name;
    const isWrite = writeTools.has(name);
    const isDestructive = destructiveTools.has(name);
    if (
      entry.status !== "active"
      || entry.isReadOnly !== !isWrite
      || entry.isWrite !== isWrite
      || entry.isDestructive !== isDestructive
    ) {
      throw new Error(`Publisher tool ${name} has an unexpected status or risk classification`);
    }
  }
}

function assertPolicy(policy, expected) {
  if (
    policy.policyType !== expected.policyType
    || policy.priority !== expected.priority
    || policy.enabled !== expected.enabled
    || !sameStrings(object(policy.selectors).toolNames, expected.requiredToolNames)
  ) {
    throw new Error(`${expected.name} does not match the versioned approval policy`);
  }
}

async function fetchSetupState(api, companyPath) {
  const [connectionsPayload, profilesPayload, policiesPayload, agentsPayload, routinesPayload, secretsPayload] = await Promise.all([
    api(`${companyPath}/tools/connections`),
    api(`${companyPath}/tools/profiles`),
    api(`${companyPath}/tools/policies`),
    api(`${companyPath}/agents`),
    api(`${companyPath}/routines`),
    api(`${companyPath}/secrets`),
  ]);
  return {
    connections: array(connectionsPayload.connections ?? connectionsPayload),
    profiles: array(profilesPayload.profiles ?? profilesPayload),
    policies: array(policiesPayload.policies ?? policiesPayload),
    agents: array(agentsPayload.agents ?? agentsPayload),
    routines: array(routinesPayload.routines ?? routinesPayload),
    secrets: array(secretsPayload.secrets ?? secretsPayload),
  };
}

export async function reconcileContentPublisher({
  apiUrl,
  companyId,
  token,
  apply = false,
  request = fetch,
  runtimeFetcher = fetchRuntimeState,
  runtimeEvaluator = evaluateRuntimeDrift,
}) {
  const desired = readDesiredState();
  const expected = desiredPublisher(desired);
  const api = createApi({apiUrl, token, request});
  const companyPath = `/api/companies/${encodeURIComponent(companyId)}`;
  let state = await fetchSetupState(api, companyPath);
  assertPausedPreconditions(desired, state);

  const secrets = state.secrets.filter((secret) => secret.key === publisherSecretKey && secret.status === "active");
  if (secrets.length !== 1) throw new Error(`Expected exactly one active ${publisherSecretKey} secret`);
  const secret = secrets[0];
  const connectionMatches = state.connections.filter((connection) => connection.name === expected.connection.name && connection.status !== "archived");
  if (connectionMatches.length > 1) throw new Error(`Duplicate connection name: ${expected.connection.name}`);
  const policyMatches = state.policies.filter((policy) => policy.name === expected.approval.name);
  if (policyMatches.length > 1) throw new Error(`Duplicate policy name: ${expected.approval.name}`);
  for (const profile of desired.profiles) {
    if (state.profiles.filter((candidate) => candidate.profileKey === profile.profileKey).length !== 1) {
      throw new Error(`Expected exactly one profile ${profile.profileKey}`);
    }
  }

  if (!apply) {
    return {
      ok: connectionMatches.length === 1 && policyMatches.length === 1,
      mode: "audit",
      summary: {
        connectionPresent: connectionMatches.length === 1,
        approvalPolicyPresent: policyMatches.length === 1,
        publisherSecretPresent: true,
        agentsPaused: true,
        routinesPaused: true,
      },
    };
  }

  let connection = connectionMatches[0] ?? null;
  if (!connection) {
    const bootstrapConfig = {url: expected.connection.endpoint, quarantineNewEntries: false};
    const archivedConnection = state.connections.find((candidate) => candidate.name === expected.connection.name && candidate.status === "archived");
    connection = await api(`${companyPath}/tools/connections`, {
      method: "POST",
      body: {
        ...(archivedConnection?.applicationId
          ? {applicationId: archivedConnection.applicationId}
          : {applicationName: expected.connection.name}),
        name: expected.connection.name,
        transport: expected.connection.transport,
        authKind: expected.connection.authKind,
        ownership: "customer",
        status: "draft",
        connectionKind: "managed",
        config: bootstrapConfig,
        transportConfig: bootstrapConfig,
        credentialRefs: [{
          name: "authorization",
          secretId: secret.id,
          version: "latest",
          placement: expected.connection.requiredCredential.placement,
          key: expected.connection.requiredCredential.key,
          prefix: expected.connection.requiredCredential.prefix,
        }],
        enabled: false,
      },
    });
    if (archivedConnection?.applicationId) {
      await api(`/api/tool-applications/${encodeURIComponent(archivedConnection.applicationId)}`, {
        method: "PATCH",
        body: {status: "active"},
      });
    }
  }
  assertConnectionShape(connection, expected.connection, secret.id, {allowDraft: true});

  const refresh = await api(`/api/tool-connections/${encodeURIComponent(connection.id)}/catalog/refresh`, {method: "POST"});
  const catalog = array(refresh.catalog);
  assertCatalog(catalog, expected.connection);

  let policy = policyMatches[0] ?? null;
  if (!policy) {
    policy = await api(`${companyPath}/tools/policies`, {
      method: "POST",
      body: {
        name: expected.approval.name,
        description: "Toda publicación externa requiere aprobación explícita del Board.",
        policyType: expected.approval.policyType,
        priority: expected.approval.priority,
        enabled: expected.approval.enabled,
        selectors: {toolNames: expected.approval.requiredToolNames},
      },
    });
  }
  assertPolicy(policy, expected.approval);

  const catalogByName = new Map(catalog.map((entry) => [entry.toolName ?? entry.name, entry]));
  const publisherCatalogIds = new Set(catalog.map((entry) => entry.id));
  for (const desiredProfile of desired.profiles) {
    const profile = state.profiles.find((candidate) => candidate.profileKey === desiredProfile.profileKey);
    const wantedNames = sorted(array(desiredProfile.allowedTools).filter((name) => catalogByName.has(name)));
    const wantedIds = new Set(wantedNames.map((name) => catalogByName.get(name).id));
    const currentPublisherEntries = array(profile.entries).filter((entry) => publisherCatalogIds.has(entry.catalogEntryId));
    const extraEntries = currentPublisherEntries.filter((entry) => !wantedIds.has(entry.catalogEntryId));
    if (extraEntries.length > 0) throw new Error(`${desiredProfile.profileKey} has unexpected publisher permissions; refusing to delete them automatically`);
    const currentIds = new Set(currentPublisherEntries.map((entry) => entry.catalogEntryId));
    for (const catalogEntryId of wantedIds) {
      if (currentIds.has(catalogEntryId)) continue;
      await api(`/api/tool-profiles/${encodeURIComponent(profile.id)}/entries`, {
        method: "POST",
        body: {selectorType: "catalog_entry", effect: "include", catalogEntryId},
      });
    }
  }

  const finalConfig = {url: expected.connection.endpoint, quarantineNewEntries: true};
  connection = await api(`/api/tool-connections/${encodeURIComponent(connection.id)}`, {
    method: "PATCH",
    body: {
      status: expected.connection.status,
      enabled: expected.connection.enabled,
      config: finalConfig,
      transportConfig: finalConfig,
    },
  });
  await api(`/api/tool-connections/${encodeURIComponent(connection.id)}/health-check`, {method: "POST"});

  const runtime = await runtimeFetcher({apiUrl, companyId, token, request});
  const drift = runtimeEvaluator(desired, runtime);
  return {
    ok: drift.ok,
    mode: "apply",
    summary: {
      connectionId: connection.id,
      catalogTools: catalog.length,
      profilesUpdated: desired.profiles.filter((profile) => profile.allowedTools.some((name) => catalogByName.has(name))).length,
      approvalPolicy: expected.approval.name,
      providerWritesEnabled: false,
      driftCount: drift.findings.length,
    },
    findings: drift.findings,
  };
}

function parseArgs(argv) {
  const values = new Set(argv);
  for (const value of values) {
    if (!["--apply", "--json", "--help"].includes(value)) throw new Error(`Unknown argument: ${value}`);
  }
  return {apply: values.has("--apply"), json: values.has("--json"), help: values.has("--help")};
}

function usage() {
  return [
    "Usage: reconcile-content-publisher.mjs [--apply] [--json]",
    "",
    "Default mode is GET-only. Apply mode requires all agents and routines to be paused.",
    "Apply creates the disabled connection, verifies its exact catalog, creates the Board approval policy,",
    "adds only the versioned catalog entries to existing profiles, then enables the connection.",
    "The provider write kill switch remains disabled outside Paperclip.",
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
    const result = await reconcileContentPublisher({
      apiUrl: process.env.PAPERCLIP_API_URL || "http://localhost:3100",
      companyId: process.env.PAPERCLIP_COMPANY_ID || (() => { throw new Error("PAPERCLIP_COMPANY_ID is required"); })(),
      token: process.env.PAPERCLIP_BOARD_TOKEN || (() => { throw new Error("PAPERCLIP_BOARD_TOKEN is required"); })(),
      apply: args.apply,
    });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok) console.log(`ENKI CONTENT PUBLISHER: PASS (${result.mode})`);
    else {
      console.error(`ENKI CONTENT PUBLISHER: FAIL (${result.findings?.length ?? 0} drift findings)`);
      for (const finding of result.findings ?? []) console.error(`- [${finding.code}] ${finding.message}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Content publisher reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
