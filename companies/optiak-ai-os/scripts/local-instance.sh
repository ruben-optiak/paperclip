#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd -- "$package_dir/../.." && pwd)

project=${OPTIAK_PAPERCLIP_PROJECT:-paperclip-optiak}
port=${OPTIAK_PAPERCLIP_PORT:-3200}
data_dir=${OPTIAK_PAPERCLIP_DATA_DIR:-"$repo_root/data/docker-paperclip-optiak"}
public_url=${OPTIAK_PAPERCLIP_PUBLIC_URL:-"http://localhost:$port"}
secret_file="$data_dir/.better-auth-secret"
quickstart="$repo_root/docker/docker-compose.quickstart.yml"
override="$package_dir/runtime/docker-compose.paperclip.yml"
publisher_override="$package_dir/runtime/docker-compose.linear-ticket-publisher.yml"
publisher_secret_dir="$package_dir/.runtime-secrets/linear-ticket-publisher"

die() {
  echo "$*" >&2
  exit 1
}

ensure_runtime() {
  command -v docker >/dev/null 2>&1 || die "docker is required"
  command -v openssl >/dev/null 2>&1 || die "openssl is required"
  case "$port" in
    ''|*[!0-9]*) die "OPTIAK_PAPERCLIP_PORT must be numeric" ;;
  esac

  mkdir -p "$data_dir"
  chmod 700 "$data_dir"
  if [ ! -f "$secret_file" ]; then
    openssl rand -hex -out "$secret_file" 32
  fi
  chmod 600 "$secret_file"

  BETTER_AUTH_SECRET=$(tr -d '\r\n' < "$secret_file")
  [ "${#BETTER_AUTH_SECRET}" -ge 32 ] || die "invalid Better Auth secret"
  export BETTER_AUTH_SECRET
  export PAPERCLIP_PORT="$port"
  export PAPERCLIP_PUBLIC_URL="$public_url"
  export PAPERCLIP_DATA_DIR="$data_dir"
}

compose() {
  docker compose \
    --project-name "$project" \
    -f "$quickstart" \
    -f "$override" \
    "$@"
}

compose_with_publisher() {
  docker compose \
    --project-name "$project" \
    -f "$quickstart" \
    -f "$override" \
    -f "$publisher_override" \
    "$@"
}

publisher_init() {
  mkdir -p "$publisher_secret_dir"
  chmod 700 "$publisher_secret_dir"
  if [ ! -f "$publisher_secret_dir/mcp-token" ]; then
    openssl rand -hex -out "$publisher_secret_dir/mcp-token" 32
  fi
  chmod 600 "$publisher_secret_dir/mcp-token"
  echo "Publisher secret directory initialized; MCP token value not displayed."
  echo "Add linear-team-id, oauth-client-id and oauth-client-secret with mode 0600 before publisher-up."
}

ensure_publisher_secrets() {
  publisher_init >/dev/null
  for name in linear-team-id oauth-client-id oauth-client-secret mcp-token; do
    path="$publisher_secret_dir/$name"
    [ -s "$path" ] || die "missing publisher secret file: companies/optiak-ai-os/.runtime-secrets/linear-ticket-publisher/$name"
    chmod 600 "$path"
  done
}

action=${1:-}
if [ -n "$action" ]; then
  shift
fi

case "$action" in
  init)
    ensure_runtime
    echo "Optiak runtime initialized at $data_dir (secret value not displayed)."
    ;;
  up)
    ensure_runtime
    compose up -d "$@"
    ;;
  ps)
    ensure_runtime
    compose ps "$@"
    ;;
  logs)
    ensure_runtime
    compose logs "$@"
    ;;
  health)
    ensure_runtime
    curl -fsS "$public_url/api/health"
    printf '\n'
    ;;
  publisher-init)
    ensure_runtime
    publisher_init
    ;;
  publisher-up)
    ensure_runtime
    ensure_publisher_secrets
    compose_with_publisher up -d "$@" linear-ticket-publisher
    ;;
  publisher-health)
    ensure_runtime
    ensure_publisher_secrets
    compose_with_publisher exec -T linear-ticket-publisher node -e \
      "fetch('http://127.0.0.1:8788/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())})"
    ;;
  publisher-logs)
    ensure_runtime
    ensure_publisher_secrets
    compose_with_publisher logs "$@" linear-ticket-publisher
    ;;
  publisher-stop)
    ensure_runtime
    ensure_publisher_secrets
    compose_with_publisher stop linear-ticket-publisher
    ;;
  stop)
    ensure_runtime
    compose stop "$@"
    ;;
  down)
    ensure_runtime
    compose down "$@"
    echo "Containers and the private network were removed; persistent data remains at $data_dir."
    ;;
  *)
    cat >&2 <<'USAGE'
Usage: local-instance.sh {init|up|ps|logs|health|stop|down|publisher-init|publisher-up|publisher-health|publisher-logs|publisher-stop} [compose arguments]

Examples:
  local-instance.sh up --build
  local-instance.sh health
  local-instance.sh logs --tail 100 paperclip
  local-instance.sh publisher-init
  local-instance.sh publisher-up --build
  local-instance.sh publisher-health
  local-instance.sh stop

Optional overrides:
  OPTIAK_PAPERCLIP_PROJECT
  OPTIAK_PAPERCLIP_INSTANCE_ID
  OPTIAK_PAPERCLIP_PORT
  OPTIAK_PAPERCLIP_PUBLIC_URL
  OPTIAK_PAPERCLIP_DATA_DIR
USAGE
    exit 2
    ;;
esac
