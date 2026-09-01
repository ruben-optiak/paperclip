from __future__ import annotations

import fnmatch
import os
import re
from dataclasses import dataclass
from pathlib import Path


class SafetyError(ValueError):
    """Raised when an input or output violates the runtime boundary."""


@dataclass(frozen=True)
class Workspace:
    input_root: Path
    output_root: Path
    source_path: Path
    source_relative: str


@dataclass(frozen=True)
class DataWorkspace:
    input_root: Path
    output_root: Path
    files: dict[str, Path]
    relative_files: dict[str, str]


FORBIDDEN_EXACT_NAMES = {
    ".env",
    "application_default_credentials.json",
    "google-ads.yaml",
    "tokens.json",
}
FORBIDDEN_NAME_PATTERNS = (
    "auth_*.json",
    "client_secret*.json",
    "credentials*.json",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.pem",
)
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RUN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


def _runtime_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _resolve_directory(raw_path: str | Path, label: str) -> Path:
    candidate = Path(raw_path).expanduser()
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise SafetyError(f"{label} does not exist") from error
    if not resolved.is_dir():
        raise SafetyError(f"{label} must be a directory")
    if resolved == Path(resolved.anchor):
        raise SafetyError(f"{label} cannot be a filesystem root")
    return resolved


def _contains(parent: Path, child: Path) -> bool:
    return child == parent or child.is_relative_to(parent)


def _git_ancestor(path: Path) -> Path | None:
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def _assert_external_roots(input_root: Path, output_root: Path) -> None:
    runtime_root = _runtime_root()
    for label, root in (("input root", input_root), ("output root", output_root)):
        if _contains(runtime_root, root):
            raise SafetyError(f"{label} must live outside the versioned runtime")
        if _git_ancestor(root) is not None:
            raise SafetyError(f"{label} must live outside a Git worktree")
    if _contains(input_root, output_root) or _contains(output_root, input_root):
        raise SafetyError("input and output roots must be separate, non-overlapping directories")


def _assert_clean_tree(root: Path, label: str) -> None:
    for current_root, directory_names, file_names in os.walk(root, followlinks=False):
        current = Path(current_root)
        for name in (*directory_names, *file_names):
            candidate = current / name
            if candidate.is_symlink():
                raise SafetyError(f"{label} must not contain symlinks")
            if name == ".git":
                raise SafetyError(f"{label} must not contain nested Git metadata")
        for name in file_names:
            lowered = name.lower()
            if lowered in FORBIDDEN_EXACT_NAMES or any(
                fnmatch.fnmatch(lowered, pattern) for pattern in FORBIDDEN_NAME_PATTERNS
            ):
                raise SafetyError(f"{label} contains a credential-like file")


def _resolve_source(input_root: Path, source: str) -> tuple[Path, str]:
    if not source or "\x00" in source:
        raise SafetyError("PDF path must be a non-empty relative path")
    relative_path = Path(source)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise SafetyError("PDF path must stay below the input root")
    if relative_path.suffix.lower() != ".pdf":
        raise SafetyError("selected source must be a PDF")
    try:
        resolved = (input_root / relative_path).resolve(strict=True)
    except OSError as error:
        raise SafetyError("selected PDF does not exist") from error
    if not _contains(input_root, resolved) or not resolved.is_file():
        raise SafetyError("selected PDF must be a regular file below the input root")
    return resolved, resolved.relative_to(input_root).as_posix()


def _resolve_relative_file(
    input_root: Path,
    source: str,
    label: str,
    allowed_suffixes: set[str],
) -> tuple[Path, str]:
    if not source or "\x00" in source:
        raise SafetyError(f"{label} must be a non-empty relative path")
    relative_path = Path(source)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise SafetyError(f"{label} must stay below the input root")
    if relative_path.suffix.lower() not in allowed_suffixes:
        suffixes = ", ".join(sorted(allowed_suffixes))
        raise SafetyError(f"{label} must use one of these suffixes: {suffixes}")
    try:
        resolved = (input_root / relative_path).resolve(strict=True)
    except OSError as error:
        raise SafetyError(f"{label} does not exist") from error
    if not _contains(input_root, resolved) or not resolved.is_file() or resolved.is_symlink():
        raise SafetyError(f"{label} must be a regular file below the input root")
    return resolved, resolved.relative_to(input_root).as_posix()


def validate_workspace(input_root: str | Path, output_root: str | Path, source: str) -> Workspace:
    resolved_input = _resolve_directory(input_root, "input root")
    resolved_output = _resolve_directory(output_root, "output root")
    _assert_external_roots(resolved_input, resolved_output)
    _assert_clean_tree(resolved_input, "input root")
    _assert_clean_tree(resolved_output, "output root")
    source_path, source_relative = _resolve_source(resolved_input, source)
    if not os.access(resolved_output, os.W_OK):
        raise SafetyError("output root is not writable")
    return Workspace(
        input_root=resolved_input,
        output_root=resolved_output,
        source_path=source_path,
        source_relative=source_relative,
    )


def validate_data_workspace(
    input_root: str | Path,
    output_root: str | Path,
    files: dict[str, tuple[str, set[str]]],
) -> DataWorkspace:
    """Validate a credential-free, non-Git workspace for CSV/JSON processing."""

    resolved_input = _resolve_directory(input_root, "input root")
    resolved_output = _resolve_directory(output_root, "output root")
    _assert_external_roots(resolved_input, resolved_output)
    _assert_clean_tree(resolved_input, "input root")
    _assert_clean_tree(resolved_output, "output root")
    if not os.access(resolved_output, os.W_OK):
        raise SafetyError("output root is not writable")

    resolved_files: dict[str, Path] = {}
    relative_files: dict[str, str] = {}
    for key, (source, suffixes) in files.items():
        resolved, relative = _resolve_relative_file(resolved_input, source, key, suffixes)
        resolved_files[key] = resolved
        relative_files[key] = relative
    return DataWorkspace(
        input_root=resolved_input,
        output_root=resolved_output,
        files=resolved_files,
        relative_files=relative_files,
    )


def validate_source_slug(value: str) -> str:
    if not SLUG_PATTERN.fullmatch(value or ""):
        raise SafetyError("source slug must contain lowercase letters, digits and single hyphens")
    return value


def validate_run_id(value: str) -> str:
    if not RUN_ID_PATTERN.fullmatch(value or "") or value in {".", ".."}:
        raise SafetyError("run id must be a portable single path segment")
    return value


def validate_category(value: str) -> str:
    normalized = (value or "").strip()
    if len(normalized) > 160 or "\n" in normalized or "\r" in normalized:
        raise SafetyError("category must be a single line of at most 160 characters")
    return normalized
