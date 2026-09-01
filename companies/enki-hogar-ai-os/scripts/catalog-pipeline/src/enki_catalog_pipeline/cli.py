from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from . import DEFAULT_DPI
from .adapter_regression import run_adapter_regression
from .catalog_adapters import AdapterError, load_adapter_catalog
from .extraction_core import ExtractionError
from .pipeline import PipelineError, preflight_summary, prepare_catalog
from .safety import SafetyError, validate_data_workspace, validate_workspace
from .woo_reconciliation import ReconciliationError, audit_woo, reconcile_woo


def _add_workspace_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input-root", required=True, help="External directory mounted read-only in Docker")
    parser.add_argument("--output-root", required=True, help="Separate external results directory")
    parser.add_argument("--pdf", required=True, help="PDF path relative to --input-root")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="enki-catalog-pipeline",
        description="Prepare catalogue PDFs and verify versioned extraction adapters without credentials or network access.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    preflight = commands.add_parser("preflight", help="Validate roots and selected PDF without writing results")
    _add_workspace_arguments(preflight)

    prepare = commands.add_parser("prepare", help="Rasterize every page and create a geometric source inventory")
    _add_workspace_arguments(prepare)
    prepare.add_argument("--source-slug", required=True, help="Stable lowercase source identifier")
    prepare.add_argument("--category", default="", help="Optional single-line category label")
    prepare.add_argument("--run-id", required=True, help="New portable output directory name")
    prepare.add_argument("--dpi", type=int, default=DEFAULT_DPI, help="Raster resolution from 72 to 600")

    adapters = commands.add_parser("adapter-list", help="List the four locked brand adapters")
    adapters.add_argument("--registry", type=Path, default=None, help="Optional adapter registry path")

    regression = commands.add_parser("adapter-regression", help="Run adapters against the immutable sanitized oracle")
    regression.add_argument("--manifest", type=Path, required=True, help="EAI-019 regression manifest")
    regression.add_argument("--registry", type=Path, default=None, help="Optional adapter registry path")

    reconcile = commands.add_parser(
        "woo-reconcile",
        help="Create local v1 evidence and change-set artifacts from one locked complete Woo export",
    )
    reconcile.add_argument("--input-root", required=True, help="External directory mounted read-only in Docker")
    reconcile.add_argument("--output-root", required=True, help="Separate external results directory")
    reconcile.add_argument("--profile", required=True, help="Profile JSON path relative to --input-root")
    reconcile.add_argument("--candidates", required=True, help="Candidate evidence JSONL path relative to --input-root")
    reconcile.add_argument("--woo", required=True, help="Complete Woo CSV path relative to --input-root")
    reconcile.add_argument("--run-id", required=True, help="New portable output directory name")

    audit = commands.add_parser(
        "woo-audit",
        help="Compare before/after complete Woo exports against one exact local change set",
    )
    audit.add_argument("--input-root", required=True, help="External directory mounted read-only in Docker")
    audit.add_argument("--output-root", required=True, help="Separate external results directory")
    audit.add_argument("--profile", required=True, help="Profile JSON path relative to --input-root")
    audit.add_argument("--change-set", required=True, help="Exact change-set JSON path relative to --input-root")
    audit.add_argument("--before-woo", required=True, help="Pre-import complete Woo CSV relative to --input-root")
    audit.add_argument("--after-woo", required=True, help="Post-import complete Woo CSV relative to --input-root")
    audit.add_argument("--audit-id", required=True, help="New portable audit output directory name")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "adapter-list":
            catalog = load_adapter_catalog(args.registry)
            result = {
                "schema": catalog.registry["schema"],
                "version": catalog.registry["version"],
                "coreVersion": catalog.registry["coreVersion"],
                "adapters": [
                    {
                        "adapterKey": adapter.document["adapterKey"],
                        "brandSlug": adapter.document["brandSlug"],
                        "version": adapter.document["version"],
                        "definitionSha256": adapter.definition_sha256,
                    }
                    for adapter in catalog.adapters
                ],
            }
        elif args.command == "adapter-regression":
            result = run_adapter_regression(args.manifest, registry_path=args.registry)
        elif args.command == "woo-reconcile":
            workspace = validate_data_workspace(
                args.input_root,
                args.output_root,
                {
                    "profile": (args.profile, {".json"}),
                    "candidates": (args.candidates, {".jsonl"}),
                    "woo": (args.woo, {".csv"}),
                },
            )
            result = reconcile_woo(workspace, run_id=args.run_id)
        elif args.command == "woo-audit":
            workspace = validate_data_workspace(
                args.input_root,
                args.output_root,
                {
                    "profile": (args.profile, {".json"}),
                    "change-set": (args.change_set, {".json"}),
                    "before-woo": (args.before_woo, {".csv"}),
                    "after-woo": (args.after_woo, {".csv"}),
                },
            )
            result = audit_woo(workspace, audit_id=args.audit_id)
        else:
            workspace = validate_workspace(args.input_root, args.output_root, args.pdf)
            if args.command == "preflight":
                result = preflight_summary(workspace)
            else:
                result = prepare_catalog(
                    workspace,
                    source_slug=args.source_slug,
                    category=args.category,
                    run_id=args.run_id,
                    dpi=args.dpi,
                )
    except (AdapterError, ExtractionError, PipelineError, ReconciliationError, SafetyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    except Exception:
        print("ERROR: catalogue preparation failed without producing a run", file=sys.stderr)
        return 3

    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("valid", True) else 1
