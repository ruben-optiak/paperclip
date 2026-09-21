from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageOps

from . import PIPELINE_VERSION
from .pipeline import sha256_file
from .safety import DataWorkspace, validate_run_id, validate_source_slug


class ProductMediaError(RuntimeError):
    """Raised when product media cannot be prepared under the approved profile."""


MIME_BY_FORMAT = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise ProductMediaError(f"{label} keys must be exactly: {', '.join(sorted(expected))}")


def load_media_profile(path: Path) -> dict[str, Any]:
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ProductMediaError("media profile must be readable JSON") from error
    if not isinstance(profile, dict):
        raise ProductMediaError("media profile must be one JSON object")
    _exact_keys(profile, {"schema", "profileKey", "version", "source", "output"}, "media profile")
    if profile["schema"] != "enki-product-media-profile/v1":
        raise ProductMediaError("unsupported media profile schema")
    validate_source_slug(profile["profileKey"])
    source = profile.get("source")
    output = profile.get("output")
    if not isinstance(source, dict) or not isinstance(output, dict):
        raise ProductMediaError("media profile source and output must be objects")
    _exact_keys(source, {"allowedMimeTypes", "minimumWidth", "minimumHeight", "rightsConfirmationRequired"}, "media profile source")
    _exact_keys(output, {"format", "width", "height", "fit", "background", "quality", "method", "allowUpscale", "stripMetadata"}, "media profile output")
    allowed = source["allowedMimeTypes"]
    if not isinstance(allowed, list) or not allowed or set(allowed) - set(MIME_BY_FORMAT.values()):
        raise ProductMediaError("media profile has unsupported source MIME types")
    if source["rightsConfirmationRequired"] is not True:
        raise ProductMediaError("media profile must require rights confirmation")
    for key in ("minimumWidth", "minimumHeight"):
        if not isinstance(source[key], int) or isinstance(source[key], bool) or not 1 <= source[key] <= 10000:
            raise ProductMediaError(f"media profile {key} is invalid")
    if output["format"] != "webp" or output["fit"] != "contain":
        raise ProductMediaError("v1 media output must be contain-fit WebP")
    for key in ("width", "height"):
        if not isinstance(output[key], int) or isinstance(output[key], bool) or not 256 <= output[key] <= 2400:
            raise ProductMediaError(f"media profile output {key} is invalid")
    if output["background"] != "transparent" and not (
        isinstance(output["background"], str)
        and len(output["background"]) == 7
        and output["background"].startswith("#")
        and all(character in "0123456789ABCDEF" for character in output["background"][1:])
    ):
        raise ProductMediaError("media profile background must be transparent or uppercase #RRGGBB")
    if not isinstance(output["quality"], int) or isinstance(output["quality"], bool) or not 1 <= output["quality"] <= 100:
        raise ProductMediaError("media profile WebP quality is invalid")
    if not isinstance(output["method"], int) or isinstance(output["method"], bool) or not 0 <= output["method"] <= 6:
        raise ProductMediaError("media profile WebP method is invalid")
    if output["allowUpscale"] is not False or output["stripMetadata"] is not True:
        raise ProductMediaError("v1 media profiles must forbid upscaling and strip metadata")
    return profile


