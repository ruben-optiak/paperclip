from __future__ import annotations

import csv
import hashlib
import json
import platform
import re
import shutil
from collections import Counter, defaultdict
from io import BytesIO
from importlib.metadata import version
from pathlib import Path
from typing import Any

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont, ImageOps

from . import PIPELINE_VERSION
from .pipeline import sha256_file
from .safety import DataWorkspace, validate_run_id


class SanyccesAnalysisError(RuntimeError):
    """Raised when the pinned Sanycces product analysis cannot be proven."""


ADAPTER_SCHEMA = "enki-product-catalog-adapter/v1"
ANALYSIS_SCHEMA = "enki-sanycces-product-catalog-analysis/v1"
DEFAULT_ADAPTER = Path(__file__).resolve().parents[2] / "product_adapters" / "sanycces-griferia-2026.v1.json"
DEFAULT_EVIDENCE_DPI = 144
MIN_EVIDENCE_DPI = 72
MAX_EVIDENCE_DPI = 300
CONTACT_SHEET_PAGE_COUNT = 12


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _write_json(path: Path, value: Any) -> None:
    path.write_bytes(_json_bytes(value))


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


def _text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_sanycces_adapter(path: Path | None = None) -> tuple[dict[str, Any], str]:
    selected = path or DEFAULT_ADAPTER
    try:
        raw = selected.read_bytes()
        document = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise SanyccesAnalysisError("Sanycces product adapter could not be loaded") from error
    if document.get("schema") != ADAPTER_SCHEMA:
        raise SanyccesAnalysisError("unexpected Sanycces product adapter schema")
    if document.get("version") != "1.0.0" or document.get("implementation") != "sanycces_finish_matrix_v1":
        raise SanyccesAnalysisError("unsupported Sanycces product adapter version")
    if document.get("brandSlug") != "sanycces" or document.get("adapterKey") != "sanycces-griferia-2026":
        raise SanyccesAnalysisError("unexpected Sanycces product adapter identity")
    authority = document.get("authority", {})
    if authority.get("isCatalogInventoryTruth") is not True:
        raise SanyccesAnalysisError("Sanycces PDF must remain the catalogue inventory source of truth")
    if authority.get("websiteMayDefineCatalogInventory") is not False:
        raise SanyccesAnalysisError("Sanycces website must not define catalogue inventory")
    if any(
        authority.get(key) is not False
        for key in (
            "isLiveCommercialTruth",
            "isConfirmedNewProductList",
            "isExternalMutationAuthority",
            "canGenerateWooImport",
            "canPublishProducts",
        )
    ):
        raise SanyccesAnalysisError("Sanycces product adapter must remain local observation only")
    return document, hashlib.sha256(raw).hexdigest()


def _matrix_pairs(adapter: dict[str, Any]) -> list[tuple[str, int, int]]:
    pairs: list[tuple[str, int, int]] = []
    for definition in adapter["logicalPages"]["matrixPairs"]:
        first = int(definition["technicalFirst"])
        last = int(definition["technicalLast"])
        step = int(definition["step"])
        offset = int(definition["matrixOffset"])
        if first > last or step != 2 or offset != 1:
            raise SanyccesAnalysisError("invalid reviewed technical/matrix page range")
        for technical_page in range(first, last + 1, step):
            pairs.append((str(definition["section"]), technical_page, technical_page + offset))
    if len(pairs) != 50 or len({matrix for _, _, matrix in pairs}) != 50:
        raise SanyccesAnalysisError("reviewed Sanycces page-pair coverage drift")
    return pairs


def _section_for_page(adapter: dict[str, Any], printed_page: int | None) -> str:
    if printed_page is None:
        return "cover"
    for section in adapter["logicalPages"]["sections"]:
        if int(section["first"]) <= printed_page <= int(section["last"]):
            return str(section["key"])
    return "unknown"


def _role_for_page(adapter: dict[str, Any], printed_page: int | None, cover_kind: str | None) -> str:
    if cover_kind:
        return cover_kind
    pairs = _matrix_pairs(adapter)
    technical_pages = {technical for _, technical, _ in pairs}
    matrix_pages = {matrix for _, _, matrix in pairs}
    if printed_page in matrix_pages:
        return "sku_matrix"
    if printed_page in technical_pages:
        return "technical"
    if printed_page in set(adapter["logicalPages"]["indexPages"]):
        return "index"
    if printed_page in {262, 263}:
        return "information"
    return "editorial"


def logical_page_descriptors(adapter: dict[str, Any]) -> list[dict[str, Any]]:
    expected = int(adapter["source"]["physicalPageCount"])
    descriptors: list[dict[str, Any]] = [
        {
            "logicalKey": "front-cover",
            "printedPage": None,
            "physicalPage": 1,
            "side": "full",
            "role": "front_cover",
            "section": "cover",
        }
    ]
    for physical_page in range(2, expected):
        for side, printed_page in (("left", physical_page * 2 - 2), ("right", physical_page * 2 - 1)):
            descriptors.append(
                {
                    "logicalKey": f"page-{printed_page}",
                    "printedPage": printed_page,
                    "physicalPage": physical_page,
                    "side": side,
                    "role": _role_for_page(adapter, printed_page, None),
                    "section": _section_for_page(adapter, printed_page),
                }
            )
    descriptors.append(
        {
            "logicalKey": "back-cover",
            "printedPage": None,
            "physicalPage": expected,
            "side": "full",
            "role": "back_cover",
            "section": "cover",
        }
    )
    if len(descriptors) != int(adapter["source"]["logicalPageCount"]):
        raise SanyccesAnalysisError("logical page model does not match the reviewed adapter")
    return descriptors


def _logical_image_name(descriptor: dict[str, Any]) -> str:
    printed_page = descriptor["printedPage"]
    if printed_page is None:
        return f"{descriptor['logicalKey']}.png"
    return f"page-{int(printed_page):04d}.png"


