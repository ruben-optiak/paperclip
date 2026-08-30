#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDesiredPath = join(packageDir, "policies", "desired-state.yaml");

function readJsonYaml(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse JSON-compatible YAML at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sortedUnique(values) {
  return [...new Set(array(values).filter((value) => typeof value === "string"))].sort();
}

function sameStrings(actual, expected) {
  return JSON.stringify(sortedUnique(actual)) === JSON.stringify(sortedUnique(expected));
}

function endpointOf(connection) {
  const config = object(connection.transportConfig);
  return [config.url, config.endpoint, config.remoteUrl].find((value) => typeof value === "string") ?? null;
}

function plainEnvValue(value) {
  if (typeof value === "string") return value;
  const binding = object(value);
  return binding.type === "plain" && typeof binding.value === "string" ? binding.value : null;
}

function hasConfigArg(extraArgs, expected) {
  const args = array(extraArgs);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === expected) return true;
    if (args[index] === "-c" && args[index + 1] === expected) return true;
  }
  return false;
}

function runtimeShape(agent) {
  const adapterConfig = object(agent.adapterConfig);
  const runtimeConfig = object(agent.runtimeConfig);
  const heartbeat = object(runtimeConfig.heartbeat);
  const env = object(adapterConfig.env);
  return {adapterConfig, runtimeConfig, heartbeat, env};
}

function agentMatches(agent, expected) {
  const metadata = object(agent.metadata);
  return agent.slug === expected.agentSlug
    || metadata.portableSlug === expected.agentSlug
    || metadata.agentSlug === expected.agentSlug
    || agent.name === expected.agentName;
}

function routineMatches(routine, expected) {
  const metadata = object(routine.metadata);
  return routine.slug === expected.key
    || routine.originId === expected.key
    || metadata.portableSlug === expected.key
    || routine.title === expected.title;
}

function finding(code, path, expected, actual, message) {
  return {code, path, expected, actual, message};
}