def load_primary_image_policy(path: Path) -> dict[str, Any]:
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ProductMediaError("primary-image policy must be readable JSON") from error
    if not isinstance(policy, dict):
        raise ProductMediaError("primary-image policy must be one JSON object")
    _exact_keys(
        policy,
        {"schema", "policyKey", "version", "output", "contentDetection", "sourceClasses"},
        "primary-image policy",
    )
    if policy["schema"] != "enki-primary-product-image-policy/v1":
        raise ProductMediaError("unsupported primary-image policy schema")
    validate_source_slug(policy["policyKey"])
    output = policy.get("output")
    detection = policy.get("contentDetection")
    source_classes = policy.get("sourceClasses")
    if not isinstance(output, dict) or not isinstance(detection, dict) or not isinstance(source_classes, dict):
        raise ProductMediaError("primary-image policy sections must be objects")
    _exact_keys(
        output,
        {"format", "width", "height", "background", "quality", "method", "stripMetadata"},
        "primary-image policy output",
    )
    _exact_keys(
        detection,
        {"whiteThreshold", "paddingRatio", "targetContentFill"},
        "primary-image policy content detection",
    )
    if output["format"] != "webp" or output["background"] != "#FFFFFF" or output["stripMetadata"] is not True:
        raise ProductMediaError("primary images must be metadata-free WebP on #FFFFFF")
    for key in ("width", "height"):
        if not isinstance(output[key], int) or isinstance(output[key], bool) or not 256 <= output[key] <= 2400:
            raise ProductMediaError(f"primary-image output {key} is invalid")
    if not isinstance(output["quality"], int) or isinstance(output["quality"], bool) or not 1 <= output["quality"] <= 100:
        raise ProductMediaError("primary-image WebP quality is invalid")
    if not isinstance(output["method"], int) or isinstance(output["method"], bool) or not 0 <= output["method"] <= 6:
        raise ProductMediaError("primary-image WebP method is invalid")
    threshold = detection["whiteThreshold"]
    padding_ratio = detection["paddingRatio"]
    target_fill = detection["targetContentFill"]
    if not isinstance(threshold, int) or isinstance(threshold, bool) or not 0 <= threshold <= 50:
        raise ProductMediaError("primary-image white threshold is invalid")
    if not isinstance(padding_ratio, (int, float)) or isinstance(padding_ratio, bool) or not 0 <= padding_ratio <= 0.2:
        raise ProductMediaError("primary-image padding ratio is invalid")
    if not isinstance(target_fill, (int, float)) or isinstance(target_fill, bool) or not 0.5 <= target_fill <= 0.9:
        raise ProductMediaError("primary-image target content fill is invalid")
    if set(source_classes) != {"official", "pdf-derived"}:
        raise ProductMediaError("primary-image policy must define official and pdf-derived sources")
    for key, value in source_classes.items():
        if not isinstance(value, dict):
            raise ProductMediaError(f"primary-image source class {key} must be an object")
        _exact_keys(value, {"maxUpscale"}, f"primary-image source class {key}")
        maximum = value["maxUpscale"]
        if not isinstance(maximum, (int, float)) or isinstance(maximum, bool) or not 1 <= maximum <= 4:
            raise ProductMediaError(f"primary-image source class {key} max upscale is invalid")
    return policy


def _background(value: str) -> tuple[int, int, int, int]:
    if value == "transparent":
        return (0, 0, 0, 0)
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5)) + (255,)


def _flatten_white(image: Image.Image) -> Image.Image:
    normalized = ImageOps.exif_transpose(image).convert("RGBA")
    try:
        background = Image.new("RGBA", normalized.size, (255, 255, 255, 255))
        background.alpha_composite(normalized)
        return background
    finally:
        normalized.close()


def _content_bbox(image: Image.Image, threshold: int) -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    try:
        white = Image.new("RGB", rgb.size, "white")
        try:
            difference = ImageChops.difference(rgb, white)
        finally:
            white.close()
        try:
            red, green, blue = difference.split()
            try:
                first = ImageChops.lighter(red, green)
                try:
                    mask = ImageChops.lighter(first, blue)
                finally:
                    first.close()
                try:
                    thresholded = mask.point(lambda value: 255 if value > threshold else 0)
                    try:
                        bbox = thresholded.getbbox()
                    finally:
                        thresholded.close()
                finally:
                    mask.close()
            finally:
                red.close()
                green.close()
                blue.close()
        finally:
            difference.close()
    finally:
        rgb.close()
    if bbox is None:
        raise ProductMediaError("primary-image source contains no non-white product pixels")
    return bbox


