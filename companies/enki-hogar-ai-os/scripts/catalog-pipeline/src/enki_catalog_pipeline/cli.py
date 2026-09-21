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
from .product_media import ProductMediaError, prepare_product_media
from .safety import SafetyError, validate_data_workspace, validate_workspace
from .sanycces_products import (
    DEFAULT_EVIDENCE_DPI,
    SanyccesAnalysisError,
    analyze_sanycces_products,
)
from .sanycces_pool import SanyccesPoolError, prepare_sanycces_pool
from .sanycces_pool_bundles import SanyccesPoolBundleError, build_sanycces_pool_bundles
from .sanycces_tariff import SanyccesTariffError
from .woo_reconciliation import ReconciliationError, audit_woo, reconcile_woo


def _add_workspace_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input-root", required=True, help="External directory mounted read-only in Docker")
    parser.add_argument("--output-root", required=True, help="Separate external results directory")
    parser.add_argument("--pdf", required=True, help="PDF path relative to --input-root")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="enki-catalog-pipeline",
        description="Prepare and compare catalogue evidence without credentials or network access.",
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

    media = commands.add_parser(
        "prepare-product-media",
        help="Normalize one approved product image to deterministic WebP under an exact profile",
    )
    media.add_argument("--input-root", required=True, help="External directory mounted read-only in Docker")
    media.add_argument("--output-root", required=True, help="Separate external results directory")
    media.add_argument("--source", required=True, help="JPEG, PNG or WebP path relative to --input-root")
    media.add_argument("--profile", required=True, help="product-media-profile/v1 JSON relative to --input-root")
    media.add_argument("--run-id", required=True, help="New portable output directory name")
    media.add_argument("--asset-key", required=True, help="Stable lowercase output asset key")
    media.add_argument("--alt", required=True, help="Reviewed image alt text")
    media.add_argument("--source-url", required=True, help="Official HTTPS provenance URL")
    media.add_argument("--rights-confirmed", action="store_true", help="Confirm reviewed rights to reuse this source image")

    sanycces = commands.add_parser(
        "analyze-sanycces-products",
        help="Analyze the exact reviewed Sanycces 2026 faucet PDF against one locked complete Woo export",
    )
    sanycces.add_argument("--input-root", required=True, help="External directory mounted read-only in Docker")
    sanycces.add_argument("--output-root", required=True, help="Separate external results directory")
    sanycces.add_argument("--pdf", required=True, help="Reviewed Sanycces PDF path relative to --input-root")
    sanycces.add_argument("--woo", required=True, help="Locked complete Woo CSV path relative to --input-root")
    sanycces.add_argument("--run-id", required=True, help="New portable output directory name")
    sanycces.add_argument(
        "--render-evidence",
        action="store_true",
        help="Split and render all 264 logical pages plus deterministic visual-QA contact sheets",
    )
    sanycces.add_argument(
        "--evidence-dpi",
        type=int,
        default=DEFAULT_EVIDENCE_DPI,
        help="Logical-page evidence resolution from 72 to 300",
    )
    sanycces.add_argument(
        "--image-rights-confirmed",
        action="store_true",
        help="Record operator confirmation that Sanycces PDF images may be reused and transformed",
    )

    pool = commands.add_parser(
        "prepare-sanycces-pool",
        help="Prepare all reviewed Pool articles and reconcile the frozen PDF, Woo export and public Store snapshot",
    )
    pool.add_argument("--input-root", required=True, help="External clean directory mounted read-only in Docker")
    pool.add_argument("--output-root", required=True, help="Separate external results directory")
    pool.add_argument("--pdf", required=True, help="Reviewed Sanycces PDF relative to --input-root")
    pool.add_argument("--woo", required=True, help="Locked complete Woo CSV relative to --input-root")
    pool.add_argument("--tariff", required=True, help="Official PVP Nacional XLSX relative to --input-root")
    pool.add_argument("--analysis", required=True, help="Verified Sanycces analysis JSON relative to --input-root")
    pool.add_argument("--groups", required=True, help="Verified product-groups JSONL relative to --input-root")
    pool.add_argument("--candidates", required=True, help="Verified candidates JSONL relative to --input-root")
    pool.add_argument("--official-listing", required=True, help="Frozen official Pool listing HTML relative to --input-root")
    pool.add_argument("--live-page-1", required=True, help="First frozen Enki Store API JSON page relative to --input-root")
    pool.add_argument("--live-page-2", required=True, help="Second frozen Enki Store API JSON page relative to --input-root")
    pool.add_argument("--direct-checks", required=True, help="Frozen HTTP checks for published pages outside Store API")
    pool.add_argument("--profile", required=True, help="Reviewed product-media-profile/v1 relative to --input-root")
    pool.add_argument("--run-id", required=True, help="New portable output directory name")
    pool.add_argument(
        "--image-rights-confirmed",
        action="store_true",
        help="Confirm reviewed rights to reuse and transform the official Sanycces images",
    )

    pool_bundles = commands.add_parser(
        "build-sanycces-pool-bundles",
        help="Build bounded review-only product draft bundles from one frozen Pool preparation",
    )
    pool_bundles.add_argument("--input-root", required=True, help="External clean directory containing the frozen Pool preparation and taxonomy snapshots")
    pool_bundles.add_argument("--output-root", required=True, help="Separate external results directory")
    pool_bundles.add_argument("--articles", required=True, help="Prepared Pool articles JSONL relative to --input-root")
    pool_bundles.add_argument("--artifact-manifest", required=True, help="Prepared Pool artifact manifest relative to --input-root")
    pool_bundles.add_argument("--woo", required=True, help="Locked complete Woo CSV relative to --input-root")
    pool_bundles.add_argument("--categories-page-1", required=True, help="Frozen Woo Store category page 1 JSON")
    pool_bundles.add_argument("--categories-page-2", required=True, help="Frozen Woo Store category page 2 JSON")
    pool_bundles.add_argument("--attributes", required=True, help="Frozen Woo Store product attributes JSON")
    pool_bundles.add_argument("--finish-terms", required=True, help="Frozen Woo Acabado terms JSON")
    pool_bundles.add_argument("--discount-policy", required=True, help="Approved Sanycces discount policy JSON")
    pool_bundles.add_argument("--run-id", required=True, help="New portable output directory name")
    pool_bundles.add_argument("--created-at", required=True, help="Bundle creation instant with explicit UTC offset")
    pool_bundles.add_argument("--catalog-captured-at", required=True, help="Catalogue capture instant with explicit UTC offset")
    pool_bundles.add_argument("--woo-captured-at", required=True, help="Woo export capture instant with explicit UTC offset")
    pool_bundles.add_argument("--taxonomy-captured-at", required=True, help="Woo taxonomy capture instant with explicit UTC offset")
    pool_bundles.add_argument("--catalog-logical-name", default="GRIFERIA_N_2026-SP.pdf", help="Portable catalogue label")
    pool_bundles.add_argument("--woo-logical-name", default="Productos-Export-2026-September-19-1740.csv", help="Portable Woo export label")
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
        elif args.command == "prepare-product-media":
            workspace = validate_data_workspace(
                args.input_root,
                args.output_root,
                {
                    "source": (args.source, {".jpg", ".jpeg", ".png", ".webp"}),
                    "profile": (args.profile, {".json"}),
                },
            )
            result = prepare_product_media(
                workspace,
                run_id=args.run_id,
                asset_key=args.asset_key,
                alt_text=args.alt,
                source_url=args.source_url,
                rights_confirmed=args.rights_confirmed,
            )
        elif args.command == "analyze-sanycces-products":
            workspace = validate_data_workspace(
                args.input_root,
                args.output_root,
                {
                    "pdf": (args.pdf, {".pdf"}),
                    "woo": (args.woo, {".csv"}),
                },
            )
            result = analyze_sanycces_products(
                workspace,
                run_id=args.run_id,
                render_evidence=args.render_evidence,
                evidence_dpi=args.evidence_dpi,
                image_rights_confirmed=args.image_rights_confirmed,
            )
        elif args.command == "prepare-sanycces-pool":
            workspace = validate_data_workspace(
                args.input_root,
                args.output_root,
                {
                    "pdf": (args.pdf, {".pdf"}),
                    "woo": (args.woo, {".csv"}),
                    "tariff": (args.tariff, {".xlsx"}),
                    "analysis": (args.analysis, {".json"}),
                    "groups": (args.groups, {".jsonl"}),
                    "candidates": (args.candidates, {".jsonl"}),
                    "official_listing": (args.official_listing, {".html"}),
                    "live_page_1": (args.live_page_1, {".json"}),
                    "live_page_2": (args.live_page_2, {".json"}),
                    "direct_checks": (args.direct_checks, {".json"}),
                    "profile": (args.profile, {".json"}),
                },
            )
            result = prepare_sanycces_pool(
                workspace,
                run_id=args.run_id,
                rights_confirmed=args.image_rights_confirmed,
            )
        elif args.command == "build-sanycces-pool-bundles":
            workspace = validate_data_workspace(
                args.input_root,
                args.output_root,
                {
                    "articles": (args.articles, {".jsonl"}),
                    "artifact_manifest": (args.artifact_manifest, {".json"}),
                    "woo": (args.woo, {".csv"}),
                    "categories_page_1": (args.categories_page_1, {".json"}),
                    "categories_page_2": (args.categories_page_2, {".json"}),
                    "attributes": (args.attributes, {".json"}),
                    "finish_terms": (args.finish_terms, {".json"}),
                    "discount_policy": (args.discount_policy, {".json"}),
                },
            )
            result = build_sanycces_pool_bundles(
                workspace,
                run_id=args.run_id,
                created_at=args.created_at,
                catalog_captured_at=args.catalog_captured_at,
                woo_captured_at=args.woo_captured_at,
                taxonomy_captured_at=args.taxonomy_captured_at,
                catalog_logical_name=args.catalog_logical_name,
                woo_logical_name=args.woo_logical_name,
            )
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
    except (
        AdapterError,
        ExtractionError,
        PipelineError,
        ProductMediaError,
        ReconciliationError,
        SafetyError,
        SanyccesAnalysisError,
        SanyccesPoolBundleError,
        SanyccesPoolError,
        SanyccesTariffError,
    ) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    except Exception:
        print("ERROR: catalogue preparation failed without producing a run", file=sys.stderr)
        return 3

    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result.get("valid", True) else 1