export function evaluateRuntimeDrift(desired, runtime) {
  const findings = [];
  const connections = array(runtime.connections);
  const profiles = array(runtime.profiles);
  const policies = array(runtime.policies);
  const gateways = array(runtime.gateways);
  const agents = array(runtime.agents);
  const routines = array(runtime.routines);
  const company = object(runtime.company);
  const catalogs = object(runtime.catalogs);
  const installs = object(runtime.installs);
  const effectiveProfiles = object(runtime.effectiveProfiles);
  const expectedConnectionNames = new Set(array(desired.connections).map((entry) => entry.name));
  const desiredRuntime = object(desired.agentRuntime);

  for (const expected of array(desired.connections)) {
    const connection = connections.find((entry) => entry.name === expected.name);
    const basePath = `connections.${expected.key}`;
    if (!connection) {
      findings.push(finding("connection_missing", basePath, expected.name, null, `Missing connection: ${expected.name}`));
      continue;
    }
    for (const key of ["transport", "authKind", "status", "enabled", "healthStatus"]) {
      if (connection[key] !== expected[key]) {
        findings.push(finding("connection_setting_drift", `${basePath}.${key}`, expected[key], connection[key] ?? null, `${expected.name} has unexpected ${key}`));
      }
    }
    if (expected.endpoint && endpointOf(connection) !== expected.endpoint) {
      findings.push(finding("connection_endpoint_drift", `${basePath}.endpoint`, expected.endpoint, endpointOf(connection), `${expected.name} points at an unexpected endpoint`));
    }
    if (expected.requiredCredential) {
      const refs = [...array(connection.credentialRefs), ...array(connection.credentialSecretRefs)];
      const hasRequiredCredential = refs.some((ref) => {
        const required = expected.requiredCredential;
        return ref.placement === required.placement
          && (ref.key === required.key || ref.configPath === required.key)
          && (required.prefix === undefined || ref.prefix === required.prefix);
      });
      if (!hasRequiredCredential) {
        findings.push(finding("connection_credential_binding_missing", `${basePath}.credential`, "required secret-backed header binding", "missing_or_different", `${expected.name} lacks its required credential binding`));
      }
    }

    const catalog = array(catalogs[connection.id]);
    const expectedTools = sortedUnique(expected.tools);
    const catalogByName = new Map(catalog.map((entry) => [entry.toolName ?? entry.name, entry]));
    for (const toolName of expectedTools) {
      const entry = catalogByName.get(toolName);
      if (!entry) {
        findings.push(finding("catalog_tool_missing", `${basePath}.catalog.${toolName}`, "active read-only tool", null, `${expected.name} is missing ${toolName}`));
        continue;
      }
      if (entry.status !== "active" || entry.isReadOnly !== true || entry.isWrite === true || entry.isDestructive === true) {
        findings.push(finding(
          "catalog_tool_not_read_only",
          `${basePath}.catalog.${toolName}`,
          {status: "active", isReadOnly: true, isWrite: false, isDestructive: false},
          {status: entry.status ?? null, isReadOnly: entry.isReadOnly ?? null, isWrite: entry.isWrite ?? null, isDestructive: entry.isDestructive ?? null},
          `${toolName} is not an active read-only catalog entry`,
        ));
      }
    }
    if (expected.strictCatalog === true) {
      for (const entry of catalog) {
        const toolName = entry.toolName ?? entry.name;
        if (typeof toolName === "string" && !expectedTools.includes(toolName) && entry.status === "active") {
          findings.push(finding("unexpected_active_tool", `${basePath}.catalog.${toolName}`, "quarantined, disabled, removed, or absent", "active", `${expected.name} exposes unexpected active tool ${toolName}`));
        }
      }
    }
  }

  if (desired.rejectUnexpectedActiveConnections === true) {
    for (const connection of connections) {
      if (!expectedConnectionNames.has(connection.name) && connection.enabled === true && connection.status !== "archived") {
        findings.push(finding("unexpected_active_connection", `connections.${connection.name ?? connection.id}`, "disabled, archived, or absent", {status: connection.status ?? null, enabled: true}, `Unexpected active connection: ${connection.name ?? connection.id}`));
      }
    }
  }

  if (desiredRuntime.managedMcpOnly === true) {
    for (const connection of connections) {
      const hasInstallSnapshot = Object.prototype.hasOwnProperty.call(installs, connection.id)
        || Array.isArray(connection.installs);
      const connectionInstalls = Object.prototype.hasOwnProperty.call(installs, connection.id)
        ? array(installs[connection.id])
        : array(connection.installs);
      const basePath = `connections.${connection.name ?? connection.id}.installs`;
      if (!hasInstallSnapshot) {
        findings.push(finding("connection_installs_unobserved", basePath, [], null, `Cannot verify that ${connection.name ?? connection.id} has no direct runtime installs`));
      } else if (connectionInstalls.length > 0) {
        findings.push(finding("connection_installs_present", basePath, [], `${connectionInstalls.length} install(s)`, `${connection.name ?? connection.id} is installed directly instead of being delivered only through governed gateways`));
      }
    }
  }

  if (desired.rejectUnexpectedAgents === true) {
    for (const agent of agents) {
      if (!array(desired.profiles).some((expected) => agentMatches(agent, expected))) {
        findings.push(finding("unexpected_agent", `agents.${agent.name ?? agent.id}`, "one of the six versioned agents", "unexpected_agent", `Unexpected agent: ${agent.name ?? agent.id}`));
      }
    }
  }

  for (const expected of array(desired.profiles)) {
    const profile = profiles.find((entry) => entry.profileKey === expected.profileKey);
    const basePath = `profiles.${expected.profileKey}`;
    if (!profile) {
      findings.push(finding("profile_missing", basePath, expected.profileKey, null, `Missing profile: ${expected.profileKey}`));
      continue;
    }
    for (const key of ["status", "defaultAction"]) {
      if (profile[key] !== expected[key]) {
        findings.push(finding("profile_setting_drift", `${basePath}.${key}`, expected[key], profile[key] ?? null, `${expected.profileKey} has unexpected ${key}`));
      }
    }
    const agent = agents.find((entry) => agentMatches(entry, expected));
    if (!agent) {
      findings.push(finding("profile_agent_missing", `${basePath}.agent`, expected.agentSlug, null, `Cannot resolve agent ${expected.agentSlug}`));
      continue;
    }
    const bound = array(profile.bindings).some((binding) => binding.targetType === "agent" && binding.targetId === agent.id);
    if (!bound) {
      findings.push(finding("profile_binding_missing", `${basePath}.binding`, {targetType: "agent", agentSlug: expected.agentSlug}, null, `${expected.profileKey} is not bound to ${expected.agentSlug}`));
    }
    const effective = object(effectiveProfiles[agent.id]);
    const actualAllowed = sortedUnique(effective.allowedToolNames);
    const expectedAllowed = sortedUnique(expected.allowedTools);
    const missing = expectedAllowed.filter((tool) => !actualAllowed.includes(tool));
    if (missing.length > 0) {
      findings.push(finding("profile_tools_missing", `${basePath}.allowedTools`, expectedAllowed, actualAllowed, `${expected.profileKey} is missing allowed tools: ${missing.join(", ")}`));
    }
    if (expected.strictAllowedTools === true && !sameStrings(actualAllowed, expectedAllowed)) {
      const extra = actualAllowed.filter((tool) => !expectedAllowed.includes(tool));
      if (extra.length > 0) {
        findings.push(finding("profile_tools_overbroad", `${basePath}.allowedTools`, expectedAllowed, actualAllowed, `${expected.profileKey} exposes unexpected tools: ${extra.join(", ")}`));
      }
    }
  }
  if (desired.rejectUnexpectedProfiles === true) {
    const expectedProfileKeys = new Set(array(desired.profiles).map((entry) => entry.profileKey));
    for (const profile of profiles) {
      if (!expectedProfileKeys.has(profile.profileKey)) {
        findings.push(finding("unexpected_profile", `profiles.${profile.profileKey ?? profile.id}`, "one of the six versioned profiles", "unexpected_profile", `Unexpected profile: ${profile.profileKey ?? profile.id}`));
      }
    }
  }

  if (Object.keys(desiredRuntime).length > 0) {
    const expectedAgents = array(desired.profiles)
      .map((expected) => ({expected, agent: agents.find((entry) => agentMatches(entry, expected))}))
      .filter(({agent}, index, entries) => agent && entries.findIndex((entry) => entry.agent?.id === agent.id) === index);
    const managedHomes = new Map();
    for (const {expected, agent} of expectedAgents) {
      if (!agent) continue;
      const basePath = `agents.${expected.agentSlug}`;
      const {adapterConfig, runtimeConfig, heartbeat, env} = runtimeShape(agent);
      if (agent.adapterType !== desiredRuntime.adapterType) {
        findings.push(finding("agent_adapter_drift", `${basePath}.adapterType`, desiredRuntime.adapterType, agent.adapterType ?? null, `${expected.agentSlug} has an unexpected adapter`));
      }
      for (const [key, desiredKey] of [["engine", "engine"], ["model", "model"], ["dangerouslyBypassApprovalsAndSandbox", "dangerouslyBypassApprovalsAndSandbox"]]) {
        if (adapterConfig[key] !== desiredRuntime[desiredKey]) {
          findings.push(finding("agent_adapter_config_drift", `${basePath}.adapterConfig.${key}`, desiredRuntime[desiredKey] ?? null, adapterConfig[key] ?? null, `${expected.agentSlug} has unexpected ${key}`));
        }
      }
      const skipGitRepoCheckCount = array(adapterConfig.extraArgs).filter((entry) => entry === "--skip-git-repo-check").length;
      if (desiredRuntime.skipGitRepoCheck === true && skipGitRepoCheckCount !== 1) {
        findings.push(finding("agent_git_trust_drift", `${basePath}.adapterConfig.extraArgs.skipGitRepoCheck`, 1, skipGitRepoCheckCount, `${expected.agentSlug} must explicitly allow its generated non-git workspace exactly once`));
      }
      const permissionProfileArg = `default_permissions=\"${desiredRuntime.permissionProfile}\"`;
      const permissionProfileExtendsArg = `permissions.${desiredRuntime.permissionProfile}.extends=\"${desiredRuntime.permissionProfileExtends}\"`;
      const hasLegacySandboxFlag = array(adapterConfig.extraArgs).includes("--sandbox");
      if (
        hasLegacySandboxFlag
        || !hasConfigArg(adapterConfig.extraArgs, permissionProfileArg)
        || !hasConfigArg(adapterConfig.extraArgs, permissionProfileExtendsArg)
      ) {
        findings.push(finding(
          "agent_sandbox_drift",
          `${basePath}.adapterConfig.extraArgs.sandbox`,
          {mode: desiredRuntime.sandbox, permissionProfile: desiredRuntime.permissionProfile},
          "missing_different_or_mixed_with_legacy_flag",
          `${expected.agentSlug} does not enforce the expected read-only permission profile`,
        ));
      }
      const approvalArg = `approval_policy=\"${desiredRuntime.approvalPolicy}\"`;
      if (!hasConfigArg(adapterConfig.extraArgs, approvalArg) && !hasConfigArg(adapterConfig.extraArgs, `approval_policy=${desiredRuntime.approvalPolicy}`)) {
        findings.push(finding("agent_approval_policy_drift", `${basePath}.adapterConfig.extraArgs.approvalPolicy`, desiredRuntime.approvalPolicy, "missing_or_different", `${expected.agentSlug} does not enforce the expected approval policy`));
      }
      const networkArg = `permissions.${desiredRuntime.permissionProfile}.network.enabled=${String(desiredRuntime.networkAccess)}`;
      if (!hasConfigArg(adapterConfig.extraArgs, networkArg)) {
        findings.push(finding("agent_network_policy_drift", `${basePath}.adapterConfig.extraArgs.networkAccess`, desiredRuntime.networkAccess, "missing_or_different", `${expected.agentSlug} does not enforce the expected sandbox network policy`));
      }
      const legacyLandlockArg = `features.use_legacy_landlock=${String(desiredRuntime.useLegacyLandlock)}`;
      if (!hasConfigArg(adapterConfig.extraArgs, legacyLandlockArg)) {
        findings.push(finding("agent_sandbox_backend_drift", `${basePath}.adapterConfig.extraArgs.useLegacyLandlock`, desiredRuntime.useLegacyLandlock, "missing_or_different", `${expected.agentSlug} does not use the Docker-compatible Landlock sandbox backend`));
      }
      if (heartbeat.enabled !== desiredRuntime.heartbeatEnabled || heartbeat.maxConcurrentRuns !== desiredRuntime.maxConcurrentRuns) {
        findings.push(finding(
          "agent_heartbeat_drift",
          `${basePath}.runtimeConfig.heartbeat`,
          {enabled: desiredRuntime.heartbeatEnabled, maxConcurrentRuns: desiredRuntime.maxConcurrentRuns},
          {enabled: heartbeat.enabled ?? null, maxConcurrentRuns: heartbeat.maxConcurrentRuns ?? null},
          `${expected.agentSlug} has unexpected heartbeat settings`,
        ));
      }
      if (runtimeConfig.managedMcpOnly !== desiredRuntime.managedMcpOnly) {
        findings.push(finding("agent_managed_mcp_only_drift", `${basePath}.runtimeConfig.managedMcpOnly`, desiredRuntime.managedMcpOnly, runtimeConfig.managedMcpOnly ?? null, `${expected.agentSlug} does not require Paperclip-managed MCP delivery`));
      }

      if (desiredRuntime.requireUniqueManagedCodexHome === true) {
        const codexHome = plainEnvValue(env.CODEX_HOME);
        const companyId = typeof runtime.companyId === "string" ? runtime.companyId : null;
        const expectedSuffix = companyId ? `/companies/${companyId}/agents/${agent.id}/codex-home` : null;
        const normalizedHome = codexHome?.replace(/\\/g, "/").replace(/\/+$/, "") ?? null;
        if (!normalizedHome || !expectedSuffix || !normalizedHome.endsWith(expectedSuffix)) {
          findings.push(finding("agent_codex_home_drift", `${basePath}.adapterConfig.env.CODEX_HOME`, "unique server-managed per-agent home", normalizedHome ? "present_but_not_expected_managed_path" : "missing", `${expected.agentSlug} does not use its expected managed Codex home`));
        } else {
          const prior = managedHomes.get(normalizedHome);
          if (prior) {
            findings.push(finding("agent_codex_home_shared", `${basePath}.adapterConfig.env.CODEX_HOME`, "unique server-managed per-agent home", "shared_with_another_agent", `${expected.agentSlug} shares its managed Codex home with ${prior}`));
          }
          managedHomes.set(normalizedHome, expected.agentSlug);
        }
      }
      if (desiredRuntime.requireEmptyOpenAiApiKey === true && plainEnvValue(env.OPENAI_API_KEY) !== "") {
        findings.push(finding("agent_openai_key_binding_drift", `${basePath}.adapterConfig.env.OPENAI_API_KEY`, "empty plain value", "nonempty_or_nonplain_binding", `${expected.agentSlug} may inherit or bind an API key instead of using managed Codex auth`));
      }
    }
  }

  if (desired.requirePositiveMonthlyBudget === true) {
    const expectedAgents = array(desired.profiles)
      .map((expected) => ({expected, agent: agents.find((entry) => agentMatches(entry, expected))}))
      .filter(({agent}, index, entries) => agent && entries.findIndex((entry) => entry.agent?.id === agent.id) === index);
    for (const {expected, agent} of expectedAgents) {
      if (!agent) continue;
      if (!Number.isFinite(agent.budgetMonthlyCents) || agent.budgetMonthlyCents <= 0) {
        findings.push(finding("agent_budget_not_positive", `agents.${expected.agentSlug}.budgetMonthlyCents`, "Board-selected positive monthly hard cap", "missing_or_not_positive", `${expected.agentSlug} has no positive monthly budget hard cap`));
      }
    }
  }
  if (desired.requirePositiveCompanyMonthlyBudget === true && (!Number.isFinite(company.budgetMonthlyCents) || company.budgetMonthlyCents <= 0)) {
    findings.push(finding("company_budget_not_positive", "company.budgetMonthlyCents", "Board-selected positive monthly hard cap", "missing_or_not_positive", "Company has no positive monthly budget hard cap"));
  }

  for (const expected of array(desired.policies)) {
    const policy = policies.find((entry) => entry.name === expected.name);
    const basePath = `policies.${expected.name}`;
    if (!policy) {
      findings.push(finding("policy_missing", basePath, expected.name, null, `Missing policy: ${expected.name}`));
      continue;
    }
    for (const key of ["policyType", "priority", "enabled"]) {
      if (policy[key] !== expected[key]) {
        findings.push(finding("policy_setting_drift", `${basePath}.${key}`, expected[key], policy[key] ?? null, `${expected.name} has unexpected ${key}`));
      }
    }
    const selectors = object(policy.selectors);
    if (expected.requiredToolNames && !sameStrings(selectors.toolNames ?? (selectors.toolName ? [selectors.toolName] : []), expected.requiredToolNames)) {
      findings.push(finding("policy_selector_drift", `${basePath}.toolNames`, sortedUnique(expected.requiredToolNames), sortedUnique(selectors.toolNames ?? (selectors.toolName ? [selectors.toolName] : [])), `${expected.name} has unexpected tool selectors`));
    }
    if (expected.requiredRiskLevels && !sameStrings(selectors.riskLevels ?? (selectors.riskLevel ? [selectors.riskLevel] : []), expected.requiredRiskLevels)) {
      findings.push(finding("policy_selector_drift", `${basePath}.riskLevels`, sortedUnique(expected.requiredRiskLevels), sortedUnique(selectors.riskLevels ?? (selectors.riskLevel ? [selectors.riskLevel] : [])), `${expected.name} has unexpected risk selectors`));
    }
  }
  if (desired.rejectUnexpectedPolicies === true) {
    const expectedPolicyNames = new Set(array(desired.policies).map((entry) => entry.name));
    for (const policy of policies) {
      if (!expectedPolicyNames.has(policy.name)) {
        findings.push(finding("unexpected_policy", `policies.${policy.name ?? policy.id}`, "one of the versioned policies", "unexpected_policy", `Unexpected policy: ${policy.name ?? policy.id}`));
      }
    }
  }

  const matchedGatewayIds = new Set();
  for (const expected of array(desired.gateways)) {
    const gateway = gateways.find((entry) => entry.slug === expected.slug || entry.name === expected.name);
    const basePath = `gateways.${expected.key}`;
    if (!gateway) {
      findings.push(finding("gateway_missing", basePath, expected.name, null, `Missing gateway: ${expected.name}`));
      continue;
    }
    matchedGatewayIds.add(gateway.id);
    for (const key of ["name", "slug", "status", "defaultProfileMode", "contextScopeType"]) {
      if (gateway[key] !== expected[key]) {
        findings.push(finding("gateway_setting_drift", `${basePath}.${key}`, expected[key], gateway[key] ?? null, `${expected.name} has unexpected ${key}`));
      }
    }

    const expectedProfile = profiles.find((entry) => entry.profileKey === expected.profileKey);
    if (!expectedProfile) {
      findings.push(finding("gateway_profile_unresolved", `${basePath}.profile`, expected.profileKey, null, `Cannot resolve gateway profile ${expected.profileKey}`));
    } else if (gateway.profileId !== expectedProfile.id) {
      const actualProfile = profiles.find((entry) => entry.id === gateway.profileId);
      findings.push(finding("gateway_profile_binding_drift", `${basePath}.profile`, expected.profileKey, actualProfile?.profileKey ?? gateway.profileId ?? null, `${expected.name} is bound to an unexpected profile`));
    }
    if (desired.rejectUnexpectedGatewayProfileBindings === true) {
      const gatewayProfileBindings = profiles.flatMap((profile) => array(profile.bindings)
        .filter((binding) => binding.targetType === "gateway" && binding.targetId === gateway.id)
        .map(() => ({profileId: profile.id, profileKey: profile.profileKey ?? profile.id})));
      const hasExactBindingSet = expectedProfile
        && gatewayProfileBindings.length === 1
        && gatewayProfileBindings[0].profileId === expectedProfile.id;
      if (!hasExactBindingSet) {
        findings.push(finding(
          "gateway_profile_binding_set_drift",
          `${basePath}.profileBindings`,
          [expected.profileKey],
          gatewayProfileBindings.map((binding) => binding.profileKey),
          `${expected.name} does not have exactly one gateway profile binding to ${expected.profileKey}`,
        ));
      }
    }

    const expectedAgentProfile = array(desired.profiles).find((entry) => entry.agentSlug === expected.agentSlug);
    const expectedAgent = expectedAgentProfile
      ? agents.find((entry) => agentMatches(entry, expectedAgentProfile))
      : null;
    if (!expectedAgent) {
      findings.push(finding("gateway_agent_unresolved", `${basePath}.agent`, expected.agentSlug, null, `Cannot resolve gateway agent ${expected.agentSlug}`));
    } else {
      if (gateway.agentId !== expectedAgent.id) {
        const actualAgent = agents.find((entry) => entry.id === gateway.agentId);
        findings.push(finding("gateway_agent_binding_drift", `${basePath}.agent`, expected.agentSlug, actualAgent?.slug ?? actualAgent?.name ?? gateway.agentId ?? null, `${expected.name} is bound to an unexpected agent`));
      }
      if (expected.contextScopeType === "agent" && gateway.contextScopeId !== expectedAgent.id) {
        findings.push(finding("gateway_context_scope_drift", `${basePath}.contextScopeId`, expected.agentSlug, gateway.contextScopeId ?? null, `${expected.name} has an unexpected agent context scope`));
      }
    }

  }
  if (desired.rejectUnexpectedGateways === true) {
    for (const gateway of gateways) {
      if (!matchedGatewayIds.has(gateway.id)) {
        findings.push(finding("unexpected_gateway", `gateways.${gateway.slug ?? gateway.name ?? gateway.id}`, "one of the six versioned gateways", "unexpected_gateway", `Unexpected gateway: ${gateway.name ?? gateway.id}`));
      }
    }
  }
  if (desired.rejectPersistentGatewayTokens === true) {
    for (const gateway of gateways) {
      const basePath = `gateways.${gateway.slug ?? gateway.name ?? gateway.id}.tokens`;
      if (!Array.isArray(gateway.tokens)) {
        findings.push(finding("gateway_tokens_unobserved", basePath, "complete redacted token inventory", null, `Cannot verify persistent tokens for ${gateway.name ?? gateway.id}`));
        continue;
      }
      const activeClientTokens = gateway.tokens.filter((token) => token?.subjectType === "gateway_client" && !token.revokedAt);
      if (activeClientTokens.length > 0) {
        findings.push(finding("persistent_gateway_token", basePath, "no active gateway_client tokens", `${activeClientTokens.length} active gateway_client token(s)`, `${gateway.name ?? gateway.id} has a persistent gateway client token`));
      }
    }
  }

  const expectedRoutineKeys = new Set(array(desired.routines).map((entry) => entry.key));
  for (const expected of array(desired.routines)) {
    const routine = routines.find((entry) => routineMatches(entry, expected));
    const basePath = `routines.${expected.key}`;
    if (!routine) {
      findings.push(finding("routine_missing", basePath, expected.title, null, `Missing routine: ${expected.title}`));
      continue;
    }
    for (const key of ["status", "concurrencyPolicy", "catchUpPolicy"]) {
      if (routine[key] !== expected[key]) {
        findings.push(finding("routine_setting_drift", `${basePath}.${key}`, expected[key], routine[key] ?? null, `${expected.title} has unexpected ${key}`));
      }
    }
    const actualTriggers = array(routine.triggers);
    const expectedTriggers = array(expected.triggers);
    for (const expectedTrigger of expectedTriggers) {
      const actualTrigger = actualTriggers.find((trigger) => trigger.kind === expectedTrigger.kind);
      const triggerPath = `${basePath}.triggers.${expectedTrigger.kind}`;
      if (!actualTrigger) {
        findings.push(finding("routine_trigger_missing", triggerPath, expectedTrigger, null, `${expected.title} is missing its ${expectedTrigger.kind} trigger`));
        continue;
      }
      for (const key of ["enabled", "cronExpression", "timezone"]) {
        if (actualTrigger[key] !== expectedTrigger[key]) {
          findings.push(finding("routine_trigger_drift", `${triggerPath}.${key}`, expectedTrigger[key], actualTrigger[key] ?? null, `${expected.title} has unexpected trigger ${key}`));
        }
      }
    }
    if (expected.strictTriggers === true && actualTriggers.length !== expectedTriggers.length) {
      findings.push(finding("routine_trigger_set_drift", `${basePath}.triggers`, `${expectedTriggers.length} exact trigger(s)`, `${actualTriggers.length} trigger(s)`, `${expected.title} has an unexpected trigger set`));
    }
    if (routine.status === "active" || actualTriggers.some((trigger) => trigger.enabled === true)) {
      findings.push(finding("routine_unexpectedly_active", basePath, "paused routine with disabled triggers", "active_routine_or_trigger", `${expected.title} is active before its activation gate`));
    }
  }
  if (desired.rejectUnexpectedRoutines === true) {
    for (const routine of routines) {
      const expected = array(desired.routines).find((entry) => routineMatches(routine, entry));
      if (!expected) {
        findings.push(finding("unexpected_routine", `routines.${routine.title ?? routine.id}`, `one of: ${[...expectedRoutineKeys].join(", ")}`, "unexpected_routine", `Unexpected routine: ${routine.title ?? routine.id}`));
      }
    }
  }

  return {
    ok: findings.length === 0,
    schema: "enki-runtime-drift-report/v1",
    checkedAt: new Date().toISOString(),
    summary: {
      expectedConnections: array(desired.connections).length,
      expectedProfiles: array(desired.profiles).length,
      expectedPolicies: array(desired.policies).length,
      expectedGateways: array(desired.gateways).length,
      expectedRoutines: array(desired.routines).length,
      driftCount: findings.length,
    },
    findings,
  };
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return response.json();
}