def render_primary_product_image_candidate(
    source_path: Path,
    target: Path,
    policy: dict[str, Any],
    *,
    source_class: str,
) -> dict[str, Any]:
    """Reframe one white-background product cutout without changing geometry."""

    if source_class not in policy["sourceClasses"]:
        raise ProductMediaError(f"unsupported primary-image source class: {source_class}")
    output = policy["output"]
    detection = policy["contentDetection"]
    maximum_upscale = float(policy["sourceClasses"][source_class]["maxUpscale"])
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    try:
        with Image.open(source_path) as opened:
            source_format = opened.format
            source_mime = MIME_BY_FORMAT.get(source_format or "")
            if source_mime not in MIME_BY_FORMAT.values():
                raise ProductMediaError("primary-image source MIME is not supported")
            source_size = opened.size
            flattened = _flatten_white(opened)
        try:
            bbox = _content_bbox(flattened, detection["whiteThreshold"])
            product_width = bbox[2] - bbox[0]
            product_height = bbox[3] - bbox[1]
            padding = max(8, round(max(product_width, product_height) * detection["paddingRatio"]))
            crop_bbox = (
                max(0, bbox[0] - padding),
                max(0, bbox[1] - padding),
                min(flattened.width, bbox[2] + padding),
                min(flattened.height, bbox[3] + padding),
            )
            desired_scale = min(
                (output["width"] * detection["targetContentFill"]) / product_width,
                (output["height"] * detection["targetContentFill"]) / product_height,
            )
            applied_scale = min(desired_scale, maximum_upscale)
            crop = flattened.crop(crop_bbox)
            try:
                resized_size = (
                    max(1, round(crop.width * applied_scale)),
                    max(1, round(crop.height * applied_scale)),
                )
                resized = crop.resize(resized_size, Image.Resampling.LANCZOS)
                try:
                    canvas = Image.new("RGBA", (output["width"], output["height"]), (255, 255, 255, 255))
                    try:
                        offset = (
                            (canvas.width - resized.width) // 2,
                            (canvas.height - resized.height) // 2,
                        )
                        canvas.alpha_composite(resized, offset)
                        encoded = canvas.convert("RGB")
                        try:
                            encoded.save(
                                target,
                                format="WEBP",
                                quality=output["quality"],
                                method=output["method"],
                                exif=b"",
                                icc_profile=None,
                                xmp=b"",
                            )
                        finally:
                            encoded.close()
                    finally:
                        canvas.close()
                finally:
                    resized.close()
            finally:
                crop.close()
        finally:
            flattened.close()
        with Image.open(target) as rendered:
            rendered_bbox = _content_bbox(rendered, detection["whiteThreshold"])
            target_size = rendered.size
    except ProductMediaError:
        target.unlink(missing_ok=True)
        raise
    except Exception as error:
        target.unlink(missing_ok=True)
        raise ProductMediaError("primary-image source could not be reframed") from error

    return {
        "sourceMimeType": source_mime,
        "sourceWidth": source_size[0],
        "sourceHeight": source_size[1],
        "sourceContentBox": list(bbox),
        "desiredScale": round(desired_scale, 4),
        "appliedScale": round(applied_scale, 4),
        "upscaleCapped": applied_scale < desired_scale,
        "outputWidth": target_size[0],
        "outputHeight": target_size[1],
        "outputContentBox": list(rendered_bbox),
        "targetContentFill": round(
            max(
                (rendered_bbox[2] - rendered_bbox[0]) / target_size[0],
                (rendered_bbox[3] - rendered_bbox[1]) / target_size[1],
            ),
            4,
        ),
        "metadataStripped": True,
        "sizeBytes": target.stat().st_size,
    }


