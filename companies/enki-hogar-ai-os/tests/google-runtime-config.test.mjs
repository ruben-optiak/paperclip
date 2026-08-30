import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

import {
  buildRuntimeConfigs,
  writeRuntimeConfigs,
} from "../connectors/google-mcps/render-runtime-configs.mjs";

const adsTemplate = {mcpServers: {default: {command: "google-ads-mcp"}}};
const analyticsTemplate = {mcpServers: {default: {command: "analytics-mcp", tools: {unapproved: {enabled: false}}}}};
const environment = {
  GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/google/adc.json",
  GOOGLE_CLOUD_PROJECT: "fixture-project",
  GOOGLE_ADS_DEVELOPER_TOKEN: "fixture-developer-token",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "1234567890",
  GOOGLE_ADS_MCP_TOOLS_CONFIG: "/app/config/google-ads-readonly.yaml",
};

test("runtime configs project only the credentials required by each provider", () => {
  const configs = buildRuntimeConfigs({adsTemplate, analyticsTemplate, environment});
  assert.deepEqual(configs.googleAds.mcpServers.default.env, {
    GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/google/adc.json",
    GOOGLE_CLOUD_PROJECT: "fixture-project",
    GOOGLE_ADS_DEVELOPER_TOKEN: "fixture-developer-token",
    GOOGLE_ADS_MCP_TOOLS_CONFIG: "/app/config/google-ads-readonly.yaml",
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: "1234567890",
  });
  assert.deepEqual(configs.googleAnalytics.mcpServers.default.env, {
    GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/google/adc.json",
    GOOGLE_CLOUD_PROJECT: "fixture-project",
  });
  assert.deepEqual(configs.googleAnalytics.mcpServers.default.tools, {unapproved: {enabled: false}});
  assert.equal(JSON.stringify(configs.googleAnalytics).includes("fixture-developer-token"), false);
});

test("rendered provider configs are created with mode 600", () => {
  const directory = mkdtempSync(join(tmpdir(), "enki-google-runtime-"));
  const adsTemplatePath = join(directory, "ads-template.json");
  const analyticsTemplatePath = join(directory, "analytics-template.json");
  const googleAds = join(directory, "ads-runtime.json");
  const googleAnalytics = join(directory, "analytics-runtime.json");
  writeFileSync(adsTemplatePath, JSON.stringify(adsTemplate));
  writeFileSync(analyticsTemplatePath, JSON.stringify(analyticsTemplate));

  writeRuntimeConfigs({
    environment,
    adsTemplatePath,
    analyticsTemplatePath,
    outputPaths: {googleAds, googleAnalytics},
  });

  assert.equal(statSync(googleAds).mode & 0o777, 0o600);
  assert.equal(statSync(googleAnalytics).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(googleAds, "utf8")).mcpServers.default.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID, "1234567890");
});
