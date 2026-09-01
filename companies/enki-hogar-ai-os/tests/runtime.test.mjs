import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname, join, resolve, sep} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {evaluateRuntimeDrift, fetchRuntimeState} from "../scripts/check-runtime-drift.mjs";
import {validateGatewaySmoke} from "../scripts/gateway-preflight.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const googleDir = join(packageDir, "connectors", "google-mcps");

function readJsonYaml(relativePath) {
  return JSON.parse(readFileSync(join(packageDir, relativePath), "utf8"));
}

function sha256(relativePath) {
  return createHash("sha256").update(readFileSync(join(packageDir, relativePath))).digest("hex");
}

function healthyRuntime(desired) {
  const companyId = "company-fixture";
  const agents = desired.profiles.map((profile) => {
    const id = `agent-${profile.agentSlug}`;
    return {
      id,
      slug: profile.agentSlug,
      name: profile.agentName,
      adapterType: "codex_local",
      adapterConfig: {
        engine: "cli",
        model: "gpt-5.6-sol",
        dangerouslyBypassApprovalsAndSandbox: false,
        extraArgs: [
          "--skip-git-repo-check",
          "-c",
          "approval_policy=\"never\"",
          "-c",
          "default_permissions=\"enki-readonly-network\"",
          "-c",
          "permissions.enki-readonly-network.extends=\":read-only\"",
          "-c",
          "permissions.enki-readonly-network.network.enabled=true",
          "-c",
          "features.use_legacy_landlock=true",
        ],
        env: {
          CODEX_HOME: `/paperclip/instances/default/companies/${companyId}/agents/${id}/codex-home`,
          OPENAI_API_KEY: "",
        },
      },
      runtimeConfig: {managedMcpOnly: true, heartbeat: {enabled: false, maxConcurrentRuns: 1}},
      budgetMonthlyCents: 100,
    };
  });
  const connections = desired.connections.map((connection) => ({
    id: `connection-${connection.key}`,
    name: connection.name,
    transport: connection.transport,
    authKind: connection.authKind,
    config: connection.quarantineNewEntries === true ? {url: connection.endpoint, quarantineNewEntries: true} : {url: connection.endpoint},
    transportConfig: {url: connection.endpoint},
    credentialRefs: [{name: "Authorization", secretId: "fixture-secret", ...connection.requiredCredential}],
    status: connection.status,
    enabled: connection.enabled,
    healthStatus: connection.healthStatus,
  }));
  return {
    companyId,
    company: {id: companyId, budgetMonthlyCents: 1000},
    agents,
    connections,
    catalogs: Object.fromEntries(connections.map((connection, index) => [
      connection.id,
      desired.connections[index].tools.map((toolName) => {
        const isWrite = (desired.connections[index].writeTools ?? []).includes(toolName);
        const isDestructive = (desired.connections[index].destructiveTools ?? []).includes(toolName);
        return {toolName, status: "active", isReadOnly: !isWrite, isWrite, isDestructive};
      }),
    ])),
    installs: Object.fromEntries(connections.map((connection) => [connection.id, []])),
    profiles: desired.profiles.map((profile) => ({
      id: `profile-${profile.agentSlug}`,
      profileKey: profile.profileKey,
      status: profile.status,
      defaultAction: profile.defaultAction,
      bindings: [
        {targetType: "agent", targetId: `agent-${profile.agentSlug}`},
        {
          targetType: "gateway",
          targetId: `gateway-${desired.gateways.find((gateway) => gateway.agentSlug === profile.agentSlug).key}`,
        },
      ],
    })),
    effectiveProfiles: Object.fromEntries(desired.profiles.map((profile) => [
      `agent-${profile.agentSlug}`,
      {allowedToolNames: [...profile.allowedTools]},
    ])),
    policies: desired.policies.map((policy) => ({
      name: policy.name,
      policyType: policy.policyType,
      priority: policy.priority,
      enabled: policy.enabled,
      selectors: {
        toolNames: policy.requiredToolNames,
        riskLevels: policy.requiredRiskLevels,
      },
    })),
    gateways: desired.gateways.map((gateway) => ({
      id: `gateway-${gateway.key}`,
      name: gateway.name,
      slug: gateway.slug,
      status: gateway.status,
      profileId: `profile-${gateway.agentSlug}`,
      defaultProfileMode: gateway.defaultProfileMode,
      contextScopeType: gateway.contextScopeType,
      contextScopeId: `agent-${gateway.agentSlug}`,
      agentId: `agent-${gateway.agentSlug}`,
      tokens: [],
    })),
    routines: desired.routines.map((routine) => ({
      id: `routine-${routine.key}`,
      title: routine.title,
      status: routine.status,
      concurrencyPolicy: routine.concurrencyPolicy,
      catchUpPolicy: routine.catchUpPolicy,
      triggers: routine.triggers.map((trigger, index) => ({id: `trigger-${routine.key}-${index}`, ...trigger})),
    })),
  };
}

