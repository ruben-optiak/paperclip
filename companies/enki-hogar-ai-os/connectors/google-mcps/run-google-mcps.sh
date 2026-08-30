#!/bin/sh
set -eu

: "${GOOGLE_PROJECT_ID:?GOOGLE_PROJECT_ID is required}"
: "${GOOGLE_ADS_DEVELOPER_TOKEN:?GOOGLE_ADS_DEVELOPER_TOKEN is required}"
: "${GOOGLE_MCP_TOKEN:?GOOGLE_MCP_TOKEN is required}"

export GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS:-/run/secrets/google/application_default_credentials.json}
export GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT:-$GOOGLE_PROJECT_ID}
export GSC_TOKEN_PATH=${GSC_TOKEN_PATH:-/run/secrets/gsc/tokens.json}
export GOOGLE_ADS_MCP_TOOLS_CONFIG=/app/config/google-ads-readonly.yaml
oauth_client_path=/run/secrets/google/oauth-client.json

if [ ! -r "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "Google ADC mount is missing" >&2
  exit 2
fi
if [ ! -r "$GSC_TOKEN_PATH" ]; then
  echo "GSC token mount is missing; authenticate outside the runtime first" >&2
  exit 2
fi
if [ ! -r "$oauth_client_path" ]; then
  echo "GSC OAuth client mount is missing" >&2
  exit 2
fi

node /app/render-runtime-configs.mjs

pids=""
cleanup() {
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

fastmcp run /tmp/google-ads-proxy.runtime.json --transport http --host 127.0.0.1 --port 9010 --path /mcp --stateless --no-banner & pids="$pids $!"
fastmcp run /tmp/google-analytics-proxy.runtime.json --transport http --host 127.0.0.1 --port 9011 --path /mcp --stateless --no-banner & pids="$pids $!"
fastmcp run /app/config/gsc-proxy.json --transport http --host 127.0.0.1 --port 9012 --path /mcp --stateless --no-banner & pids="$pids $!"

node /app/auth-proxy.mjs 8010 9010 google-ads & pids="$pids $!"
node /app/auth-proxy.mjs 8011 9011 google-analytics & pids="$pids $!"
node /app/auth-proxy.mjs 8012 9012 google-search-console & pids="$pids $!"

while :; do
  for pid in $pids; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A Google MCP process exited; stopping the runtime" >&2
      exit 1
    fi
  done
  sleep 2
done
