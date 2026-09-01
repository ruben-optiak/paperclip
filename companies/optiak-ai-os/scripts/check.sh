#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM

node --check "$package_dir/scripts/validate-package.mjs"
node "$package_dir/scripts/validate-package.mjs"
"$package_dir/scripts/scan-secrets.sh"
node --test "$package_dir"/tests/*.test.mjs

"$package_dir/scripts/build-import-zip.sh" "$build_dir/first.zip" >/dev/null
"$package_dir/scripts/build-import-zip.sh" "$build_dir/second.zip" >/dev/null
if ! cmp "$build_dir/first.zip" "$build_dir/second.zip"; then
  echo "Reproducible import ZIP check failed" >&2
  exit 1
fi

echo "Optiak AI OS checks passed."