test("Google runtime pins upstream commits and complete dependency locks", () => {
  const pyproject = readFileSync(join(googleDir, "pyproject.toml"), "utf8");
  const uvLock = readFileSync(join(googleDir, "uv.lock"), "utf8");
  const npmLock = JSON.parse(readFileSync(join(googleDir, "package-lock.json"), "utf8"));
  assert.match(pyproject, /google-ads-mcp\.git@88f0467b9e536c562941fa52a94dd02b193c8fa4/);
  assert.match(pyproject, /google-analytics-mcp\.git@a8ca729d4a8fa99bffe87962c17c0539c6aa9da7/);
  assert.match(uvLock, /name = "fastmcp"\nversion = "3\.3\.1"/);
  assert.equal(npmLock.packages["node_modules/@jlnkrth/gsc-mcp-server"].version, "1.1.0");
  assert.equal(npmLock.packages["node_modules/uuid"].version, "11.1.1");
});

test("Compose binds host health ports to loopback and never injects upstream credentials into agents", () => {
  const compose = readFileSync(join(packageDir, "runtime", "docker-compose.integrations.yml"), "utf8");
  for (const port of [8010, 8011, 8012, 8020, 8030, 8040]) assert.match(compose, new RegExp(`127\\.0\\.0\\.1:\\$\\{[^}]+:-${port}}:${port}`));
  assert.match(compose, /GOOGLE_OAUTH_CLIENT_HOST_PATH[^\n]+:\/run\/secrets\/google\/oauth-client\.json:ro/);
  assert.doesNotMatch(compose, /^\s+GOOGLE_CLIENT_(?:ID|SECRET):/m);
  const agentConfig = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
  assert.doesNotMatch(agentConfig, /WOO_CONSUMER|GOOGLE_ADS_DEVELOPER_TOKEN|GOOGLE_CLIENT_SECRET|SUPPORT_DB_|SUPPORT_MCP_TOKEN|SUPPORT_EMBEDDING|WORDPRESS_APP_PASSWORD|META_GRAPH_ACCESS_TOKEN|CONTENT_PUBLISHER_MCP_TOKEN/);
  const catalogMcpBlock = compose.match(/\n  enki-product-support-knowledge:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|\nvolumes:)/)?.[1] || "";
  assert.doesNotMatch(catalogMcpBlock, /SUPPORT_DB_ADMIN_PASSWORD/);
  assert.match(catalogMcpBlock, /SUPPORT_DB_USER:\s*enki_support_reader/);
});

test("every Codex permission profile argument remains a YAML string", () => {
  const extension = readFileSync(join(packageDir, ".paperclip.yaml"), "utf8");
  const quotedReadOnlyArgs = extension.match(/- "permissions\.enki-readonly-network\.extends=\\":read-only\\""/g) ?? [];
  assert.equal(quotedReadOnlyArgs.length, 6);
});

test("Google proxy hides unapproved GA4 growth and launches GSC through the mounted OAuth client", () => {
  const analyticsConfig = readJsonYaml("connectors/google-mcps/config/analytics-proxy.json");
  assert.equal(analyticsConfig.mcpServers.default.tools.list_google_ads_links.enabled, false);
  assert.equal(analyticsConfig.mcpServers.default.tools.list_property_annotations.enabled, false);
  assert.equal(analyticsConfig.mcpServers.default.tools.run_conversions_report.enabled, false);

  const gscConfig = readJsonYaml("connectors/google-mcps/config/gsc-proxy.json");
  assert.equal(gscConfig.mcpServers.default.command, "node");
  assert.deepEqual(gscConfig.mcpServers.default.args, ["/app/gsc-auth-wrapper.mjs"]);

  const launcher = readFileSync(join(googleDir, "run-google-mcps.sh"), "utf8");
  assert.match(launcher, /node \/app\/render-runtime-configs\.mjs/);
  assert.match(launcher, /\/tmp\/google-ads-proxy\.runtime\.json/);
  assert.match(launcher, /\/tmp\/google-analytics-proxy\.runtime\.json/);
  const launches = launcher.match(/^fastmcp run .*$/gm) ?? [];
  assert.equal(launches.length, 3);
  for (const launch of launches) assert.match(launch, /(?:^|\s)--stateless(?:\s|$)/);
});

