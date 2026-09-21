from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.product_media import (
    load_primary_image_policy,
    render_primary_product_image_candidate,
)
from enki_catalog_pipeline.sanycces_pool_media import POOL_MEDIA_SPECS


REVIEW_ORDER = (
    "COMO006SS",
    "COTE006SS",
    "BNEX006SS",
    "BNCA006SS",
    "MNO006SS",
    "MBD006SS",
    "ROC006SS",
    "ROT006SS",
    "RAC00012SS",
    "MEN006R14SS",
    "MEN006R18SS",
    "MEN006S14SS",
    "MEN006S18SS",
    "MOA006SS",
    "MEX006SS",
    "BNBB006SS",
    "MH2D006SS",
    "MH2D066SS",
    "TH2D006SS",
    "TH2D066SS",
    "DUE006SS",
    "MEN000SS",
    "MH2000SS",
    "TH2000SS",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _white_rgba(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", size, (255, 255, 255, 255))


def _flatten_white(image: Image.Image) -> Image.Image:
    normalized = ImageOps.exif_transpose(image).convert("RGBA")
    background = _white_rgba(normalized.size)
    background.alpha_composite(normalized)
    normalized.close()
    return background


def _render_candidate(
    source: Path,
    target: Path,
    *,
    policy: dict[str, Any],
    source_class: str,
) -> dict[str, Any]:
    rendered = render_primary_product_image_candidate(
        source,
        target,
        policy,
        source_class=source_class,
    )
    return {
        "source": str(source),
        "sourceSha256": _sha256(source),
        "sourceSize": {"width": rendered["sourceWidth"], "height": rendered["sourceHeight"]},
        "sourceContentBox": rendered["sourceContentBox"],
        "desiredScale": rendered["desiredScale"],
        "appliedScale": rendered["appliedScale"],
        "upscaleCapped": rendered["upscaleCapped"],
        "target": str(target),
        "targetSha256": _sha256(target),
        "targetSize": {"width": rendered["outputWidth"], "height": rendered["outputHeight"]},
        "targetContentBox": rendered["outputContentBox"],
        "targetContentFill": rendered["targetContentFill"],
        "sizeBytes": rendered["sizeBytes"],
    }


def _load_products(bundle_root: Path) -> dict[str, dict[str, Any]]:
    products: dict[str, dict[str, Any]] = {}
    for bundle_path in sorted(bundle_root.glob("*/product-draft-bundle.json")):
        payload = json.loads(bundle_path.read_text())
        for product in payload["products"]:
            sku = product["sku"]
            if sku in products:
                raise ValueError(f"duplicate Pool parent SKU: {sku}")
            products[sku] = {"bundleRoot": bundle_path.parent, "product": product}
    if set(products) != set(REVIEW_ORDER):
        raise ValueError("bundle root does not contain the exact 24 reviewed Pool parents")
    return products


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def _thumbnail(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as opened:
        flattened = _flatten_white(opened)
    flattened.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = _white_rgba(size)
    canvas.alpha_composite(
        flattened,
        ((size[0] - flattened.width) // 2, (size[1] - flattened.height) // 2),
    )
    flattened.close()
    return canvas


def _contact_sheets(
    rows: list[dict[str, Any]],
    output_dir: Path,
) -> list[dict[str, Any]]:
    page_size = 6
    width = 1_800
    header_height = 130
    row_height = 330
    label_width = 350
    thumb_size = (260, 260)
    column_x = (390, 730, 1_070, 1_410)
    sheets: list[dict[str, Any]] = []
    title_font = _font(30, bold=True)
    header_font = _font(23, bold=True)
    label_font = _font(21, bold=True)
    detail_font = _font(18)

    for page_index in range(math.ceil(len(rows) / page_size)):
        page_rows = rows[page_index * page_size:(page_index + 1) * page_size]
        canvas = Image.new("RGB", (width, header_height + row_height * len(page_rows)), "#F4F1EA")
        draw = ImageDraw.Draw(canvas)
        draw.text((36, 24), "Sanycces Pool · imágenes principales · antes / candidato", fill="#191919", font=title_font)
        headers = ("NB actual", "NB candidato", "RM actual", "RM candidato")
        for x, header in zip(column_x, headers, strict=True):
            draw.text((x, 78), header, fill="#4E4A43", font=header_font)

        for row_index, row in enumerate(page_rows):
            y = header_height + row_index * row_height
            draw.rectangle((20, y, width - 20, y + row_height - 12), fill="white", outline="#D9D3C8", width=2)
            draw.text((42, y + 34), row["sku"], fill="#191919", font=label_font)
            name = row["name"]
            if len(name) > 34:
                split_at = name.rfind(" ", 0, 34)
                split_at = 34 if split_at < 1 else split_at
                name_lines = (name[:split_at], name[split_at + 1:])
            else:
                name_lines = (name,)
            draw.multiline_text((42, y + 74), "\n".join(name_lines), fill="#4E4A43", font=detail_font, spacing=6)

            paths = (
                row["currentNb"],
                row["candidateNb"],
                row.get("currentRm"),
                row.get("candidateRm"),
            )
            for x, path in zip(column_x, paths, strict=True):
                if path is None:
                    draw.text((x + 80, y + 130), "No aplica", fill="#8A857C", font=detail_font)
                    continue
                thumb = _thumbnail(Path(path), thumb_size)
                try:
                    canvas.paste(thumb.convert("RGB"), (x, y + 36))
                finally:
                    thumb.close()

        target = output_dir / f"comparativa-{page_index + 1:02d}.jpg"
        canvas.save(target, format="JPEG", quality=92, optimize=True)
        canvas.close()
        sheets.append({"path": str(target), "sha256": _sha256(target), "products": [row["sku"] for row in page_rows]})
    return sheets


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare exact-pixel Pool primary-image review candidates.")
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--official-source-dir", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    policy = load_primary_image_policy(args.policy)
    products = _load_products(args.bundle_root)
    specs = {spec.sku: spec for spec in POOL_MEDIA_SPECS}
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o750)
    candidates_dir = args.output_dir / "candidates"
    rows: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []

    for sku in REVIEW_ORDER:
        entry = products[sku]
        product = entry["product"]
        bundle_dir = Path(entry["bundleRoot"])
        spec = specs[sku]
        current_nb = bundle_dir / product["images"][0]["path"]
        if spec.variable:
            source_nb = args.official_source_dir / f"{spec.asset_key}-nb.png"
            current_rm_image = next(image for image in product["images"] if not image["gallery"])
            current_rm = bundle_dir / current_rm_image["path"]
            source_rm = args.official_source_dir / f"{spec.asset_key}-rm.png"
            source_class = "official"
        else:
            source_nb = current_nb
            current_rm = None
            source_rm = None
            source_class = "pdf-derived"

        candidate_nb = candidates_dir / f"{sku.lower()}-nb.webp"
        nb_result = _render_candidate(source_nb, candidate_nb, policy=policy, source_class=source_class)
        nb_result.update({"sku": sku, "finish": "NB", "sourceKind": source_class})
        assets.append(nb_result)

        candidate_rm: Path | None = None
        if source_rm is not None:
            candidate_rm = candidates_dir / f"{sku.lower()}-rm.webp"
            rm_result = _render_candidate(source_rm, candidate_rm, policy=policy, source_class="official")
            rm_result.update({"sku": sku, "finish": "RM", "sourceKind": "official"})
            assets.append(rm_result)

        rows.append(
            {
                "sku": sku,
                "name": product["name"],
                "currentNb": str(current_nb),
                "candidateNb": str(candidate_nb),
                "currentRm": str(current_rm) if current_rm else None,
                "candidateRm": str(candidate_rm) if candidate_rm else None,
            }
        )

    sheets = _contact_sheets(rows, args.output_dir)
    manifest = {
        "schema": "enki-pool-primary-media-review/v1",
        "scope": {"parents": 24, "candidateImages": len(assets), "externalWrites": 0},
        "policy": {
            "path": str(args.policy),
            "sha256": _sha256(args.policy),
            "value": policy,
            "geometry": "uniform-scale-and-center-only",
        },
        "assets": assets,
        "contactSheets": sheets,
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n")

    readme = [
        "# Revisión de imágenes principales Sanycces Pool",
        "",
        "Este paquete no modifica WooCommerce ni los bundles aprobados.",
        "",
        f"- 24 productos revisados",
        f"- {len(assets)} imágenes candidatas (NB y RM cuando aplica)",
        "- fondo blanco 1000 × 1000",
        "- geometría preservada mediante escala uniforme y centrado",
        "- ampliación limitada para no inventar detalle",
        "- WebP calidad 92",
        "",
        "## Comparativas",
        "",
    ]
    for sheet in sheets:
        readme.append(f"- [{Path(sheet['path']).name}]({Path(sheet['path']).name}) — {', '.join(sheet['products'])}")
    readme.extend(
        [
            "",
            "Los productos cuyo factor necesario superaba el límite de ampliación quedan por debajo del 78 % objetivo y se marcan con `upscaleCapped: true` en `manifest.json`.",
            "",
        ]
    )
    (args.output_dir / "README.md").write_text("\n".join(readme))

    print(
        json.dumps(
            {
                "status": "complete",
                "parents": 24,
                "candidateImages": len(assets),
                "contactSheets": len(sheets),
                "externalWrites": 0,
                "manifest": str(manifest_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
