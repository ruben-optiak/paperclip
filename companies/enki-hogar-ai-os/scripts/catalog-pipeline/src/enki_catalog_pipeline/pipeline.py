from __future__ import annotations

import csv
import hashlib
import json
import platform
import re
import shutil
from importlib.metadata import version
from pathlib import Path
from typing import Any

import pdfplumber
import pypdfium2 as pdfium

from . import DEFAULT_DPI, PIPELINE_VERSION, RUNTIME_SCHEMA
from .safety import Workspace, validate_category, validate_run_id, validate_source_slug


class PipelineError(RuntimeError):
    """Raised when a selected source cannot be prepared safely."""


PRICE_PATTERN = re.compile(r"\b\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*[€¤]")
SKU_LIKE_PATTERN = re.compile(r"\b[A-Z]{1,8}[.\-]?[A-Z0-9]{2,}(?:[.\-][A-Z0-9]{1,8})*\b")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def classify_layout(text: str, block_count: int, price_count: int, sku_like_count: int) -> str:
    text_length = len(normalize_whitespace(text))
    if price_count >= 8 or sku_like_count >= 12:
        return "table"
    if price_count >= 2 and block_count >= 8:
        return "grid_products"
    if price_count >= 1:
        return "detail_card"
    if text_length < 120:
        return "cover_or_divider"
    if text_length > 500:
        return "editorial"
    return "mixed"


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def preflight_summary(workspace: Workspace) -> dict[str, Any]:
    return {
        "safe": True,
        "runtimeVersion": PIPELINE_VERSION,
        "source": {
            "path": workspace.source_relative,
            "sha256": sha256_file(workspace.source_path),
            "sizeBytes": workspace.source_path.stat().st_size,
        },
        "storage": {
            "input": "external_read_only_at_container_boundary",
            "output": "external_separate_directory",
        },
    }