def _render_logical_page_evidence(
    pdf_path: Path,
    run_directory: Path,
    descriptors: list[dict[str, Any]],
    *,
    dpi: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if dpi < MIN_EVIDENCE_DPI or dpi > MAX_EVIDENCE_DPI:
        raise SanyccesAnalysisError(
            f"evidence DPI must be between {MIN_EVIDENCE_DPI} and {MAX_EVIDENCE_DPI}"
        )
    pages_directory = run_directory / "logical-pages"
    sheets_directory = run_directory / "qa" / "contact-sheets"
    pages_directory.mkdir(mode=0o750)
    sheets_directory.mkdir(parents=True, mode=0o750)
    by_physical: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for descriptor in descriptors:
        by_physical[int(descriptor["physicalPage"])].append(descriptor)

    render_rows: list[dict[str, Any]] = []
    try:
        document = pdfium.PdfDocument(str(pdf_path))
    except Exception as error:
        raise SanyccesAnalysisError("reviewed Sanycces PDF could not be opened for rendering") from error
    try:
        for physical_page in sorted(by_physical):
            page = document[physical_page - 1]
            bitmap = None
            rendered = None
            try:
                bitmap = page.render(scale=dpi / 72.0)
                rendered = bitmap.to_pil().convert("RGB")
                split_x = int(round(rendered.width / 2))
                for descriptor in sorted(
                    by_physical[physical_page],
                    key=lambda item: (0 if item["side"] in {"full", "left"} else 1),
                ):
                    side = str(descriptor["side"])
                    if side == "left":
                        logical_image = rendered.crop((0, 0, split_x, rendered.height))
                    elif side == "right":
                        logical_image = rendered.crop((split_x, 0, rendered.width, rendered.height))
                    else:
                        logical_image = rendered.copy()
                    try:
                        relative_path = f"logical-pages/{_logical_image_name(descriptor)}"
                        target = run_directory / relative_path
                        logical_image.save(
                            target,
                            format="PNG",
                            optimize=False,
                            compress_level=9,
                        )
                        render_rows.append(
                            {
                                **descriptor,
                                "imagePath": relative_path,
                                "imageSha256": sha256_file(target),
                                "sizeBytes": target.stat().st_size,
                                "widthPixels": logical_image.width,
                                "heightPixels": logical_image.height,
                                "dpi": dpi,
                                "renderer": "pdfium",
                                "artifactRole": "visual_evidence_not_publishable_media",
                            }
                        )
                    finally:
                        logical_image.close()
            finally:
                if rendered is not None:
                    rendered.close()
                if bitmap is not None:
                    bitmap.close()
                page.close()
    finally:
        document.close()

    sheet_rows: list[dict[str, Any]] = []
    columns = 4
    rows_per_sheet = 3
    cell_width = 300
    cell_height = 430
    label_height = 30
    padding = 12
    font = ImageFont.load_default()
    for offset in range(0, len(render_rows), CONTACT_SHEET_PAGE_COUNT):
        chunk = render_rows[offset : offset + CONTACT_SHEET_PAGE_COUNT]
        sheet = Image.new(
            "RGB",
            (columns * cell_width, rows_per_sheet * cell_height),
            "white",
        )
        draw = ImageDraw.Draw(sheet)
        try:
            for index, row in enumerate(chunk):
                column = index % columns
                sheet_row = index // columns
                x0 = column * cell_width
                y0 = sheet_row * cell_height
                with Image.open(run_directory / row["imagePath"]) as source_image:
                    thumbnail = ImageOps.contain(
                        source_image.convert("RGB"),
                        (cell_width - (padding * 2), cell_height - label_height - (padding * 2)),
                        method=Image.Resampling.LANCZOS,
                    )
                try:
                    paste_x = x0 + (cell_width - thumbnail.width) // 2
                    paste_y = y0 + padding
                    sheet.paste(thumbnail, (paste_x, paste_y))
                finally:
                    thumbnail.close()
                page_label = (
                    str(row["logicalKey"])
                    if row["printedPage"] is None
                    else f"p. {int(row['printedPage'])}"
                )
                label = f"{page_label} · {row['section']} · {row['role']}"
                draw.text(
                    (x0 + padding, y0 + cell_height - label_height + 6),
                    label[:48],
                    fill=(30, 30, 30),
                    font=font,
                )
            first = chunk[0]["logicalKey"]
            last = chunk[-1]["logicalKey"]
            relative_path = f"qa/contact-sheets/contact-sheet-{(offset // CONTACT_SHEET_PAGE_COUNT) + 1:03d}.png"
            target = run_directory / relative_path
            sheet.save(target, format="PNG", optimize=False, compress_level=9)
            sheet_rows.append(
                {
                    "firstLogicalKey": first,
                    "lastLogicalKey": last,
                    "pageCount": len(chunk),
                    "imagePath": relative_path,
                    "imageSha256": sha256_file(target),
                    "sizeBytes": target.stat().st_size,
                    "reviewStatus": "pending_visual_review",
                }
            )
        finally:
            sheet.close()
    return render_rows, sheet_rows


def _stream_filter_name(stream: Any) -> str:
    if stream is None:
        return ""
    value = getattr(stream, "attrs", {}).get("Filter", "")
    return str(value).replace("/'", "").replace("'", "").replace("/", "")


def _extract_pdf_image_candidates(
    page: Any,
    descriptor: dict[str, Any],
    run_directory: Path,
    *,
    source_sha256: str,
    rights_confirmed: bool,
    minimum_long_side_pixels: int,
) -> list[dict[str, Any]]:
    if descriptor["role"] != "technical":
        return []
    page_width = float(page.width)
    side = str(descriptor["side"])
    origin_x = page_width / 2 if side == "right" else 0.0
    boundary_x0 = origin_x
    boundary_x1 = page_width if side in {"right", "full"} else page_width / 2
    assets_directory = run_directory / "pdf-image-candidates" / "assets"
    assets_directory.mkdir(parents=True, exist_ok=True, mode=0o750)
    rows: list[dict[str, Any]] = []
    images = sorted(
        page.images,
        key=lambda item: (
            float(item.get("top", 0)),
            float(item.get("x0", 0)),
            str(item.get("name", "")),
            tuple(item.get("srcsize", (0, 0))),
        ),
    )
    for occurrence, image in enumerate(images, start=1):
        x0 = float(image.get("x0", 0))
        x1 = float(image.get("x1", 0))
        center_x = (x0 + x1) / 2
        if not (boundary_x0 <= center_x <= boundary_x1):
            continue
        top = float(image.get("top", 0))
        bottom = float(image.get("bottom", 0))
        source_width, source_height = (int(value) for value in image.get("srcsize", (0, 0)))
        stream = image.get("stream")
        stream_filter = _stream_filter_name(stream)
        raw: bytes | None = None
        extraction_status = "unsupported_pdf_image_filter"
        reason_codes = ["unmapped_to_catalog_group", "manual_visual_review_required"]
        if stream is None:
            extraction_status = "missing_pdf_image_stream"
            reason_codes.append("missing_pdf_image_stream")
        elif "DCTDecode" not in stream_filter:
            reason_codes.append("unsupported_pdf_image_filter")
        else:
            try:
                raw = stream.get_rawdata()
                if not raw:
                    raise ValueError("empty image stream")
                with Image.open(BytesIO(raw)) as decoded:
                    if decoded.format != "JPEG":
                        raise ValueError("DCT stream is not a JPEG")
                    decoded_width, decoded_height = decoded.size
                if (decoded_width, decoded_height) != (source_width, source_height):
                    raise ValueError("PDF image dimensions do not match decoded JPEG")
                extraction_status = "extracted_original_jpeg"
                reason_codes.append("original_pdf_jpeg_extracted_without_resampling")
            except Exception:
                raw = None
                extraction_status = "invalid_pdf_jpeg_stream"
                reason_codes.append("invalid_pdf_jpeg_stream")

        source_image_sha256 = hashlib.sha256(raw).hexdigest() if raw is not None else None
        relative_path: str | None = None
        size_bytes: int | None = None
        if raw is not None and source_image_sha256 is not None:
            relative_path = f"pdf-image-candidates/assets/{source_image_sha256}.jpg"
            target = run_directory / relative_path
            if target.exists():
                if sha256_file(target) != source_image_sha256:
                    raise SanyccesAnalysisError("PDF image candidate hash collision")
            else:
                target.write_bytes(raw)
            size_bytes = target.stat().st_size

        if max(source_width, source_height) < minimum_long_side_pixels:
            reason_codes.append("below_reviewed_minimum_long_side")
        if not rights_confirmed:
            reason_codes.append("reuse_rights_not_confirmed_for_this_run")
        candidate_key = _text_sha256(
            "|".join(
                (
                    source_sha256,
                    str(descriptor["logicalKey"]),
                    str(occurrence),
                    f"{x0 - origin_x:.2f},{top:.2f},{x1 - origin_x:.2f},{bottom:.2f}",
                    source_image_sha256 or extraction_status,
                )
            )
        )
        rows.append(
            {
                "candidateKey": candidate_key,
                "sourceKind": "official_pdf_embedded_raster",
                "logicalKey": descriptor["logicalKey"],
                "printedPage": descriptor["printedPage"],
                "physicalPage": descriptor["physicalPage"],
                "side": side,
                "section": descriptor["section"],
                "pageRole": descriptor["role"],
                "occurrence": occurrence,
                "pdfObjectName": str(image.get("name", "")),
                "streamFilter": stream_filter,
                "placementBoxPoints": [
                    round(x0 - origin_x, 2),
                    round(top, 2),
                    round(x1 - origin_x, 2),
                    round(bottom, 2),
                ],
                "sourcePixels": {"width": source_width, "height": source_height},
                "sourceSha256": source_image_sha256,
                "filePath": relative_path,
                "mimeType": "image/jpeg" if raw is not None else None,
                "sizeBytes": size_bytes,
                "extractionStatus": extraction_status,
                "rightsConfirmed": rights_confirmed,
                "catalogInventorySource": "official_pdf",
                "mediaRole": "product_image_candidate",
                "mappingState": "unmapped",
                "proposedGroupKey": None,
                "proposedBaseReference": None,
                "proposedConfigurationTail": None,
                "mappingMethod": None,
                "approvalState": "needs_review",
                "finalMediaEligible": False,
                "reasonCodes": sorted(set(reason_codes)),
            }
        )
    return rows


def _normalized_words(page: Any, side: str) -> tuple[list[dict[str, Any]], float, float]:
    width = float(page.width)
    height = float(page.height)
    if side == "left":
        origin = 0.0
        selected = page.crop((0, 0, width / 2, height))
        logical_width = width / 2
    elif side == "right":
        origin = width / 2
        selected = page.crop((origin, 0, width, height))
        logical_width = width / 2
    else:
        origin = 0.0
        selected = page
        logical_width = width
    try:
        extracted = selected.extract_words(
            x_tolerance=3,
            y_tolerance=3,
            keep_blank_chars=False,
            use_text_flow=False,
        )
    except Exception as error:
        raise SanyccesAnalysisError("word geometry extraction failed") from error
    words = [
        {
            "text": str(word.get("text", "")).strip(),
            "x0": round(float(word["x0"]) - origin, 2),
            "y0": round(float(word["top"]), 2),
            "x1": round(float(word["x1"]) - origin, 2),
            "y1": round(float(word["bottom"]), 2),
        }
        for word in extracted
        if str(word.get("text", "")).strip()
    ]
    return words, round(logical_width, 2), round(height, 2)


def _header_groups(words: list[dict[str, Any]], adapter: dict[str, Any]) -> list[dict[str, Any]]:
    finish_codes = set(adapter["rules"]["finishCodes"])
    tolerance = float(adapter["rules"]["headerTopTolerancePoints"])
    headers = sorted(
        (word for word in words if word["text"] in finish_codes),
        key=lambda word: (word["y0"], word["x0"]),
    )
    groups: list[dict[str, Any]] = []
    for header in headers:
        if not groups or abs(float(header["y0"]) - float(groups[-1]["top"])) > tolerance:
            groups.append({"top": header["y0"], "headers": []})
        groups[-1]["headers"].append(
            {
                "code": header["text"],
                "center": round((float(header["x0"]) + float(header["x1"])) / 2, 2),
                "box": [header["x0"], header["y0"], header["x1"], header["y1"]],
            }
        )
    return groups


def _nearby_title(
    words: list[dict[str, Any]],
    header_top: float | None,
    adapter: dict[str, Any],
) -> str | None:
    if header_top is None:
        return None
    finish_codes = set(adapter["rules"]["finishCodes"])
    reference_pattern = re.compile(adapter["rules"]["referencePattern"])
    nearby = [
        word
        for word in words
        if header_top - 75 <= float(word["y0"]) < header_top - 3
        and word["text"] not in finish_codes
        and not reference_pattern.fullmatch(word["text"])
        and "Faucets Collection" not in word["text"]
    ]
    if not nearby:
        return None
    lines: list[list[dict[str, Any]]] = []
    for word in sorted(nearby, key=lambda item: (item["y0"], item["x0"])):
        if not lines or abs(float(word["y0"]) - float(lines[-1][0]["y0"])) > 2.5:
            lines.append([])
        lines[-1].append(word)
    selected = lines[-2:] if len(lines) > 1 else lines
    value = " / ".join(" ".join(item["text"] for item in line) for line in selected)
    value = re.sub(r"\s+", " ", value).strip(" /·")
    return value[:240] or None


def extract_matrix_observations(
    words: list[dict[str, Any]],
    *,
    adapter: dict[str, Any],
    printed_page: int,
    physical_page: int,
    side: str,
    section: str,
    page_role: str = "sku_matrix",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if page_role != "sku_matrix":
        return [], []
    words = [
        {
            **word,
            "y0": word.get("y0", word.get("top")),
            "y1": word.get("y1", word.get("bottom")),
        }
        for word in words
    ]
    reference_pattern = re.compile(adapter["rules"]["referencePattern"])
    finish_codes = list(adapter["rules"]["finishCodes"])
    allowed_tails = set(adapter["rules"]["allowedVariantTails"])
    tolerance = float(adapter["rules"]["columnTolerancePoints"])
    unqualified = dict(adapter["rules"].get("unqualifiedReferences", {}))
    context_only = dict(adapter["rules"].get("contextOnlyReferences", {}))
    groups = _header_groups(words, adapter)
    observations: list[dict[str, Any]] = []

    for word in words:
        raw = str(word["text"])
        if not reference_pattern.fullmatch(raw):
            continue
        center = (float(word["x0"]) + float(word["x1"])) / 2
        preceding = [group for group in groups if float(group["top"]) <= float(word["y0"])]
        header_group = max(preceding, key=lambda group: float(group["top"])) if preceding else None
        nearest = None
        distance = None
        if header_group:
            nearest = min(header_group["headers"], key=lambda item: abs(float(item["center"]) - center))
            distance = round(abs(float(nearest["center"]) - center), 2)

        reason_codes: list[str] = []
        relation_valid = False
        role = "unknown"
        tail: str | None = None
        catalog_disposition = "candidate"
        if raw in context_only:
            relation_valid = True
            role = "context_reference"
            catalog_disposition = "context_only"
            reason_codes.append("context_only_reference_resolved")
        elif raw in unqualified:
            relation_valid = True
            role = str(unqualified[raw])
            reason_codes.append("unqualified_reference_allowlisted")
        elif header_group is None or nearest is None:
            reason_codes.append("no_finish_header_above")
        elif distance is None or distance > tolerance:
            reason_codes.append("outside_finish_column_tolerance")
        else:
            finish = str(nearest["code"])
            match = re.fullmatch(rf".+{re.escape(finish)}(?P<tail>[A-Z0-9]*)", raw)
            if not match or match.group("tail") not in allowed_tails:
                reason_codes.append("finish_suffix_mismatch")
            else:
                relation_valid = True
                tail = match.group("tail")
                role = "kit_variant" if tail else "sellable_candidate"
                reason_codes.append("matrix_column_verified")

        box = [word["x0"], word["y0"], word["x1"], word["y1"]]
        evidence_key = _text_sha256(
            f"{printed_page}|{physical_page}|{side}|{raw}|" + ",".join(f"{float(value):.2f}" for value in box)
        )
        observations.append(
            {
                "evidenceKey": evidence_key,
                "reference": raw,
                "section": section,
                "printedPage": printed_page,
                "physicalPage": physical_page,
                "side": side,
                "box": box,
                "rawTextSha256": _text_sha256(raw),
                "nearestFinish": nearest["code"] if nearest else None,
                "columnDistancePoints": distance,
                "variantTail": tail,
                "relationValid": relation_valid,
                "entityRole": role,
                "catalogDisposition": catalog_disposition,
                "nearbyTitle": _nearby_title(words, float(header_group["top"]) if header_group else None, adapter),
                "reasonCodes": reason_codes,
            }
        )
    return sorted(observations, key=lambda item: (item["reference"], item["printedPage"], item["box"])), groups


def _expected_duplicate_headers(headers: list[str]) -> dict[str, list[int]]:
    positions: defaultdict[str, list[int]] = defaultdict(list)
    for position, header in enumerate(headers):
        positions[header].append(position)
    return {header: values for header, values in positions.items() if len(values) > 1}


def read_woo_snapshot(path: Path, adapter: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    expected = adapter["wooSnapshot"]
    digest = sha256_file(path)
    if digest != expected["sha256"] or path.stat().st_size != int(expected["sizeBytes"]):
        raise SanyccesAnalysisError("Woo export fingerprint does not match the reviewed adapter")
    try:
        with path.open("r", encoding=str(expected["encoding"]), newline="") as handle:
            rows = list(csv.reader(handle, delimiter=str(expected["delimiter"])))
    except (OSError, UnicodeError, csv.Error) as error:
        raise SanyccesAnalysisError("Woo export could not be read exactly") from error
    if not rows:
        raise SanyccesAnalysisError("Woo export is empty")
    headers, data = rows[0], rows[1:]
    if len(headers) != int(expected["columns"]) or len(data) != int(expected["dataRows"]):
        raise SanyccesAnalysisError("Woo export dimensions do not match the reviewed adapter")
    if any(len(row) != len(headers) for row in data):
        raise SanyccesAnalysisError("Woo export contains a row-width anomaly")
    for binding in expected["headerBindings"]:
        position = int(binding["position"])
        if headers[position] != binding["header"]:
            raise SanyccesAnalysisError(f"Woo positional header drift at column {position}")
    duplicates = _expected_duplicate_headers(headers)
    if duplicates != expected["duplicateHeaders"]:
        raise SanyccesAnalysisError("Woo duplicate-header positions do not match the reviewed adapter")

    positions = {binding["key"]: int(binding["position"]) for binding in expected["headerBindings"]}
    products: dict[str, dict[str, Any]] = {}
    duplicate_skus: list[str] = []
    product_types: Counter[str] = Counter()
    statuses: Counter[str] = Counter()
    brands: Counter[str] = Counter()
    seo = Counter()
    source_metadata = Counter()
    with_sku = 0
    with_global_id = 0
    with_image = 0

    for csv_row, row in enumerate(data, start=2):
        product_type = row[positions["productType"]].strip()
        status = row[positions["status"]].strip()
        brand = row[positions["brand"]].strip()
        product_types[product_type or "(empty)"] += 1
        statuses[status or "(empty)"] += 1
        if brand:
            brands[brand] += 1
        if row[positions["seoTitle"]].strip():
            seo["title"] += 1
        if row[positions["seoDescription"]].strip():
            seo["description"] += 1
        if row[positions["seoFocusKeyword"]].strip():
            seo["focusKeyword"] += 1
        if row[positions["sourceRefs"]].strip():
            source_metadata["sourceRefs"] += 1
        if row[positions["sourcePage"]].strip():
            source_metadata["sourcePage"] += 1
        sku = row[positions["sku"]].strip().upper()
        if row[positions["globalUniqueId"]].strip():
            with_global_id += 1
        if row[positions["imageFilename"]].strip():
            with_image += 1
        if not sku:
            continue
        with_sku += 1
        if sku in products:
            duplicate_skus.append(sku)
            continue
        products[sku] = {
            "csvRow": csv_row,
            "id": row[positions["id"]].strip(),
            "title": row[positions["title"]].strip(),
            "parentId": row[positions["parentId"]].strip(),
            "sku": row[positions["sku"]].strip(),
            "globalUniqueId": row[positions["globalUniqueId"]].strip(),
            "productType": product_type,
            "status": status,
            "stockStatus": row[positions["stockStatus"]].strip(),
            "brand": brand,
            "categories": row[positions["categories"]].strip(),
            "finish": row[positions["finish"]].strip(),
            "series": row[positions["series"]].strip(),
            "slug": row[positions["slug"]].strip(),
        }
    if duplicate_skus:
        raise SanyccesAnalysisError("Woo export contains duplicate non-empty SKUs")

    summary = {
        "sha256": digest,
        "sizeBytes": path.stat().st_size,
        "dataRows": len(data),
        "columns": len(headers),
        "rowWidthAnomalies": 0,
        "duplicateHeaders": duplicates,
        "duplicateSkus": 0,
        "withSku": with_sku,
        "withGlobalUniqueId": with_global_id,
        "withImageFilename": with_image,
        "productTypes": dict(sorted(product_types.items())),
        "statuses": dict(sorted(statuses.items())),
        "brands": dict(sorted(brands.items())),
        "seoFieldsPopulated": {
            "title": seo["title"],
            "description": seo["description"],
            "focusKeyword": seo["focusKeyword"],
        },
        "sourceMetadataPopulated": {
            "sourceRefs": source_metadata["sourceRefs"],
            "sourcePage": source_metadata["sourcePage"],
        },
    }
    return products, summary


def _aggregate_candidates(
    observations: list[dict[str, Any]],
    products: dict[str, dict[str, Any]],
    source_sha256: str,
) -> list[dict[str, Any]]:
    grouped: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        grouped[observation["reference"]].append(observation)
    candidates: list[dict[str, Any]] = []
    for reference in sorted(grouped):
        evidence = sorted(grouped[reference], key=lambda item: (item["printedPage"], item["box"]))
        exact = products.get(reference)
        all_valid = all(item["relationValid"] for item in evidence)
        dispositions = {item["catalogDisposition"] for item in evidence}
        if dispositions == {"context_only"}:
            status = "excluded_context"
            decision_reasons = ["resolved_context_only_reference"]
        elif exact is not None:
            status = "existing"
            decision_reasons = ["exact_sku_match_in_locked_export"]
        elif all_valid:
            status = "not_in_export"
            decision_reasons = ["absent_from_exact_sku_index", "all_matrix_observations_geometry_verified"]
        else:
            status = "needs_review"
            decision_reasons = sorted(
                {reason for item in evidence for reason in item["reasonCodes"] if reason != "matrix_column_verified"}
            ) or ["matrix_relation_unresolved"]
        roles = {item["entityRole"] for item in evidence}
        candidate_key = _text_sha256(f"{source_sha256}|{reference}")
        candidates.append(
            {
                "candidateKey": candidate_key,
                "reference": reference,
                "comparisonStatus": status,
                "entityRole": next(iter(roles)) if len(roles) == 1 else "unknown",
                "decisionReasons": decision_reasons,
                "sections": sorted({item["section"] for item in evidence}),
                "printedPages": sorted({item["printedPage"] for item in evidence}),
                "observationCount": len(evidence),
                "validObservationCount": sum(bool(item["relationValid"]) for item in evidence),
                "wooExactMatch": exact,
                "evidence": evidence,
                "authority": {
                    "confirmsNewProduct": False,
                    "canGenerateDraft": False,
                    "isCatalogInventoryReference": status not in {"excluded_context", "needs_review"},
                    "catalogInventorySource": "official_pdf",
                    "websiteRequiredForInventory": False,
                    "requiresCatalogModelReview": status in {"not_in_export", "needs_review"},
                },
            }
        )
    return candidates


def _catalog_group_identity(candidate: dict[str, Any]) -> tuple[str, str]:
    if candidate["entityRole"] in {"component", "context_reference"}:
        return str(candidate["reference"]), ""
    observation = next(
        (
            item
            for item in candidate["evidence"]
            if item["relationValid"]
            and item["catalogDisposition"] == "candidate"
            and item["nearestFinish"]
        ),
        None,
    )
    if observation is None:
        return str(candidate["reference"]), ""
    reference = str(candidate["reference"])
    finish = str(observation["nearestFinish"])
    tail = str(observation.get("variantTail") or "")
    suffix = finish + tail
    base = reference[: -len(suffix)] if suffix and reference.endswith(suffix) else reference
    if base.endswith(finish):
        base = base[: -len(finish)]
    return base or reference, tail


def group_catalog_references(
    candidates: list[dict[str, Any]],
    source_sha256: str,
) -> list[dict[str, Any]]:
    grouped: defaultdict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        grouped[_catalog_group_identity(candidate)].append(candidate)

    groups: list[dict[str, Any]] = []
    for (base_reference, configuration_tail), members in sorted(grouped.items()):
        statuses = {member["comparisonStatus"] for member in members}
        if statuses == {"excluded_context"}:
            status = "excluded_context"
        elif "needs_review" in statuses:
            status = "needs_review"
        elif statuses == {"existing"}:
            status = "fully_existing"
        elif "existing" in statuses:
            status = "partial_export_coverage"
        else:
            status = "absent_from_export"
        roles = {member["entityRole"] for member in members}
        role = next(iter(roles)) if len(roles) == 1 else "mixed"
        titles = sorted(
            {
                evidence["nearbyTitle"]
                for member in members
                for evidence in member["evidence"]
                if evidence["nearbyTitle"]
            }
        )
        groups.append(
            {
                "groupKey": _text_sha256(f"{source_sha256}|{base_reference}|{configuration_tail}"),
                "baseReference": base_reference,
                "configurationTail": configuration_tail,
                "groupStatus": status,
                "entityRole": role,
                "sections": sorted({section for member in members for section in member["sections"]}),
                "printedPages": sorted({page for member in members for page in member["printedPages"]}),
                "nearbyTitles": titles,
                "referenceCount": len(members),
                "references": {
                    name: sorted(member["reference"] for member in members if member["comparisonStatus"] == name)
                    for name in ("existing", "not_in_export", "excluded_context", "needs_review")
                },
                "authority": {
                    "isConfirmedProductEntity": False,
                    "isConfirmedNewProduct": False,
                    "isCatalogInventoryItem": status
                    in {"fully_existing", "partial_export_coverage", "absent_from_export"},
                    "catalogInventorySource": "official_pdf",
                    "websiteRequiredForInventory": False,
                    "canGenerateDraft": False,
                    "requiresCatalogModelReview": status
                    in {"absent_from_export", "partial_export_coverage", "needs_review"},
                },
            }
        )
    return groups


def build_section_breakdown(
    groups: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    page_rows: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    section_keys = sorted(
        {
            section
            for item in [*groups, *candidates]
            for section in item.get("sections", [])
            if section not in {"cover", "intro", "info", "unknown"}
        }
        | {
            str(row["section"])
            for row in page_rows
            if row["section"] not in {"cover", "intro", "info", "unknown"}
        }
    )
    breakdown: dict[str, dict[str, int]] = {}
    inventory_statuses = {"fully_existing", "partial_export_coverage", "absent_from_export"}
    for section in section_keys:
        section_groups = [item for item in groups if section in item.get("sections", [])]
        section_candidates = [item for item in candidates if section in item.get("sections", [])]
        section_pages = [row for row in page_rows if row["section"] == section]
        breakdown[section] = {
            "indexCards": sum(int(row.get("indexCardCount", 0)) for row in section_pages),
            "matrixPages": len({row["printedPage"] for row in section_pages if row["role"] == "sku_matrix"}),
            "matrixObservations": sum(
                int(row.get("matrixObservationCount", 0)) for row in section_pages if row["role"] == "sku_matrix"
            ),
            "uniqueReferences": len(section_candidates),
            "totalGroups": len(section_groups),
            "catalogInventoryGroups": sum(item["groupStatus"] in inventory_statuses for item in section_groups),
            "productCandidateGroups": sum(
                item["groupStatus"] in inventory_statuses
                and item["entityRole"] in {"sellable_candidate", "kit_variant"}
                for item in section_groups
            ),
            "sellableBaseGroups": sum(
                item["groupStatus"] in inventory_statuses and item["entityRole"] == "sellable_candidate"
                for item in section_groups
            ),
            "kitGroups": sum(
                item["groupStatus"] in inventory_statuses and item["entityRole"] == "kit_variant"
                for item in section_groups
            ),
            "componentGroups": sum(
                item["groupStatus"] in inventory_statuses and item["entityRole"] == "component"
                for item in section_groups
            ),
            "contextOnlyGroups": sum(item["groupStatus"] == "excluded_context" for item in section_groups),
            "needsReviewGroups": sum(item["groupStatus"] == "needs_review" for item in section_groups),
        }
    return breakdown


def verify_reviewed_section_expectation(
    section: str,
    breakdown: dict[str, dict[str, int]],
    adapter: dict[str, Any],
) -> dict[str, Any]:
    expected = dict(adapter.get("qualityGate", {}).get("reviewedSectionExpectations", {}).get(section, {}))
    actual = dict(breakdown.get(section, {}))
    mismatches = [
        {
            "metric": metric,
            "expected": value,
            "actual": actual.get(metric),
        }
        for metric, value in sorted(expected.items())
        if actual.get(metric) != value
    ]
    return {
        "section": section,
        "status": "verified" if expected and not mismatches else "drift",
        "method": "pdf_index_cards_plus_technical_matrix_reconciliation",
        "inventoryAuthority": "official_pdf",
        "websiteRequired": False,
        "expected": expected,
        "actual": actual,
        "mismatches": mismatches,
    }


def propose_reviewed_pdf_image_mappings(
    section: str,
    image_candidates: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    adapter: dict[str, Any],
) -> dict[str, Any]:
    candidate_by_reference = {item["reference"]: item for item in candidates}
    reviewed_pairs = [pair for pair in _matrix_pairs(adapter) if pair[0] == section]
    pair_rows: list[dict[str, Any]] = []
    mapped_keys: set[str] = set()

    def group_anchor(group: dict[str, Any], matrix_page: int) -> float:
        references = [
            reference
            for status in ("existing", "not_in_export", "needs_review")
            for reference in group["references"][status]
        ]
        y_values = [
            float(evidence["box"][1])
            for reference in references
            for evidence in candidate_by_reference.get(reference, {}).get("evidence", [])
            if int(evidence["printedPage"]) == matrix_page
        ]
        return min(y_values) if y_values else float("inf")

    for _, technical_page, matrix_page in reviewed_pairs:
        page_images = sorted(
            (
                item
                for item in image_candidates
                if item["section"] == section
                and int(item["printedPage"]) == technical_page
                and item["extractionStatus"] == "extracted_original_jpeg"
            ),
            key=lambda item: (float(item["placementBoxPoints"][1]), float(item["placementBoxPoints"][0])),
        )
        page_groups = sorted(
            (
                item
                for item in groups
                if section in item["sections"]
                and matrix_page in item["printedPages"]
                and item["groupStatus"] != "excluded_context"
            ),
            key=lambda item: (
                group_anchor(item, matrix_page),
                str(item["baseReference"]),
                str(item["configurationTail"]),
            ),
        )
        cardinality_matches = len(page_images) == len(page_groups) and bool(page_images)
        pair_rows.append(
            {
                "technicalPage": technical_page,
                "matrixPage": matrix_page,
                "imageCandidates": len(page_images),
                "catalogInventoryGroups": len(page_groups),
                "status": "mapped_by_vertical_order" if cardinality_matches else "cardinality_mismatch",
            }
        )
        if not cardinality_matches:
            for image in page_images:
                image["reasonCodes"] = sorted(set([*image["reasonCodes"], "mapping_cardinality_mismatch"]))
            continue
        for image, group in zip(page_images, page_groups, strict=True):
            image["mappingState"] = "proposed_needs_visual_review"
            image["proposedGroupKey"] = group["groupKey"]
            image["proposedBaseReference"] = group["baseReference"]
            image["proposedConfigurationTail"] = group["configurationTail"]
            image["mappingMethod"] = "paired_technical_matrix_vertical_order_equal_cardinality"
            image["reasonCodes"] = sorted(
                set(
                    [
                        reason
                        for reason in image["reasonCodes"]
                        if reason != "unmapped_to_catalog_group"
                    ]
                    + ["proposed_mapping_requires_visual_review"]
                )
            )
            mapped_keys.add(image["candidateKey"])

    extracted = [
        item
        for item in image_candidates
        if item["section"] == section and item["extractionStatus"] == "extracted_original_jpeg"
    ]
    actual = {
        "technicalMatrixPairs": len(pair_rows),
        "equalCardinalityPairs": sum(item["status"] == "mapped_by_vertical_order" for item in pair_rows),
        "cardinalityMismatchPairs": sum(item["status"] == "cardinality_mismatch" for item in pair_rows),
        "candidateImages": len(extracted),
        "mappedCandidates": len(mapped_keys),
        "unmappedCandidates": len(extracted) - len(mapped_keys),
    }
    expected = dict(
        adapter.get("mediaEvidence", {}).get("reviewedSectionMappingExpectations", {}).get(section, {})
    )
    mismatches = [
        {"metric": metric, "expected": value, "actual": actual.get(metric)}
        for metric, value in sorted(expected.items())
        if actual.get(metric) != value
    ]
    return {
        "section": section,
        "status": "verified" if expected and not mismatches else "drift",
        "scope": "reviewed_section_only_pattern_not_global",
        "method": "paired_technical_matrix_vertical_order_equal_cardinality",
        "expected": expected,
        "actual": actual,
        "pairs": pair_rows,
        "mismatches": mismatches,
        "finalMediaApproved": False,
    }


def _review_rows(candidates: list[dict[str, Any]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for candidate in candidates:
        exact = candidate["wooExactMatch"] or {}
        titles = sorted({item["nearbyTitle"] for item in candidate["evidence"] if item["nearbyTitle"]})
        rows.append(
            {
                "comparison_status": candidate["comparisonStatus"],
                "reference": candidate["reference"],
                "entity_role": candidate["entityRole"],
                "sections": "|".join(candidate["sections"]),
                "printed_pages": "|".join(str(value) for value in candidate["printedPages"]),
                "observation_count": str(candidate["observationCount"]),
                "valid_observation_count": str(candidate["validObservationCount"]),
                "decision_reasons": "|".join(candidate["decisionReasons"]),
                "nearby_titles": "|".join(titles[:3]),
                "woo_csv_row": str(exact.get("csvRow", "")),
                "woo_id": str(exact.get("id", "")),
                "woo_parent_id": str(exact.get("parentId", "")),
                "woo_product_type": str(exact.get("productType", "")),
                "woo_status": str(exact.get("status", "")),
                "woo_brand": str(exact.get("brand", "")),
                "woo_title": str(exact.get("title", "")),
            }
        )
    return rows


def _write_review_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fields = list(rows[0]) if rows else ["comparison_status", "reference"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _group_review_rows(groups: list[dict[str, Any]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for group in groups:
        rows.append(
            {
                "group_status": group["groupStatus"],
                "base_reference": group["baseReference"],
                "configuration_tail": group["configurationTail"],
                "entity_role": group["entityRole"],
                "sections": "|".join(group["sections"]),
                "printed_pages": "|".join(str(value) for value in group["printedPages"]),
                "nearby_titles": "|".join(group["nearbyTitles"][:3]),
                "reference_count": str(group["referenceCount"]),
                "existing_references": "|".join(group["references"]["existing"]),
                "not_in_export_references": "|".join(group["references"]["not_in_export"]),
                "excluded_context_references": "|".join(group["references"]["excluded_context"]),
                "needs_review_references": "|".join(group["references"]["needs_review"]),
            }
        )
    return rows


def _media_review_rows(candidates: list[dict[str, Any]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for candidate in candidates:
        pixels = candidate["sourcePixels"]
        box = candidate["placementBoxPoints"]
        rows.append(
            {
                "candidate_key": candidate["candidateKey"],
                "section": str(candidate["section"]),
                "printed_page": str(candidate["printedPage"]),
                "physical_page": str(candidate["physicalPage"]),
                "logical_side": str(candidate["side"]),
                "pdf_object_name": str(candidate["pdfObjectName"]),
                "placement_box_points": ",".join(f"{float(value):.2f}" for value in box),
                "source_width_pixels": str(pixels["width"]),
                "source_height_pixels": str(pixels["height"]),
                "source_sha256": str(candidate["sourceSha256"] or ""),
                "file_path": str(candidate["filePath"] or ""),
                "extraction_status": str(candidate["extractionStatus"]),
                "rights_confirmed": "yes" if candidate["rightsConfirmed"] else "no",
                "mapping_state": str(candidate["mappingState"]),
                "proposed_group_key": str(candidate["proposedGroupKey"] or ""),
                "proposed_base_reference": str(candidate["proposedBaseReference"] or ""),
                "proposed_configuration_tail": str(candidate["proposedConfigurationTail"] or ""),
                "mapping_method": str(candidate["mappingMethod"] or ""),
                "approval_state": str(candidate["approvalState"]),
                "final_media_eligible": "yes" if candidate["finalMediaEligible"] else "no",
                "reason_codes": "|".join(candidate["reasonCodes"]),
            }
        )
    return rows


def _render_pdf_image_contact_sheets(
    candidates: list[dict[str, Any]],
    run_directory: Path,
) -> list[dict[str, Any]]:
    review_directory = run_directory / "qa" / "pdf-image-candidates"
    review_directory.mkdir(parents=True, mode=0o750, exist_ok=True)
    sheet_rows: list[dict[str, Any]] = []
    columns = 5
    rows = 4
    page_size = columns * rows
    cell_width = 260
    cell_height = 280
    label_height = 44
    padding = 10
    font = ImageFont.load_default()
    sections = sorted({str(item["section"]) for item in candidates if item["filePath"]})
    for section in sections:
        section_candidates = sorted(
            (
                item
                for item in candidates
                if item["section"] == section and item["filePath"] is not None
            ),
            key=lambda item: (
                int(item["printedPage"]),
                float(item["placementBoxPoints"][1]),
                float(item["placementBoxPoints"][0]),
            ),
        )
        for offset in range(0, len(section_candidates), page_size):
            chunk = section_candidates[offset : offset + page_size]
            sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "white")
            draw = ImageDraw.Draw(sheet)
            try:
                for index, candidate in enumerate(chunk):
                    column = index % columns
                    sheet_row = index // columns
                    x0 = column * cell_width
                    y0 = sheet_row * cell_height
                    with Image.open(run_directory / str(candidate["filePath"])) as source:
                        preview = source.convert("RGB")
                    try:
                        preview.thumbnail(
                            (cell_width - (padding * 2), cell_height - label_height - (padding * 2)),
                            Image.Resampling.LANCZOS,
                        )
                        paste_x = x0 + (cell_width - preview.width) // 2
                        paste_y = y0 + padding + (
                            cell_height - label_height - (padding * 2) - preview.height
                        ) // 2
                        sheet.paste(preview, (paste_x, paste_y))
                    finally:
                        preview.close()
                    mapping = candidate["proposedBaseReference"] or "sin mapeo"
                    tail = candidate["proposedConfigurationTail"] or ""
                    pixels = candidate["sourcePixels"]
                    label = (
                        f"p. {candidate['printedPage']} · {mapping}{tail}\n"
                        f"{pixels['width']}x{pixels['height']} px · needs_review"
                    )
                    draw.multiline_text(
                        (x0 + padding, y0 + cell_height - label_height + 3),
                        label,
                        fill=(30, 30, 30),
                        font=font,
                        spacing=2,
                    )
                relative_path = (
                    f"qa/pdf-image-candidates/contact-sheet-{section}-"
                    f"{(offset // page_size) + 1:03d}.png"
                )
                target = run_directory / relative_path
                sheet.save(target, format="PNG", optimize=False, compress_level=9)
                sheet_rows.append(
                    {
                        "section": section,
                        "candidateCount": len(chunk),
                        "firstPrintedPage": chunk[0]["printedPage"],
                        "lastPrintedPage": chunk[-1]["printedPage"],
                        "imagePath": relative_path,
                        "imageSha256": sha256_file(target),
                        "sizeBytes": target.stat().st_size,
                        "sourcePixelsUpscaled": False,
                        "reviewStatus": "pending_visual_review",
                    }
                )
            finally:
                sheet.close()
    return sheet_rows


def _format_examples(candidates: list[dict[str, Any]], status: str, limit: int = 25) -> str:
    selected = [item["reference"] for item in candidates if item["comparisonStatus"] == status]
    if not selected:
        return "ninguna"
    suffix = " …" if len(selected) > limit else ""
    return ", ".join(f"`{value}`" for value in selected[:limit]) + suffix


def _report_markdown(analysis: dict[str, Any], candidates: list[dict[str, Any]]) -> str:
    summary = analysis["summary"]
    woo = analysis["wooSnapshot"]
    patterns = analysis["patternVerification"]
    groups = summary["catalogReferenceGroups"]
    absent_roles = summary["absentGroupRoles"]
    pool = analysis["poolDoubleCheck"]
    pool_actual = pool["actual"]
    pool_media = analysis["poolMediaMapping"]
    pool_media_actual = pool_media["actual"]
    rendering = analysis["evidenceRendering"]
    return f"""# Revisión reproducible del catálogo Sanycces de grifería 2026

## Dictamen

El PDF congelado es la **fuente de verdad del inventario de este catálogo**. El export Woo sigue siendo la fuente de verdad de lo que Enki tiene cargado en este snapshot. `not_in_export` demuestra que la referencia del PDF no aparece como SKU exacto en el export bloqueado, pero no decide por sí solo el modelado padre/variación, el surtido de Enki ni la publicación. La web oficial puede enriquecer copy o media y ayudar ante una ambigüedad; su ausencia nunca elimina un producto presente en el PDF.

## Fuentes congeladas

- PDF: `{analysis['sources']['pdf']['path']}` — SHA-256 `{analysis['sources']['pdf']['sha256']}` — {analysis['sources']['pdf']['physicalPages']} páginas físicas / {analysis['sources']['pdf']['logicalPages']} páginas lógicas.
- Woo CSV: `{analysis['sources']['woo']['path']}` — SHA-256 `{analysis['sources']['woo']['sha256']}` — {woo['dataRows']} filas / {woo['columns']} columnas.
- Adaptador: `{analysis['adapter']['key']}` `{analysis['adapter']['version']}` — SHA-256 `{analysis['adapter']['sha256']}`.

## Resultado del cruce exacto

- Referencias únicas observadas en matrices revisadas: **{summary['uniqueReferences']}**.
- SKU exacto ya existente: **{summary['candidateStatuses']['existing']}**.
- Ausente del índice SKU exacto, con geometría de matriz válida: **{summary['candidateStatuses']['not_in_export']}**.
- Referencia contextual excluida como producto: **{summary['candidateStatuses']['excluded_context']}**.
- Ambigüedad conservada para revisión: **{summary['candidateStatuses']['needs_review']}**.
- Páginas matriz revisadas: **{patterns['pairedTechnicalMatrix']['observedMatrixPages']} / {patterns['pairedTechnicalMatrix']['expectedMatrixPages']}**.

## Agrupación conservadora de referencias

- Grupos de referencia base + configuración: **{groups['total']}**.
- Completamente presentes en el export: **{groups['fully_existing']}**.
- Cobertura parcial de acabados: **{groups['partial_export_coverage']}**.
- Completamente ausentes del export: **{groups['absent_from_export']}**.
- Ausentes por función: vendible={absent_roles.get('sellable_candidate', 0)}, kit/configuración={absent_roles.get('kit_variant', 0)}, componente={absent_roles.get('component', 0)}.

Esta agrupación evita contar cada acabado como una ficha distinta, pero sigue sin afirmar que un grupo sea un padre Woo. Ese modelado se resuelve en la siguiente fase con el índice, la ficha técnica y la matriz del PDF.

## Doble check de la serie Pool

- Estado del gate: **{pool['status']}**.
- Tarjetas visuales observadas en el índice PDF 122–125: **{pool_actual.get('indexCards', 0)}**.
- Páginas matriz reconciliadas: **{pool_actual.get('matrixPages', 0)}**.
- Referencias exactas con acabado o función: **{pool_actual.get('uniqueReferences', 0)}**.
- Grupos totales: **{pool_actual.get('totalGroups', 0)}**.
- Elementos de inventario del PDF: **{pool_actual.get('catalogInventoryGroups', 0)}**.
- Candidatos de producto: **{pool_actual.get('productCandidateGroups', 0)}** = {pool_actual.get('sellableBaseGroups', 0)} base + {pool_actual.get('kitGroups', 0)} kits.
- Componentes técnicos separados: **{pool_actual.get('componentGroups', 0)}**.
- Menciones solo contextuales, excluidas del inventario de producto: **{pool_actual.get('contextOnlyGroups', 0)}**.

Por tanto, Pool no contiene diez productos: las diez son páginas de matriz. El recuento PDF-first reconciliado contiene 28 elementos de inventario y 24 candidatos de producto.

Ejemplos `not_in_export`: {_format_examples(candidates, 'not_in_export')}.

Ejemplos `needs_review`: {_format_examples(candidates, 'needs_review')}.

## Patrones comprobados y límites

- **Confirmado y acotado:** pares de página técnica + matriz para Dedal, Pool, Loop, Cubo y accesorios. Se aplica solo a las {patterns['pairedTechnicalMatrix']['expectedMatrixPages']} matrices declaradas por el adaptador.
- **Confirmado con condición:** una referencia debe caer bajo una cabecera de acabado compatible y su sufijo debe concordar. Páginas sin cabeceras: {len(patterns['pairedTechnicalMatrix']['pagesWithoutFinishHeaders'])}; páginas sin referencias: {len(patterns['pairedTechnicalMatrix']['pagesWithoutReferences'])}.
- **Patrón rechazado:** “toda página impar es una matriz”. Hay {patterns['parityAlone']['oddNonMatrixPagesWithSkuLikeTokens']} páginas impares fuera del alcance que también contienen tokens parecidos a SKU.
- **Patrón rechazado:** “una regex basta”. Las páginas técnicas contienen {patterns['regexAlone']['technicalSkuLikeTokenCount']} tokens alfanuméricos parecidos a referencia; se conservan solo como evidencia de exclusión.
- **Excepciones explícitas:** `ACCLV001` y `ACCLV003` son referencias sin sufijo de acabado; los cuerpos sanybox se clasifican como componentes; `BNCA006` y `ROC006` se excluyen como menciones de compatibilidad. Cada resolución conserva su página en el adaptador.

## Evidencia visual y candidatos de imagen

- Render de páginas lógicas: **{rendering['status']}**.
- Páginas renderizadas: **{rendering['logicalPages']}**.
- Hojas de contacto: **{rendering['contactSheets']}**.
- Objetos raster del PDF inventariados en fichas técnicas: **{rendering['pdfImageCandidates']}**.
- JPEG originales extraídos sin remuestreo: **{rendering['extractedOriginalJpegs']}**.
- Hojas de contacto de candidatos raster: **{rendering['pdfImageContactSheets']}**.
- Propuestas imagen↔grupo para Pool: **{pool_media_actual['mappedCandidates']} / {pool_media_actual['candidateImages']}**, con **{pool_media_actual['equalCardinalityPairs']} / {pool_media_actual['technicalMatrixPairs']}** pares técnica+matriz de cardinalidad exacta.

El patrón de mapeo vertical se ha aprobado **solo para Pool**; no se extrapola a Dedal, Loop, Cubo o accesorios, donde la cardinalidad difiere en varias páginas. Los objetos extraídos son evidencia/candidatos con `needs_review`; no se convierten en media final de Woo de forma automática. El manifiesto conserva página, caja, píxeles, hash, derechos declarados y motivos de bloqueo. Un candidato pequeño no se amplía.

## Calidad observada del export Woo

- Cabeceras duplicadas tratadas por posición: `{', '.join(sorted(woo['duplicateHeaders']))}`.
- SKU no vacíos: {woo['withSku']}; duplicados: {woo['duplicateSkus']}; anomalías de anchura: {woo['rowWidthAnomalies']}.
- Tipos: {json.dumps(woo['productTypes'], ensure_ascii=False, sort_keys=True)}.
- Estados: {json.dumps(woo['statuses'], ensure_ascii=False, sort_keys=True)}.
- Marcas: `Sanycces`={woo['brands'].get('Sanycces', 0)} y variante ortográfica `Sanycess`={woo['brands'].get('Sanycess', 0)}.
- SEO Yoast poblado: título={woo['seoFieldsPopulated']['title']}, descripción={woo['seoFieldsPopulated']['description']}, focus keyword={woo['seoFieldsPopulated']['focusKeyword']}.
- Evidencia de origen poblada: source refs={woo['sourceMetadataPopulated']['sourceRefs']}, source page={woo['sourceMetadataPopulated']['sourcePage']}.

## Cómo resolver lo pendiente

1. Revisar `product-group-review.csv`; prioriza grupos `absent_from_export` de tipo `sellable_candidate` y deja kits/componentes separados.
2. Resolver identidad, configuración y función desde las páginas de índice, ficha técnica y matriz del propio PDF. `candidate-review.csv` y `candidates.jsonl` conservan el SKU y la geometría originales.
3. Usar la web oficial solo como enriquecimiento opcional o contraste de una duda concreta; que una ficha no exista online no invalida el PDF.
4. Solo después, seleccionar de uno a cinco productos simples, mapear media revisada y crear un bundle gobernado. Este run no genera importación ni escribe en WooCommerce.
"""


def analyze_sanycces_products(
    workspace: DataWorkspace,
    *,
    run_id: str,
    adapter_path: Path | None = None,
    render_evidence: bool = False,
    evidence_dpi: int = DEFAULT_EVIDENCE_DPI,
    image_rights_confirmed: bool = False,
) -> dict[str, Any]:
    run_id = validate_run_id(run_id)
    if evidence_dpi < MIN_EVIDENCE_DPI or evidence_dpi > MAX_EVIDENCE_DPI:
        raise SanyccesAnalysisError(
            f"evidence DPI must be between {MIN_EVIDENCE_DPI} and {MAX_EVIDENCE_DPI}"
        )
    adapter, adapter_sha256 = load_sanycces_adapter(adapter_path)
    pdf_path = workspace.files["pdf"]
    woo_path = workspace.files["woo"]
    pdf_sha256 = sha256_file(pdf_path)
    source = adapter["source"]
    if pdf_sha256 != source["pdfSha256"] or pdf_path.stat().st_size != int(source["pdfSizeBytes"]):
        raise SanyccesAnalysisError("PDF fingerprint does not match the reviewed Sanycces adapter")
    products, woo_summary = read_woo_snapshot(woo_path, adapter)

    run_directory = workspace.output_root / run_id
    try:
        run_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise SanyccesAnalysisError("refusing to overwrite an existing Sanycces analysis run") from error
    except OSError as error:
        raise SanyccesAnalysisError("could not create the Sanycces analysis run") from error

    try:
        page_rows: list[dict[str, Any]] = []
        observations: list[dict[str, Any]] = []
        pdf_image_candidates: list[dict[str, Any]] = []
        descriptors = logical_page_descriptors(adapter)
        reference_pattern = re.compile(adapter["rules"]["referencePattern"])
        expected_matrix_pages = {matrix for _, _, matrix in _matrix_pairs(adapter)}
        pages_without_headers: list[int] = []
        pages_without_references: list[int] = []

        try:
            document = pdfplumber.open(pdf_path)
        except Exception as error:
            raise SanyccesAnalysisError("reviewed Sanycces PDF could not be opened") from error
        with document:
            if len(document.pages) != int(source["physicalPageCount"]):
                raise SanyccesAnalysisError("physical PDF page count drift")
            for descriptor in descriptors:
                page = document.pages[int(descriptor["physicalPage"]) - 1]
                words, width, height = _normalized_words(page, str(descriptor["side"]))
                sku_like = sorted({word["text"] for word in words if reference_pattern.fullmatch(word["text"])})
                page_observations: list[dict[str, Any]] = []
                header_groups: list[dict[str, Any]] = []
                if descriptor["role"] == "sku_matrix":
                    page_observations, header_groups = extract_matrix_observations(
                        words,
                        adapter=adapter,
                        printed_page=int(descriptor["printedPage"]),
                        physical_page=int(descriptor["physicalPage"]),
                        side=str(descriptor["side"]),
                        section=str(descriptor["section"]),
                    )
                    if not header_groups:
                        pages_without_headers.append(int(descriptor["printedPage"]))
                    if not page_observations:
                        pages_without_references.append(int(descriptor["printedPage"]))
                    observations.extend(page_observations)
                pdf_image_candidates.extend(
                    _extract_pdf_image_candidates(
                        page,
                        descriptor,
                        run_directory,
                        source_sha256=pdf_sha256,
                        rights_confirmed=image_rights_confirmed,
                        minimum_long_side_pixels=int(
                            adapter.get("mediaEvidence", {}).get("minimumLongSidePixels", 1200)
                        ),
                    )
                )
                word_fingerprint = json.dumps(words, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                page_rows.append(
                    {
                        **descriptor,
                        "widthPoints": width,
                        "heightPoints": height,
                        "wordCount": len(words),
                        "wordGeometrySha256": _text_sha256(word_fingerprint),
                        "skuLikeTokenCount": len(sku_like),
                        "skuLikeExamples": sku_like[:5],
                        "indexCardCount": sum(word["text"] == "p." for word in words)
                        if descriptor["role"] == "index"
                        else 0,
                        "finishHeaderGroupCount": len(header_groups),
                        "matrixObservationCount": len(page_observations),
                    }
                )

        render_rows: list[dict[str, Any]] = []
        contact_sheet_rows: list[dict[str, Any]] = []
        if render_evidence:
            render_rows, contact_sheet_rows = _render_logical_page_evidence(
                pdf_path,
                run_directory,
                descriptors,
                dpi=evidence_dpi,
            )
        render_by_key = {row["logicalKey"]: row for row in render_rows}
        for row in page_rows:
            rendered = render_by_key.get(row["logicalKey"])
            row.update(
                {
                    "renderPath": rendered["imagePath"] if rendered else None,
                    "renderSha256": rendered["imageSha256"] if rendered else None,
                    "renderWidthPixels": rendered["widthPixels"] if rendered else None,
                    "renderHeightPixels": rendered["heightPixels"] if rendered else None,
                    "renderDpi": rendered["dpi"] if rendered else None,
                }
            )

        candidates = _aggregate_candidates(observations, products, pdf_sha256)
        catalog_groups = group_catalog_references(candidates, pdf_sha256)
        section_breakdown = build_section_breakdown(catalog_groups, candidates, page_rows)
        pool_double_check = verify_reviewed_section_expectation("pool", section_breakdown, adapter)
        pool_media_mapping = propose_reviewed_pdf_image_mappings(
            "pool",
            pdf_image_candidates,
            catalog_groups,
            candidates,
            adapter,
        )
        media_contact_sheet_rows = _render_pdf_image_contact_sheets(
            pdf_image_candidates,
            run_directory,
        )
        status_counts = Counter(item["comparisonStatus"] for item in candidates)
        group_status_counts = Counter(item["groupStatus"] for item in catalog_groups)
        absent_group_roles = Counter(
            item["entityRole"] for item in catalog_groups if item["groupStatus"] == "absent_from_export"
        )
        technical_rows = [row for row in page_rows if row["role"] == "technical"]
        odd_non_matrix = [
            row
            for row in page_rows
            if isinstance(row["printedPage"], int)
            and row["printedPage"] % 2 == 1
            and row["role"] != "sku_matrix"
            and row["skuLikeTokenCount"] > 0
        ]
        technical_examples = sorted(
            {example for row in technical_rows for example in row["skuLikeExamples"]}
        )[:25]
        pattern_verification = {
            "pairedTechnicalMatrix": {
                "status": "verified" if not pages_without_headers and not pages_without_references else "partial",
                "expectedMatrixPages": len(expected_matrix_pages),
                "observedMatrixPages": sum(row["role"] == "sku_matrix" for row in page_rows),
                "pagesWithoutFinishHeaders": pages_without_headers,
                "pagesWithoutReferences": pages_without_references,
            },
            "parityAlone": {
                "status": "rejected_as_extraction_rule",
                "oddNonMatrixPagesWithSkuLikeTokens": len(odd_non_matrix),
                "evidencePages": [row["printedPage"] for row in odd_non_matrix[:25]],
            },
            "regexAlone": {
                "status": "rejected_as_extraction_rule",
                "technicalSkuLikeTokenCount": sum(row["skuLikeTokenCount"] for row in technical_rows),
                "examples": technical_examples,
            },
        }
        analysis = {
            "schema": ANALYSIS_SCHEMA,
            "runId": run_id,
            "runtime": {
                "name": "enki-catalog-pipeline",
                "version": PIPELINE_VERSION,
                "python": platform.python_version(),
                "extractor": {"name": "pdfplumber", "version": version("pdfplumber")},
                "renderer": {"name": "pypdfium2", "version": version("pypdfium2")}
                if render_evidence
                else None,
                "imageEncoder": {"name": "Pillow", "version": version("Pillow")},
            },
            "adapter": {
                "key": adapter["adapterKey"],
                "version": adapter["version"],
                "implementation": adapter["implementation"],
                "sha256": adapter_sha256,
            },
            "sources": {
                "pdf": {
                    "path": workspace.relative_files["pdf"],
                    "sha256": pdf_sha256,
                    "sizeBytes": pdf_path.stat().st_size,
                    "physicalPages": int(source["physicalPageCount"]),
                    "logicalPages": len(page_rows),
                },
                "woo": {
                    "path": workspace.relative_files["woo"],
                    "sha256": woo_summary["sha256"],
                    "sizeBytes": woo_path.stat().st_size,
                },
            },
            "wooSnapshot": woo_summary,
            "patternVerification": pattern_verification,
            "poolDoubleCheck": pool_double_check,
            "poolMediaMapping": pool_media_mapping,
            "evidenceRendering": {
                "status": "rendered" if render_evidence else "not_requested",
                "dpi": evidence_dpi if render_evidence else None,
                "logicalPages": len(render_rows),
                "contactSheets": len(contact_sheet_rows),
                "pdfImageCandidates": len(pdf_image_candidates),
                "pdfImageContactSheets": len(media_contact_sheet_rows),
                "extractedOriginalJpegs": sum(
                    item["extractionStatus"] == "extracted_original_jpeg"
                    for item in pdf_image_candidates
                ),
                "uniqueExtractedAssets": len(
                    {
                        item["sourceSha256"]
                        for item in pdf_image_candidates
                        if item["sourceSha256"] is not None
                    }
                ),
                "imageRightsConfirmedForRun": image_rights_confirmed,
                "mediaPolicy": "evidence_candidates_require_mapping_quality_and_visual_review",
            },
            "resolvedExceptions": adapter.get("resolvedExceptions", []),
            "summary": {
                "matrixObservations": len(observations),
                "uniqueReferences": len(candidates),
                "candidateStatuses": {
                    "existing": status_counts["existing"],
                    "not_in_export": status_counts["not_in_export"],
                    "excluded_context": status_counts["excluded_context"],
                    "needs_review": status_counts["needs_review"],
                },
                "catalogReferenceGroups": {
                    "total": len(catalog_groups),
                    "fully_existing": group_status_counts["fully_existing"],
                    "partial_export_coverage": group_status_counts["partial_export_coverage"],
                    "absent_from_export": group_status_counts["absent_from_export"],
                    "excluded_context": group_status_counts["excluded_context"],
                    "needs_review": group_status_counts["needs_review"],
                },
                "absentGroupRoles": dict(sorted(absent_group_roles.items())),
                "entityRoles": dict(sorted(Counter(item["entityRole"] for item in candidates).items())),
                "pageRoles": dict(sorted(Counter(row["role"] for row in page_rows).items())),
                "sectionBreakdown": section_breakdown,
            },
            "outputs": {
                "analysis": "analysis.json",
                "pages": "pages.jsonl",
                "candidates": "candidates.jsonl",
                "productGroups": "product-groups.jsonl",
                "reviewCsv": "candidate-review.csv",
                "productGroupReviewCsv": "product-group-review.csv",
                "logicalPageRenders": "logical-page-renders.jsonl",
                "contactSheets": "contact-sheets.jsonl",
                "pdfImageCandidates": "pdf-image-candidates.jsonl",
                "pdfImageCandidateReviewCsv": "pdf-image-candidate-review.csv",
                "pdfImageContactSheets": "pdf-image-contact-sheets.jsonl",
                "report": "report.md",
                "manifest": "artifact-manifest.json",
            },
            "authority": adapter["authority"],
        }

        _write_json(run_directory / "analysis.json", analysis)
        _write_jsonl(run_directory / "pages.jsonl", page_rows)
        _write_jsonl(run_directory / "candidates.jsonl", candidates)
        _write_jsonl(run_directory / "product-groups.jsonl", catalog_groups)
        _write_jsonl(run_directory / "logical-page-renders.jsonl", render_rows)
        _write_jsonl(run_directory / "contact-sheets.jsonl", contact_sheet_rows)
        _write_jsonl(run_directory / "pdf-image-candidates.jsonl", pdf_image_candidates)
        _write_jsonl(run_directory / "pdf-image-contact-sheets.jsonl", media_contact_sheet_rows)
        _write_review_csv(run_directory / "candidate-review.csv", _review_rows(candidates))
        _write_review_csv(run_directory / "product-group-review.csv", _group_review_rows(catalog_groups))
        _write_review_csv(
            run_directory / "pdf-image-candidate-review.csv",
            _media_review_rows(pdf_image_candidates),
        )
        (run_directory / "report.md").write_text(_report_markdown(analysis, candidates), encoding="utf-8")
        artifacts = []
        for target in sorted(path for path in run_directory.rglob("*") if path.is_file()):
            relative = target.relative_to(run_directory).as_posix()
            if relative == "artifact-manifest.json":
                continue
            artifacts.append(
                {
                    "path": relative,
                    "sha256": sha256_file(target),
                    "sizeBytes": target.stat().st_size,
                }
            )
        manifest = {
            "schema": "enki-local-artifact-manifest/v1",
            "runId": run_id,
            "adapterSha256": adapter_sha256,
            "sourceSha256": {"pdf": pdf_sha256, "woo": woo_summary["sha256"]},
            "artifacts": artifacts,
        }
        _write_json(run_directory / "artifact-manifest.json", manifest)
        return {
            "valid": pattern_verification["pairedTechnicalMatrix"]["status"] == "verified"
            and status_counts["needs_review"] == 0
            and pool_double_check["status"] == "verified"
            and pool_media_mapping["status"] == "verified",
            "schema": ANALYSIS_SCHEMA,
            "runId": run_id,
            "summary": analysis["summary"],
            "outputs": analysis["outputs"],
            "artifactManifestSha256": sha256_file(run_directory / "artifact-manifest.json"),
            "authority": analysis["authority"],
        }
    except Exception:
        shutil.rmtree(run_directory, ignore_errors=True)
        raise
