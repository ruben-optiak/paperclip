import {readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

export const RUNTIME_CONFIG_PATHS = {
  googleAds: "/tmp/google-ads-proxy.runtime.json",
  googleAnalytics: "/tmp/google-analytics-proxy.runtime.json",
};

function required(environment, key) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required to render the Google MCP runtime`);
  return value;
}

function clone(document) {
  return JSON.parse(JSON.stringify(document));
}

export function buildRuntimeConfigs({adsTemplate, analyticsTemplate, environment}) {
  const credentialsPath = required(environment, "GOOGLE_APPLICATION_CREDENTIALS");
  const project = required(environment, "GOOGLE_CLOUD_PROJECT");

  const ads = clone(adsTemplate);
  ads.mcpServers.default.env = {
    GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
    GOOGLE_CLOUD_PROJECT: project,
    GOOGLE_ADS_DEVELOPER_TOKEN: required(environment, "GOOGLE_ADS_DEVELOPER_TOKEN"),
    GOOGLE_ADS_MCP_TOOLS_CONFIG: environment.GOOGLE_ADS_MCP_TOOLS_CONFIG || "/app/config/google-ads-readonly.yaml",
  };
  const loginCustomerId = environment.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  if (loginCustomerId) ads.mcpServers.default.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = loginCustomerId;

  const analytics = clone(analyticsTemplate);
  analytics.mcpServers.default.env = {
    GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
    GOOGLE_CLOUD_PROJECT: project,
  };

  return {googleAds: ads, googleAnalytics: analytics};
}

export function writeRuntimeConfigs({
  environment = process.env,
  adsTemplatePath = "/app/config/ads-proxy.json",
  analyticsTemplatePath = "/app/config/analytics-proxy.json",
  outputPaths = RUNTIME_CONFIG_PATHS,
} = {}) {
  const configs = buildRuntimeConfigs({
    adsTemplate: JSON.parse(readFileSync(adsTemplatePath, "utf8")),
    analyticsTemplate: JSON.parse(readFileSync(analyticsTemplatePath, "utf8")),
    environment,
  });
  writeFileSync(outputPaths.googleAds, JSON.stringify(configs.googleAds), {encoding: "utf8", mode: 0o600, flag: "w"});
  writeFileSync(outputPaths.googleAnalytics, JSON.stringify(configs.googleAnalytics), {encoding: "utf8", mode: 0o600, flag: "w"});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    writeRuntimeConfigs();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to render Google MCP runtime configuration");
    process.exit(1);
  }
}
