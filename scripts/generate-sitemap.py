#!/usr/bin/env python3
"""Generate sitemap.xml from the canonical public-page registry.

An omitted lastmod is intentional: it means no confirmed substantive-change date
is available. Never substitute a filesystem mtime or the generation date.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "content/public-pages.json"
SITEMAP = ROOT / "sitemap.xml"


def load_registry() -> dict:
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
    site_url = data.get("site_url")
    pages = data.get("pages")
    if not isinstance(site_url, str) or not site_url.startswith("https://"):
        raise ValueError("site_url must be an absolute HTTPS URL")
    if not isinstance(pages, list) or not pages:
        raise ValueError("pages must be a non-empty list")
    paths = set()
    for page in pages:
        path = page.get("path")
        if not isinstance(path, str) or not path.startswith("/") or not path.endswith("/") and path != "/":
            raise ValueError(f"invalid canonical path: {path!r}")
        if path in paths:
            raise ValueError(f"duplicate canonical path: {path}")
        paths.add(path)
        if not isinstance(page.get("source"), str):
            raise ValueError(f"missing source for {path}")
        if "lastmod" in page:
            try:
                date.fromisoformat(page["lastmod"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"invalid lastmod for {path}") from error
    return data


def render(data: dict) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for page in data["pages"]:
        loc = escape(data["site_url"].rstrip("/") + page["path"])
        line = f"  <url><loc>{loc}</loc>"
        if "lastmod" in page:
            line += f"<lastmod>{page['lastmod']}</lastmod>"
        lines.append(line + "</url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when sitemap.xml is not generated from the registry")
    args = parser.parse_args()
    expected = render(load_registry())
    if args.check:
        actual = SITEMAP.read_text(encoding="utf-8") if SITEMAP.exists() else ""
        if actual != expected:
            print("sitemap.xml is stale; run python3 scripts/generate-sitemap.py", file=sys.stderr)
            return 1
        return 0
    SITEMAP.write_text(expected, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
