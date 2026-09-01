#!/bin/sh
set -eu

runtime_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image="enki-catalog-pipeline:0.3.0"

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 INPUT_DIR OUTPUT_DIR preflight|prepare|woo-reconcile|woo-audit [arguments]" >&2
  exit 2
fi

input_dir=$1
output_dir=$2
command=$3
shift 3

case "$command" in
  preflight|prepare|woo-reconcile|woo-audit) ;;
  *) echo "Command must be preflight, prepare, woo-reconcile or woo-audit" >&2; exit 2 ;;
esac

for path in "$input_dir" "$output_dir"; do
  if [ ! -d "$path" ]; then
    echo "Input and output roots must already exist as directories" >&2
    exit 3
  fi
  if [ -L "$path" ]; then
    echo "Input and output roots must not be symlinks" >&2
    exit 3
  fi
done

input_path=$(CDPATH= cd -- "$input_dir" && pwd -P)
output_path=$(CDPATH= cd -- "$output_dir" && pwd -P)

for path in "$input_path" "$output_path"; do
  case "$path" in
    *,*) echo "Paths containing commas are not supported by the hardened Docker mount" >&2; exit 3 ;;
  esac
done
case "$input_path/" in "$output_path/"*) echo "Input and output roots must not overlap" >&2; exit 3 ;; esac
case "$output_path/" in "$input_path/"*) echo "Input and output roots must not overlap" >&2; exit 3 ;; esac

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to prove that runtime data lives outside a worktree" >&2
  exit 4
fi
for path in "$input_path" "$output_path"; do
  if git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Refusing catalogue input or output inside a Git worktree" >&2
    exit 4
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 4
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Missing $image. Build it with: docker build --tag $image $runtime_dir" >&2
  exit 5
fi

exec docker run --rm \
  --network none \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --pids-limit 128 \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --mount "type=bind,src=$input_path,dst=/input,readonly" \
  --mount "type=bind,src=$output_path,dst=/output" \
  "$image" "$command" --input-root /input --output-root /output "$@"
