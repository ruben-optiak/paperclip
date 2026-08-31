#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$package_dir/../.." && pwd)
build_check_dir=$(mktemp -d)
trap 'rm -rf "$build_check_dir"' EXIT HUP INT TERM

if [ ! -d "$package_dir/connectors/woocommerce-readonly-mcp/node_modules" ]; then
  echo "WooCommerce test dependencies are missing. Run: npm --prefix companies/enki-hogar-ai-os/connectors/woocommerce-readonly-mcp ci --ignore-scripts" >&2
  exit 2
fi

if [ ! -d "$package_dir/connectors/catalog-knowledge/node_modules" ]; then
  echo "Product-support connector test dependencies are missing. Run: npm --prefix companies/enki-hogar-ai-os/connectors/catalog-knowledge ci --ignore-scripts" >&2
  exit 2
fi

if [ ! -d "$package_dir/connectors/content-publisher/node_modules" ]; then
  echo "Content publisher test dependencies are missing. Run: npm --prefix companies/enki-hogar-ai-os/connectors/content-publisher ci --ignore-scripts" >&2
  exit 2
fi

node "$package_dir/scripts/validate-package.mjs"
"$package_dir/scripts/scan-secrets.sh"
node --check "$package_dir/scripts/check-runtime-drift.mjs"
node --check "$package_dir/scripts/gateway-preflight.mjs"
node --check "$package_dir/scripts/reconcile-agent-gateways.mjs"
node --check "$package_dir/scripts/reconcile-content-publisher.mjs"
node --check "$package_dir/scripts/init-local-support-secrets.mjs"
node --check "$package_dir/scripts/init-local-publishing-secrets.mjs"
node --check "$package_dir/scripts/init-local-control-plane-secrets.mjs"
node --check "$package_dir/scripts/disable-local-publishing.mjs"
node --check "$package_dir/scripts/product-support/generate-enki-espejos.mjs"
node --check "$package_dir/scripts/product-support/finalize-support-pack.mjs"
node --test "$package_dir"/tests/*.test.mjs
npm --prefix "$package_dir/connectors/woocommerce-readonly-mcp" test
npm --prefix "$package_dir/connectors/catalog-knowledge" test
npm --prefix "$package_dir/connectors/content-publisher" test
pnpm --dir "$repo_dir" --filter @enki-hogar/telegram-gateway check
"$package_dir/scripts/build-import-zip.sh" "$build_check_dir/first.zip" >/dev/null
"$package_dir/scripts/build-import-zip.sh" "$build_check_dir/second.zip" >/dev/null
if ! cmp "$build_check_dir/first.zip" "$build_check_dir/second.zip"; then
  echo "Reproducible import ZIP check failed" >&2
  exit 1
fi
echo "Reproducible import ZIP check passed."

if command -v docker >/dev/null 2>&1; then
  compose_json="$build_check_dir/compose.json"
  BETTER_AUTH_SECRET=validation-auth-secret-not-for-runtime \
  PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=validation-tool-signing-secret-not-for-runtime \
    docker compose \
      --env-file "$package_dir/.env.example" \
      -f "$repo_dir/docker/docker-compose.quickstart.yml" \
      -f "$package_dir/runtime/docker-compose.integrations.yml" \
      config --format json >"$compose_json"
  node - "$compose_json" "$package_dir" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [configPath, packageDir] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const expected = {
  "enki-woocommerce-mcp": {
    context: path.join(packageDir, "connectors/woocommerce-readonly-mcp"),
    dockerfile: "Dockerfile",
  },
  "enki-google-mcps": {
    context: packageDir,
    dockerfile: "connectors/google-mcps/Dockerfile",
  },
  "enki-product-support-migrate": {
    context: path.join(packageDir, "connectors/catalog-knowledge"),
    dockerfile: "Dockerfile",
  },
  "enki-product-support-knowledge": {
    context: path.join(packageDir, "connectors/catalog-knowledge"),
    dockerfile: "Dockerfile",
  },
  "enki-content-publisher": {
    context: path.join(packageDir, "connectors/content-publisher"),
    dockerfile: "Dockerfile",
  },
};

for (const [serviceName, wanted] of Object.entries(expected)) {
  const build = config.services?.[serviceName]?.build;
  if (!build || path.resolve(build.context) !== path.resolve(wanted.context) || build.dockerfile !== wanted.dockerfile) {
    throw new Error(
      `${serviceName} build resolution mismatch: ${JSON.stringify(build)}; expected ${JSON.stringify(wanted)}`,
    );
  }
}

const catalogDb = config.services?.["enki-product-support-db"];
if (catalogDb?.image !== "pgvector/pgvector:0.8.6-pg17-bookworm@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f") {
  throw new Error(`Product-support database image drift: ${catalogDb?.image}`);
}
if ((catalogDb?.ports ?? []).length !== 0) throw new Error("Product-support database must not publish a host port");
const catalogMcpEnvironment = config.services?.["enki-product-support-knowledge"]?.environment ?? {};
if (Object.prototype.hasOwnProperty.call(catalogMcpEnvironment, "SUPPORT_DB_ADMIN_PASSWORD")) {
  throw new Error("Product-support MCP must not receive the database admin password");
}
if (catalogMcpEnvironment.SUPPORT_DB_USER !== "enki_support_reader") throw new Error("Product-support MCP must use the reader role");

const publisher = config.services?.["enki-content-publisher"];
if (publisher?.environment?.CONTENT_PUBLISH_WRITE_MODE !== "disabled") throw new Error("Content publisher must default to its disabled kill-switch mode");
if (publisher?.ports?.[0]?.host_ip !== "127.0.0.1" || publisher?.ports?.[0]?.target !== 8040) throw new Error("Content publisher health port must bind only to host loopback");
if (!publisher?.volumes?.some((mount) => mount.target === "/data" && mount.type === "volume")) throw new Error("Content publisher must persist its idempotency journal in a named volume");
for (const key of ["WORDPRESS_APP_PASSWORD", "META_GRAPH_ACCESS_TOKEN", "CONTENT_PUBLISHER_MCP_TOKEN"]) {
  if (!Object.prototype.hasOwnProperty.call(publisher?.environment ?? {}, key)) throw new Error(`Content publisher is missing provider isolation for ${key}`);
}

const paperclipMounts = config.services?.paperclip?.volumes ?? [];
const paperclipEnvironment = config.services?.paperclip?.environment ?? {};
if (paperclipEnvironment.PAPERCLIP_TOOL_ACTION_SIGNING_SECRET !== "validation-tool-signing-secret-not-for-runtime") {
  throw new Error("Paperclip must receive the independently supplied tool-action signing secret");
}
if (paperclipEnvironment.PAPERCLIP_TOOL_ACTION_SIGNING_SECRET === paperclipEnvironment.BETTER_AUTH_SECRET) {
  throw new Error("Tool-action signing and login/session secrets must be independent");
}
const telegramMount = paperclipMounts.find((mount) => mount.target === "/plugins/enki-telegram-gateway");
const expectedTelegramSource = path.join(packageDir, "connectors/telegram-gateway");
if (!telegramMount || path.resolve(telegramMount.source) !== path.resolve(expectedTelegramSource) || telegramMount.read_only !== true) {
  throw new Error(
    `Telegram plugin mount mismatch: ${JSON.stringify(telegramMount)}; expected read-only source ${expectedTelegramSource}`,
  );
}
NODE
  echo "Combined quickstart + integrations Compose resolution passed."
else
  echo "Docker unavailable; skipped Compose syntax validation." >&2
fi
