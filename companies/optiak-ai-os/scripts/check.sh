#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM

node --check "$package_dir/scripts/validate-package.mjs"
node --check "$package_dir/scripts/check-live-agent-parity.mjs"
node --check "$package_dir/scripts/prove-director-authority.mjs"
node --check "$package_dir/scripts/check-sandbox-compat.mjs"
node --check "$package_dir/scripts/evaluate-execution-workspace.mjs"
node --check "$package_dir/scripts/evaluate-promotion-readiness.mjs"
node --check "$package_dir/scripts/evaluate-prd-readiness.mjs"
node --check "$package_dir/scripts/evaluate-postmortem.mjs"
node --check "$package_dir/scripts/run-agent-role-review.mjs"
node --check "$package_dir/skills/optiak-product-triage/scripts/evaluate-product-advisory.mjs"
node --check "$package_dir/skills/optiak-change-control/scripts/evaluate-engineering-engagement.mjs"
node --check "$package_dir/skills/optiak-e2e-validation/scripts/evaluate-qa-source-execution.mjs"
node --check "$package_dir/scripts/probe-test-environment.mjs"
node --check "$package_dir/scripts/linear-preflight.mjs"
node --check "$package_dir/connectors/linear-privacy/projection.mjs"
for file in "$package_dir"/connectors/linear-ticket-publisher/src/*.mjs; do
  node --check "$file"
done
for file in "$package_dir"/connectors/qa-source-runner/src/*.mjs; do
  node --check "$file"
done
node --check "$package_dir/scripts/probe-linear-privacy-core.mjs"
node --check "$package_dir/scripts/record-qa-note.mjs"
node --check "$package_dir/skills/optiak-durable-completion/scripts/complete-issue.mjs"
node --check "$package_dir/skills/optiak-durable-completion/scripts/validate-result-envelopes.mjs"
node "$package_dir/scripts/validate-package.mjs"
node "$package_dir/scripts/check-sandbox-compat.mjs"
node "$package_dir/scripts/probe-test-environment.mjs"
"$package_dir/scripts/scan-secrets.sh"
node --test "$package_dir"/tests/*.test.mjs
(cd "$package_dir/connectors/linear-ticket-publisher" && npm test)
(cd "$package_dir/connectors/qa-source-runner" && npm test)

"$package_dir/scripts/build-import-zip.sh" "$build_dir/first.zip" >/dev/null
"$package_dir/scripts/build-import-zip.sh" "$build_dir/second.zip" >/dev/null
if ! cmp "$build_dir/first.zip" "$build_dir/second.zip"; then
  echo "Reproducible import ZIP check failed" >&2
  exit 1
fi

echo "Optiak AI OS checks passed."
