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

node "$package_dir/scripts/validate-package.mjs"
"$package_dir/scripts/scan-secrets.sh"
node --check "$package_dir/scripts/check-runtime-drift.mjs"
node --check "$package_dir/scripts/gateway-preflight.mjs"
node --check "$package_dir/scripts/reconcile-agent-gateways.mjs"
node --test "$package_dir"/tests/*.test.mjs
npm --prefix "$package_dir/connectors/woocommerce-readonly-mcp" test
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
  BETTER_AUTH_SECRET=validation-placeholder-not-a-secret \
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
};

for (const [serviceName, wanted] of Object.entries(expected)) {
  const build = config.services?.[serviceName]?.build;
  if (!build || path.resolve(build.context) !== path.resolve(wanted.context) || build.dockerfile !== wanted.dockerfile) {
    throw new Error(
      `${serviceName} build resolution mismatch: ${JSON.stringify(build)}; expected ${JSON.stringify(wanted)}`,
    );
  }
}

const paperclipMounts = config.services?.paperclip?.volumes ?? [];
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