test("every imported skill is self-contained and its reference mirrors match canonical knowledge", () => {
  const matrix = readJsonYaml("runtime/skill-reference-mirrors.json");
  assert.equal(matrix.schema, "enki-skill-reference-mirrors/v1");
  for (const [canonical, mirrors] of Object.entries(matrix.mirrors)) {
    const canonicalHash = sha256(canonical);
    for (const mirror of mirrors) assert.equal(sha256(mirror), canonicalHash, mirror);
  }

  for (const skill of [
    "enki-brand-guardian",
    "enki-catalog-qa",
    "enki-product-support",
    "enki-change-control",
    "enki-customer-care",
    "enki-daily-brief",
    "enki-editorial-planning",
    "enki-seo-sem",
    "enki-unit-economics",
    "enki-social-publisher",
    "wordpress-publisher",
  ]) {
    const skillDir = resolve(packageDir, "skills", skill);
    const text = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    assert.doesNotMatch(text, /(?:^|[\s('"`])\.\.\//m, skill);
    for (const link of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = link[1].trim().replace(/^<|>$/g, "").split(/\s+/)[0].split("#")[0];
      if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
      const resolvedTarget = resolve(skillDir, target);
      assert.ok(resolvedTarget === skillDir || resolvedTarget.startsWith(`${skillDir}${sep}`), `${skill}: ${target}`);
      readFileSync(resolvedTarget);
    }
  }
});

test("operator docs require a complete raw ZIP path and reject directory apply", () => {
  const readme = readFileSync(join(packageDir, "README.md"), "utf8");
  const localSetup = readFileSync(join(packageDir, "runbooks", "local-setup.md"), "utf8");
  const promotion = readFileSync(join(packageDir, "runbooks", "promotion.md"), "utf8");

  assert.match(readme, /CLI sends a `\.zip`[\s\S]*byte-exact transfer path/i);
  assert.match(readme, /do not use the[\s\S]*directory as the apply source/i);
  assert.match(localSetup, /generated raw ZIP[\s\S]*byte-exact transfer path/i);
  assert.match(localSetup, /Do not apply from the package[\s\S]*directory/i);
  assert.match(readme, /--include agents,skills/);
  assert.match(localSetup, /--include agents,skills/);
  assert.match(localSetup, /routines disable-all[\s\S]*--api-base http:\/\/localhost:3100/);
  assert.match(promotion, /exact raw ZIP[\s\S]*CLI transfer path or the UI/i);
  assert.match(promotion, /Never apply from the source directory/i);
});

test("compatibility lock records verified facts and leaves unverified digests pending", () => {
  const lock = readJsonYaml("runtime/compatibility.lock.yaml");
  assert.equal(lock.paperclip.upstreamBaseCommit, "35fca95626a04f5a7ec42cf95989c3d779a1687e");
  assert.equal(lock.paperclipBundleSchemaVersion, 7);
  assert.equal(lock.codex.configuredEngine, "cli");
  assert.equal(lock.codex.model, "gpt-5.6-sol");
  assert.equal(lock.codex.managedMcpDefaultToolsApprovalMode, "approve");
  assert.match(lock.codex.managedMcpApprovalModeStatus, /verified/);
  for (const [digest, status] of [
    [lock.paperclip.imageDigest, lock.paperclip.imageStatus],
    [lock.connectors.woocommerce.imageDigest, lock.connectors.woocommerce.imageStatus],
    [lock.connectors.google.imageDigest, lock.connectors.google.imageStatus],
    [lock.connectors.productSupportKnowledge.imageDigest, lock.connectors.productSupportKnowledge.imageStatus],
    [lock.connectors.contentPublisher.imageDigest, lock.connectors.contentPublisher.imageStatus],
  ]) {
    assert.equal(digest, null);
    assert.match(status, /pending/);
  }
  for (const [digest, status] of [
    [lock.runtimes.connectorNodeImageDigest, lock.runtimes.connectorNodeImageStatus],
    [lock.runtimes.uvImageDigest, lock.runtimes.uvImageStatus],
  ]) {
    assert.ok(
      (digest === null && /pending/.test(status))
      || (/^sha256:[0-9a-f]{64}$/.test(digest) && /verified/.test(status) && !/pending/.test(status)),
    );
  }
  assert.equal(lock.runtimes.connectorNodeImageDigest, "sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57");
  assert.equal(lock.runtimes.uvImageDigest, "sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede");
  assert.equal(lock.connectors.productSupportKnowledge.databaseImageDigest, "sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f");
  assert.equal(lock.connectors.productSupportKnowledge.agentDatabaseRoleStatus, "verified_read_only_by_integration_test");
  const wooDockerfile = readFileSync(join(packageDir, "connectors", "woocommerce-readonly-mcp", "Dockerfile"), "utf8");
  const googleDockerfile = readFileSync(join(packageDir, "connectors", "google-mcps", "Dockerfile"), "utf8");
  const publisherDockerfile = readFileSync(join(packageDir, "connectors", "content-publisher", "Dockerfile"), "utf8");
  assert.match(wooDockerfile, /node:24\.11\.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57/);
  assert.match(googleDockerfile, /node:24\.11\.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57/);
  assert.match(publisherDockerfile, /node:24\.11\.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57/);
  assert.match(googleDockerfile, /uv:0\.8\.15-python3\.12-bookworm-slim@sha256:0664f9b563fb559314ae82b9d87cd34d503f98a96d8cd9b37fd9d9cfe76d5ede/);
  const compose = readFileSync(join(packageDir, "runtime", "docker-compose.integrations.yml"), "utf8");
  assert.match(compose, /pgvector\/pgvector:0\.8\.6-pg17-bookworm@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f/);
});

test("runtime drift gate accepts the exact zero-PII, per-agent managed-home state", () => {
  const desired = readJsonYaml("policies/desired-state.yaml");
  const report = evaluateRuntimeDrift(desired, healthyRuntime(desired));
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.summary.expectedProfiles, 6);
  assert.equal(report.summary.expectedPolicies, 2);
  assert.equal(report.summary.expectedGateways, 6);
  assert.equal(report.summary.expectedRoutines, 2);
});

test("runtime drift gate rejects catalog growth, customer-level access, and shared Codex homes", () => {
  const desired = readJsonYaml("policies/desired-state.yaml");
  const runtime = healthyRuntime(desired);
  runtime.catalogs["connection-woocommerce"].push({toolName: "woo_customer_lookup", status: "active", isReadOnly: true, isWrite: false, isDestructive: false});
  runtime.connections[0].credentialRefs = [];
  runtime.installs[runtime.connections[0].id].push({targetType: "agent", targetId: runtime.agents[0].id});
  runtime.agents[1].adapterConfig.env.CODEX_HOME = runtime.agents[0].adapterConfig.env.CODEX_HOME;
  runtime.agents[0].runtimeConfig.managedMcpOnly = false;
  runtime.agents[0].adapterConfig.extraArgs = runtime.agents[0].adapterConfig.extraArgs.slice(0, -2);
  runtime.agents[2].budgetMonthlyCents = 0;
  runtime.company.budgetMonthlyCents = 0;
  runtime.effectiveProfiles[runtime.agents.at(-1).id].allowedToolNames.push("woo_customer_lookup");
  runtime.routines[0].status = "active";
  runtime.routines[0].triggers[0].enabled = true;
  runtime.routines.push({id: "routine-surprise", title: "Surprise routine", status: "paused", triggers: []});
  runtime.agents.push({id: "agent-surprise", name: "Surprise agent"});
  runtime.profiles.push({id: "profile-surprise", profileKey: "surprise.profile"});
  runtime.policies.push({id: "policy-surprise", name: "Surprise policy"});
  runtime.gateways[0].slug = "drifted-director-gateway";
  runtime.gateways[1].profileId = runtime.profiles[0].id;
  runtime.gateways[2].agentId = runtime.agents[0].id;
  runtime.gateways[3].contextScopeId = runtime.agents[0].id;
  runtime.gateways[4].tokens.push({subjectType: "heartbeat_run", revokedAt: null});
  runtime.gateways[4].tokens.push({subjectType: "gateway_client", revokedAt: new Date().toISOString()});
  runtime.gateways[4].tokens.push({subjectType: "gateway_client", revokedAt: null});
  runtime.profiles[0].bindings.push({targetType: "gateway", targetId: runtime.gateways[5].id});
  runtime.gateways.push({id: "gateway-surprise", name: "Surprise gateway", slug: "surprise-gateway", tokens: []});
  const report = evaluateRuntimeDrift(desired, runtime);
  assert.equal(report.ok, false);
  const codes = new Set(report.findings.map((finding) => finding.code));
  assert.ok(codes.has("unexpected_active_tool"));
  assert.ok(codes.has("connection_credential_binding_missing"));
  assert.ok(codes.has("connection_installs_present"));
  assert.ok(codes.has("agent_codex_home_drift") || codes.has("agent_codex_home_shared"));
  assert.ok(codes.has("agent_managed_mcp_only_drift"));
  assert.ok(codes.has("agent_sandbox_backend_drift"));
  assert.ok(codes.has("profile_tools_overbroad"));
  assert.ok(codes.has("agent_budget_not_positive"));
  assert.ok(codes.has("company_budget_not_positive"));
  assert.ok(codes.has("routine_unexpectedly_active"));
  assert.ok(codes.has("unexpected_routine"));
  assert.ok(codes.has("unexpected_agent"));
  assert.ok(codes.has("unexpected_profile"));
  assert.ok(codes.has("unexpected_policy"));
  assert.ok(codes.has("gateway_setting_drift"));
  assert.ok(codes.has("gateway_profile_binding_drift"));
  assert.ok(codes.has("gateway_profile_binding_set_drift"));
  assert.ok(codes.has("gateway_agent_binding_drift"));
  assert.ok(codes.has("gateway_context_scope_drift"));
  assert.ok(codes.has("persistent_gateway_token"));
  assert.ok(codes.has("unexpected_gateway"));
});

test("gateway fixture requires read allow, write deny, and an audit row", () => {
  const pass = validateGatewaySmoke({
    ok: true,
    checks: [
      {name: "allow_read_tool", ok: true},
      {name: "deny_write_tool", ok: true},
      {name: "audit_written", ok: true},
    ],
  });
  assert.equal(pass.ok, true);
  const fail = validateGatewaySmoke({ok: true, checks: [{name: "allow_read_tool", ok: true}]});
  assert.equal(fail.ok, false);
  assert.match(fail.failures.join(" "), /deny_write_tool/);
});

test("live drift snapshot uses GET only and keeps Board auth out of URLs", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, options});
    let payload = [];
    if (url === "http://paperclip.test/api/companies/company-fixture") payload = {id: "company-fixture", budgetMonthlyCents: 100};
    else if (url.endsWith("/tools/connections")) payload = {connections: [{id: "connection-fixture", name: "Fixture connection"}]};
    else if (url.endsWith("/tools/gateways")) payload = {gateways: [{id: "gateway-fixture", name: "Fixture gateway", tokens: []}]};
    else if (url.endsWith("/agents")) payload = [{id: "agent-fixture", name: "Fixture"}];
    else if (url.endsWith("/catalog")) payload = {catalog: []};
    else if (url.endsWith("/installs")) payload = {connectionId: "connection-fixture", installs: []};
    else if (url.includes("/profiles/effective/agents/")) payload = {allowedToolNames: []};
    return {ok: true, status: 200, json: async () => payload};
  };
  const state = await fetchRuntimeState({
    apiUrl: "http://paperclip.test",
    companyId: "company-fixture",
    token: "board-fixture-token",
    request,
  });
  assert.equal(state.companyId, "company-fixture");
  assert.equal(state.routines.length, 0);
  assert.equal(state.gateways.length, 1);
  assert.deepEqual(state.installs["connection-fixture"], []);
  assert.equal(calls.length, 10);
  for (const call of calls) {
    assert.equal(call.options.method, undefined);
    assert.equal(call.options.headers.Authorization, "Bearer board-fixture-token");
    assert.doesNotMatch(call.url, /board-fixture-token/);
  }
});