def prepare_catalog(
    workspace: Workspace,
    *,
    source_slug: str,
    category: str,
    run_id: str,
    dpi: int = DEFAULT_DPI,
) -> dict[str, Any]:
    source_slug = validate_source_slug(source_slug)
    category = validate_category(category)
    run_id = validate_run_id(run_id)
    if dpi < 72 or dpi > 600:
        raise PipelineError("dpi must be between 72 and 600")

    run_directory = workspace.output_root / run_id
    try:
        run_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise PipelineError("refusing to overwrite an existing run directory") from error
    except OSError as error:
        raise PipelineError("could not create the run directory") from error

    try:
        pages_directory = run_directory / "pages"
        pages_directory.mkdir(mode=0o750)
        source_sha256 = sha256_file(workspace.source_path)
        page_rows: list[dict[str, str]] = []
        inventory_rows: list[dict[str, str]] = []
        block_rows: list[dict[str, str]] = []

        extraction_document = None
        try:
            extraction_document = pdfplumber.open(workspace.source_path)
            rendering_document = pdfium.PdfDocument(str(workspace.source_path))
        except Exception as error:
            if extraction_document is not None:
                extraction_document.close()
            raise PipelineError("selected PDF could not be opened") from error

        try:
            with extraction_document:
                page_count = len(extraction_document.pages)
                if page_count < 1:
                    raise PipelineError("selected PDF has no pages")
                if len(rendering_document) != page_count:
                    raise PipelineError("PDF render and extraction page counts do not match")
                page_width = max(4, len(str(page_count)))

                for page_index, extraction_page in enumerate(extraction_document.pages):
                    page_number = page_index + 1
                    image_relative = f"pages/page-{page_number:0{page_width}d}.png"
                    image_target = run_directory / image_relative
                    rendering_page = rendering_document[page_index]
                    bitmap = None
                    image = None
                    try:
                        bitmap = rendering_page.render(scale=dpi / 72.0)
                        image = bitmap.to_pil()
                        image.save(image_target, format="PNG", optimize=False, compress_level=9)
                    finally:
                        if image is not None:
                            image.close()
                        if bitmap is not None:
                            bitmap.close()
                        rendering_page.close()

                    text = normalize_whitespace(extraction_page.extract_text() or "")
                    words = extraction_page.extract_words(
                        x_tolerance=3,
                        y_tolerance=3,
                        keep_blank_chars=False,
                        use_text_flow=True,
                    )
                    price_count = len(PRICE_PATTERN.findall(text))
                    sku_like_count = len(SKU_LIKE_PATTERN.findall(text))
                    layout_type = classify_layout(text, len(words), price_count, sku_like_count)

                    page_rows.append(
                        {
                            "source_slug": source_slug,
                            "source_path": workspace.source_relative,
                            "source_sha256": source_sha256,
                            "page_number": str(page_number),
                            "image_path": image_relative,
                            "backend": "pdfium",
                            "dpi": str(dpi),
                            "width_points": f"{float(extraction_page.width):.2f}",
                            "height_points": f"{float(extraction_page.height):.2f}",
                        }
                    )
                    inventory_rows.append(
                        {
                            "source_slug": source_slug,
                            "source_path": workspace.source_relative,
                            "category": category,
                            "page_number": str(page_number),
                            "image_path": image_relative,
                            "layout_type": layout_type,
                            "extraction_stage": "inventory",
                            "text_length": str(len(text)),
                            "block_count": str(len(words)),
                            "price_count": str(price_count),
                            "sku_like_count": str(sku_like_count),
                        }
                    )

                    for block_index, word in enumerate(words):
                        normalized_block = normalize_whitespace(str(word.get("text", "")))
                        if not normalized_block:
                            continue
                        block_rows.append(
                            {
                                "source_slug": source_slug,
                                "source_path": workspace.source_relative,
                                "category": category,
                                "page_number": str(page_number),
                                "block_index": str(block_index),
                                "x0": f"{float(word['x0']):.2f}",
                                "y0": f"{float(word['top']):.2f}",
                                "x1": f"{float(word['x1']):.2f}",
                                "y1": f"{float(word['bottom']):.2f}",
                                "layout_type": layout_type,
                                "text": normalized_block,
                            }
                        )
        finally:
            rendering_document.close()

        _write_csv(
            run_directory / "pages_manifest.csv",
            [
                "source_slug",
                "source_path",
                "source_sha256",
                "page_number",
                "image_path",
                "backend",
                "dpi",
                "width_points",
                "height_points",
            ],
            page_rows,
        )
        _write_csv(
            run_directory / "page_inventory.csv",
            [
                "source_slug",
                "source_path",
                "category",
                "page_number",
                "image_path",
                "layout_type",
                "extraction_stage",
                "text_length",
                "block_count",
                "price_count",
                "sku_like_count",
            ],
            inventory_rows,
        )
        _write_csv(
            run_directory / "block_inventory.csv",
            [
                "source_slug",
                "source_path",
                "category",
                "page_number",
                "block_index",
                "x0",
                "y0",
                "x1",
                "y1",
                "layout_type",
                "text",
            ],
            block_rows,
        )

        metadata = {
            "schema": RUNTIME_SCHEMA,
            "runId": run_id,
            "runtime": {
                "name": "enki-catalog-pipeline",
                "version": PIPELINE_VERSION,
                "python": platform.python_version(),
                "renderer": {"name": "pypdfium2", "version": version("pypdfium2")},
                "extractor": {"name": "pdfplumber", "version": version("pdfplumber")},
                "imageEncoder": {"name": "Pillow", "version": version("Pillow")},
            },
            "source": {
                "path": workspace.source_relative,
                "sha256": source_sha256,
                "sizeBytes": workspace.source_path.stat().st_size,
            },
            "rendering": {"backend": "pdfium", "dpi": dpi},
            "extraction": {"backend": "pdfplumber", "granularity": "word"},
            "outputs": {
                "pagesManifest": "pages_manifest.csv",
                "pageInventory": "page_inventory.csv",
                "blockInventory": "block_inventory.csv",
                "pagesDirectory": "pages",
            },
            "counts": {
                "pages": len(page_rows),
                "textBlocks": len(block_rows),
            },
        }
        _write_json(run_directory / "runtime_metadata.json", metadata)
        return metadata
    except Exception:
        shutil.rmtree(run_directory, ignore_errors=True)
        raise