export async function fetchRuntimeState({apiUrl, companyId, token, request = fetch}) {
  const base = apiUrl.replace(/\/+$/, "");
  const headers = {Authorization: `Bearer ${token}`, Accept: "application/json"};
  const get = async (path, label) => responseJson(await request(`${base}${path}`, {headers}), label);
  const companyPath = `/api/companies/${encodeURIComponent(companyId)}`;
  const [companyPayload, connectionPayload, profilePayload, policyPayload, gatewayPayload, agentPayload, routinePayload] = await Promise.all([
    get(companyPath, "Company query"),
    get(`${companyPath}/tools/connections`, "Connections query"),
    get(`${companyPath}/tools/profiles`, "Profiles query"),
    get(`${companyPath}/tools/policies`, "Policies query"),
    get(`${companyPath}/tools/gateways`, "Gateways query"),
    get(`${companyPath}/agents`, "Agents query"),
    get(`${companyPath}/routines`, "Routines query"),
  ]);
  const connections = array(connectionPayload.connections ?? connectionPayload);
  const profiles = array(profilePayload.profiles ?? profilePayload);
  const policies = array(policyPayload.policies ?? policyPayload);
  const gateways = array(gatewayPayload.gateways ?? gatewayPayload);
  const agents = array(agentPayload.agents ?? agentPayload);
  const routines = array(routinePayload.routines ?? routinePayload);
  const company = object(companyPayload.company ?? companyPayload);
  const catalogs = {};
  const installs = {};
  await Promise.all(connections.map(async (connection) => {
    const connectionPath = `/api/tool-connections/${encodeURIComponent(connection.id)}`;
    const [catalogPayload, installPayload] = await Promise.all([
      get(`${connectionPath}/catalog`, `Catalog query for ${connection.name ?? connection.id}`),
      get(`${connectionPath}/installs`, `Install query for ${connection.name ?? connection.id}`),
    ]);
    catalogs[connection.id] = array(catalogPayload.catalog ?? catalogPayload);
    installs[connection.id] = array(installPayload.installs ?? installPayload);
  }));
  const effectiveProfiles = {};
  await Promise.all(agents.map(async (agent) => {
    effectiveProfiles[agent.id] = await get(`${companyPath}/tools/profiles/effective/agents/${encodeURIComponent(agent.id)}`, `Effective profile query for ${agent.name ?? agent.id}`);
  }));
  return {companyId, company, connections, profiles, policies, gateways, agents, routines, catalogs, installs, effectiveProfiles};
}

