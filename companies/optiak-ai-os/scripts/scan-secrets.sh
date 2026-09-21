#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
failed=0

forbidden_files=$(find "$package_dir" -type f \( -name '.env' -o -name '*.pem' -o -name '*.key' -o -name 'credentials.json' -o -name 'tokens.json' -o -name 'application_default_credentials.json' \) -print)
if [ -n "$forbidden_files" ]; then
  echo "Forbidden credential files:" >&2
  echo "$forbidden_files" >&2
  failed=1
fi

scan() {
  label=$1
  pattern=$2
  if rg --hidden \
    --glob '!scripts/scan-secrets.sh' \
    --glob '!scripts/validate-package.mjs' \
    --glob '!node_modules/**' \
    --glob '!dist/**' \
    --pcre2 -n -- "$pattern" "$package_dir"; then
    echo "Detected $label" >&2
    failed=1
  fi
}

scan "private key material" '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
scan "provider or source-control token" '(?:(?:sk-(?:proj-|ant-)?|ghp_|github_pat_|AIza|ya29\.)[A-Za-z0-9_\-]{16,}|\bEA[A-Za-z0-9]{40,}\b)'
scan "JWT-like value" '\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b'
scan "machine-specific user path" '(?:/Users/[A-Za-z0-9._/-]+|/home/[A-Za-z0-9._/-]+|[A-Za-z]:\\Users\\)'
scan "database UUID" '\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b'
scan "credential-bearing URL" 'https?://[^/@[:space:]]+:[^/@[:space:]]+@'

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "Secret scan passed."
