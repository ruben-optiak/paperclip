#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output=${1:-}
allowlist="$package_dir/scripts/import-allowlist.txt"

if [ -z "$output" ]; then
  echo "Usage: $0 OUTPUT.zip" >&2
  exit 2
fi
case "$output" in
  *.zip) ;;
  *) echo "Output must end in .zip" >&2; exit 2 ;;
esac
if [ -e "$output" ] || [ -e "$output.sha256" ]; then
  echo "Refusing to overwrite an existing archive or checksum" >&2
  exit 3
fi
if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required" >&2
  exit 4
fi

symlinks=$(find "$package_dir" -type l -print)
if [ -n "$symlinks" ]; then
  echo "Refusing symlinked package inputs:" >&2
  echo "$symlinks" >&2
  exit 5
fi

"$package_dir/scripts/validate-package.mjs"
"$package_dir/scripts/scan-secrets.sh"

output_dir=$(CDPATH= cd -- "$(dirname -- "$output")" && pwd)
output_path="$output_dir/$(basename -- "$output")"
case "$output_path" in
  "$package_dir"/*) echo "Output must be outside the source package" >&2; exit 5 ;;
esac

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT HUP INT TERM
file_list="$staging/files.txt"

is_allowed() {
  candidate=$1
  while IFS= read -r rule; do
    case "$rule" in ''|'#'*) continue ;; esac
    case "$rule" in
      */) case "$candidate" in "$rule"*) return 0 ;; esac ;;
      *) [ "$candidate" = "$rule" ] && return 0 ;;
    esac
  done < "$allowlist"
  return 1
}

(
  cd "$package_dir"
  find . -type f \
    ! -path './node_modules/*' \
    ! -path './dist/*' \
    ! -path './.paperclip-sdk/*' \
    ! -path './.runtime-secrets/*' \
    ! -path './source-snapshots/*' \
    ! -name '*.DS_Store' \
    -print | sed 's#^\./##' | LC_ALL=C sort
) | while IFS= read -r candidate; do
  if is_allowed "$candidate"; then
    printf '%s\n' "$candidate" >> "$file_list"
  else
    echo "Refusing unallowlisted package file: $candidate" >&2
    exit 6
  fi
done

if [ ! -s "$file_list" ]; then
  echo "Import allowlist selected no files" >&2
  exit 6
fi

archive_root="$staging/archive"
mkdir -p "$archive_root"
while IFS= read -r source_path; do
  target="$archive_root/$source_path"
  mkdir -p "$(dirname -- "$target")"
  cp "$package_dir/$source_path" "$target"
done < "$file_list"

find "$archive_root" -type f -exec touch -t 198001010000 {} +
find "$archive_root" -type f -exec chmod 0644 {} +
find "$archive_root/scripts" -type f \( -name '*.sh' -o -name '*.mjs' \) -exec chmod 0755 {} +
(
  cd "$archive_root"
  zip -0 -X -q "$output_path" -@ < "$file_list"
)

if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$output_path" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  digest=$(shasum -a 256 "$output_path" | awk '{print $1}')
else
  echo "sha256sum or shasum is required" >&2
  exit 7
fi
printf '%s  %s\n' "$digest" "$(basename -- "$output_path")" > "$output_path.sha256"
printf '%s\n%s\n' "$output_path" "$output_path.sha256"