def render_product_media_candidate(
    source_path: Path,
    target: Path,
    profile: dict[str, Any],
) -> dict[str, Any]:
    """Render one already-authorized source under a validated media profile.

    The caller remains responsible for provenance, rights and the surrounding
    run manifest. Keeping the byte-producing operation here ensures single and
    batch preparation use the same deterministic encoder settings.
    """

    output = profile["output"]
    source_rules = profile["source"]
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    try:
        with Image.open(source_path) as opened:
            source_format = opened.format
            source_mime = MIME_BY_FORMAT.get(source_format or "")
            if source_mime not in source_rules["allowedMimeTypes"]:
                raise ProductMediaError("source image MIME is not allowed by the media profile")
            normalized = ImageOps.exif_transpose(opened).convert("RGBA")
            try:
                source_width, source_height = normalized.size
                if source_width < source_rules["minimumWidth"] or source_height < source_rules["minimumHeight"]:
                    raise ProductMediaError("source image is smaller than the approved minimum dimensions")
                scale = min(output["width"] / source_width, output["height"] / source_height, 1.0)
                resized_size = (max(1, round(source_width * scale)), max(1, round(source_height * scale)))
                resized = (
                    normalized
                    if resized_size == normalized.size
                    else normalized.resize(resized_size, Image.Resampling.LANCZOS)
                )
                try:
                    canvas = Image.new(
                        "RGBA",
                        (output["width"], output["height"]),
                        _background(output["background"]),
                    )
                    try:
                        offset = (
                            (output["width"] - resized.width) // 2,
                            (output["height"] - resized.height) // 2,
                        )
                        canvas.alpha_composite(resized, offset)
                        canvas.save(
                            target,
                            format="WEBP",
                            quality=output["quality"],
                            method=output["method"],
                            exact=True,
                            exif=b"",
                            icc_profile=None,
                            xmp=b"",
                        )
                    finally:
                        canvas.close()
                finally:
                    if resized is not normalized:
                        resized.close()
            finally:
                normalized.close()
    except ProductMediaError:
        target.unlink(missing_ok=True)
        raise
    except Exception as error:
        target.unlink(missing_ok=True)
        raise ProductMediaError("source image could not be decoded or encoded") from error

    return {
        "sourceMimeType": source_mime,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "outputWidth": output["width"],
        "outputHeight": output["height"],
        "contentWidth": resized_size[0],
        "contentHeight": resized_size[1],
        "upscaled": False,
        "metadataStripped": True,
        "sizeBytes": target.stat().st_size,
    }


def prepare_product_media(
    workspace: DataWorkspace,
    *,
    run_id: str,
    asset_key: str,
    alt_text: str,
    source_url: str,
    rights_confirmed: bool,
) -> dict[str, Any]:
    run_id = validate_run_id(run_id)
    asset_key = validate_source_slug(asset_key)
    alt_text = alt_text.strip()
    if not alt_text or len(alt_text) > 250 or "\n" in alt_text or "\r" in alt_text:
        raise ProductMediaError("alt text must be one non-empty line of at most 250 characters")
    if not source_url.startswith("https://"):
        raise ProductMediaError("source URL must use HTTPS")
    if rights_confirmed is not True:
        raise ProductMediaError("media rights must be explicitly confirmed")
    profile_path = workspace.files["profile"]
    source_path = workspace.files["source"]
    profile = load_media_profile(profile_path)
    output = profile["output"]
    source_rules = profile["source"]
    run_directory = workspace.output_root / run_id
    try:
        run_directory.mkdir(mode=0o750)
    except FileExistsError as error:
        raise ProductMediaError("refusing to overwrite an existing product-media run") from error
    except OSError as error:
        raise ProductMediaError("could not create product-media run") from error

    try:
        media_directory = run_directory / "media"
        media_directory.mkdir(mode=0o750)
        target = media_directory / f"{asset_key}.webp"
        rendered = render_product_media_candidate(source_path, target, profile)

        result = {
            "schema": "enki-product-media-result/v1",
            "runtimeVersion": PIPELINE_VERSION,
            "assetKey": asset_key,
            "source": {
                "path": workspace.relative_files["source"],
                "url": source_url,
                "sha256": sha256_file(source_path),
                "mimeType": rendered["sourceMimeType"],
                "width": rendered["sourceWidth"],
                "height": rendered["sourceHeight"],
                "rightsConfirmed": True,
            },
            "profile": {
                "path": workspace.relative_files["profile"],
                "profileKey": profile["profileKey"],
                "sha256": sha256_file(profile_path),
            },
            "output": {
                "path": f"media/{asset_key}.webp",
                "sha256": sha256_file(target),
                "mimeType": "image/webp",
                "width": rendered["outputWidth"],
                "height": rendered["outputHeight"],
                "contentWidth": rendered["contentWidth"],
                "contentHeight": rendered["contentHeight"],
                "upscaled": rendered["upscaled"],
                "metadataStripped": rendered["metadataStripped"],
                "alt": alt_text,
                "sizeBytes": rendered["sizeBytes"],
            },
        }
        (run_directory / "media-result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return result
    except Exception:
        shutil.rmtree(run_directory, ignore_errors=True)
        raise