function parseArgs(argv) {
  const args = {desiredPath: defaultDesiredPath, snapshotPath: null, json: false};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--desired") args.desiredPath = resolve(argv[++index] ?? "");
    else if (value === "--snapshot") args.snapshotPath = resolve(argv[++index] ?? "");
    else if (value === "--json") args.json = true;
    else if (value === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: check-runtime-drift.mjs [--desired FILE] [--snapshot FILE] [--json]",
    "",
    "Live mode requires PAPERCLIP_COMPANY_ID and PAPERCLIP_BOARD_TOKEN.",
    "PAPERCLIP_API_URL defaults to http://localhost:3100.",
    "The script performs GET requests only and never prints the Board token.",
  ].join("\n");
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    const desired = readJsonYaml(args.desiredPath);
    const runtime = args.snapshotPath
      ? readJsonYaml(args.snapshotPath)
      : await fetchRuntimeState({
          apiUrl: process.env.PAPERCLIP_API_URL || "http://localhost:3100",
          companyId: process.env.PAPERCLIP_COMPANY_ID || (() => { throw new Error("PAPERCLIP_COMPANY_ID is required in live mode"); })(),
          token: process.env.PAPERCLIP_BOARD_TOKEN || (() => { throw new Error("PAPERCLIP_BOARD_TOKEN is required in live mode"); })(),
        });
    const result = evaluateRuntimeDrift(desired, runtime);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok) console.log(`ENKI CONFIG DRIFT: PASS (${result.summary.expectedConnections} connections, ${result.summary.expectedProfiles} profiles, ${result.summary.expectedPolicies} policies, ${result.summary.expectedGateways} gateways, ${result.summary.expectedRoutines} routines)`);
    else {
      console.error(`ENKI CONFIG DRIFT: FAIL (${result.findings.length} finding${result.findings.length === 1 ? "" : "s"})`);
      for (const item of result.findings) console.error(`- [${item.code}] ${item.message}`);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Runtime drift check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
