#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from enki_catalog_pipeline.sanycces_pool_media import (  # noqa: E402
    PoolMediaError,
    _official_url,
    prepare_pool_media_review,
)


def fetch_official_image(url: str, target: Path) -> dict[str, object]:
    """Fetch one allowlisted Sanycces asset before the networkless render phase."""

    if not _official_url(url):
        raise PoolMediaError(f"refusing non-official media URL: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "EnkiHogarCatalogQA/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            final_url = response.geturl()
            if not _official_url(final_url):
                raise PoolMediaError(f"official media redirected outside Sanycces: {url}")
            payload = response.read(25_000_001)
            content_type = response.headers.get_content_type()
    except PoolMediaError:
        raise
    except Exception as error:
        raise PoolMediaError(f"could not download official media: {url}") from error
    if len(payload) > 25_000_000 or not payload:
        raise PoolMediaError(f"official media has an unsafe size: {url}")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    target.write_bytes(payload)
    try:
        with Image.open(target) as image:
            image.verify()
        with Image.open(target) as image:
            width, height = image.size
            source_format = image.format
    except Exception as error:
        target.unlink(missing_ok=True)
        raise PoolMediaError(f"official media is not a decodable image: {url}") from error
    return {
        "sourceUrl": url,
        "finalUrl": final_url,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "contentType": content_type,
        "format": source_format,
        "width": width,
        "height": height,
        "sizeBytes": len(payload),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare the reviewed Sanycces Pool NB/RM and dimensions media package.")
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--source-bundles", type=Path, required=True)
    parser.add_argument("--source-media-manifest", type=Path, required=True)
    parser.add_argument("--official-page-audit", type=Path, required=True)
    parser.add_argument("--media-profile", type=Path, required=True)
    parser.add_argument("--output-review", type=Path, required=True)
    parser.add_argument("--output-bundles", type=Path, required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument("--rights-confirmed", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = prepare_pool_media_review(
        pdf_path=args.pdf.resolve(),
        source_bundles=args.source_bundles.resolve(),
        source_media_manifest_path=args.source_media_manifest.resolve(),
        official_page_audit_path=args.official_page_audit.resolve(),
        media_profile_path=args.media_profile.resolve(),
        output_review=args.output_review.resolve(),
        output_bundles=args.output_bundles.resolve(),
        created_at=args.created_at,
        rights_confirmed=args.rights_confirmed,
        fetch_official_image=fetch_official_image,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
