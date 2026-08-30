#!/usr/bin/env python3
"""Offline-only WordPress draft renderer for Enki Hogar AI OS v1."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path


def parse_post(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    metadata: dict[str, str] = {}
    body = text
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end < 0:
            raise ValueError("frontmatter without closing delimiter")
        for line in text[4:end].splitlines():
            key, separator, value = line.partition(":")
            if separator:
                metadata[key.strip()] = value.strip().strip('"')
        body = text[end + 5 :]
    return metadata, body.strip()


def render_markdown(markdown: str) -> str:
    rendered: list[str] = []
    for raw_line in markdown.splitlines():
        line = html.escape(raw_line)
        line = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
        if line.startswith("# "):
            rendered.append(f"<h1>{line[2:]}</h1>")
        elif line:
            rendered.append(f"<p>{line}</p>")
    return "\n".join(rendered)


def payload(path: Path) -> dict[str, str]:
    metadata, body = parse_post(path)
    return {
        "title": metadata.get("title", path.stem),
        "slug": metadata.get("slug", path.stem),
        "excerpt": metadata.get("excerpt", ""),
        "status": "draft",
        "content": render_markdown(body),
        "notice": "BORRADOR — NO PUBLICADO",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("render", "sync"))
    parser.add_argument("post", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = payload(args.post)
    if args.command == "sync" and not args.dry_run:
        parser.error("v1 blocks WordPress writes; use --dry-run")
    if args.command == "render":
        print(result["content"])
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
