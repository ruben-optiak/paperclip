#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_root=${ENKI_KNOWLEDGE_SOURCE:-}
source_revision=${ENKI_KNOWLEDGE_REVISION:-}

if [ -z "$source_root" ]; then
  echo "ENKI_KNOWLEDGE_SOURCE is required" >&2
  exit 2
fi
if [ ! -d "$source_root" ]; then
  echo "ENKI_KNOWLEDGE_SOURCE is not a directory" >&2
  exit 2
fi
if [ -z "$source_revision" ]; then
  echo "ENKI_KNOWLEDGE_REVISION is required (Git commit, release ID, or dated immutable snapshot ID)" >&2
  exit 2
fi
if ! printf '%s' "$source_revision" | grep -E '^[A-Za-z0-9._:@+-]{7,128}$' >/dev/null; then
  echo "ENKI_KNOWLEDGE_REVISION must be a portable immutable identifier" >&2
  exit 2
fi

revision_status=operator_declared_unverified
if command -v git >/dev/null 2>&1 && git -C "$source_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  observed_revision=$(git -C "$source_root" rev-parse HEAD)
  if [ "$observed_revision" != "$source_revision" ]; then
    echo "ENKI_KNOWLEDGE_REVISION does not match the source Git HEAD" >&2
    exit 2
  fi
  revision_status=verified_git_head
fi

allowlist="$package_dir/references/source-allowlist.tsv"
destination="$package_dir/references/source-snapshots"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT HUP INT TERM
captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256sum or shasum is required" >&2
    exit 6
  fi
}

printf 'schema\tenki-knowledge-snapshot/v1\n' > "$staging/SNAPSHOT.tsv"
printf 'revision\t%s\nrevision_status\t%s\ncaptured_at\t%s\n' "$source_revision" "$revision_status" "$captured_at" >> "$staging/SNAPSHOT.tsv"
printf 'source_path\tsha256\tcurated_target\tpurpose\n' >> "$staging/SNAPSHOT.tsv"

tab=$(printf '\t')
while IFS="$tab" read -r source_path curated_target purpose; do
  case "$source_path" in
    ''|'#'*) continue ;;
    /*|*..*|*auth_*.json|*google-ads.yaml|*.pdf|*.png|*.jpg|*.jpeg|*.zip|*.db)
      echo "Forbidden allowlist entry: $source_path" >&2
      exit 3
      ;;
  esac
  source_file="$source_root/$source_path"
  if [ ! -f "$source_file" ]; then
    echo "Missing allowlisted source: $source_path" >&2
    exit 4
  fi
  if grep -E -i -n '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|password[[:space:]]*[:=][[:space:]]*[^ <{]|token[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_-]{16,}|client_secret[[:space:]]*[:=][[:space:]]*[^ <{]|consumer_secret[[:space:]]*[:=][[:space:]]*[^ <{]|/Users/|/home/|[A-Za-z]:\\Users\\|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,})' "$source_file" >/dev/null; then
    echo "Sensitive value, PII, or private path detected in: $source_path" >&2
    exit 5
  fi
  target="$staging/$source_path"
  mkdir -p "$(dirname -- "$target")"
  cp "$source_file" "$target"
  printf '%s\t%s\t%s\t%s\n' "$source_path" "$(sha256_file "$target")" "$curated_target" "$purpose" >> "$staging/SNAPSHOT.tsv"
done < "$allowlist"

rm -rf "$destination"
mv "$staging" "$destination"
trap - EXIT HUP INT TERM
echo "Allowlisted candidates synchronized to references/source-snapshots; review before curating."
