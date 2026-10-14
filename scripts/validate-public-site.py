#!/usr/bin/env python3
"""Offline validation of the public URL, canonical, sitemap, robots and link contract."""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://torgatlas.ru"


class LinksAndIds(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"])
        if tag == "a" and values.get("href"):
            self.links.append(values["href"])


def attr(html: str, name: str) -> str | None:
    match = re.search(rf'<meta[^>]+name=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']+)', html, re.I)
    return match.group(1) if match else None


def canonical(html: str) -> str | None:
    match = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', html, re.I)
    return match.group(1) if match else None


def route_for_source(source: str) -> str:
    return "/" if source == "index.html" else "/" + source.removesuffix("index.html")


def main() -> int:
    errors: list[str] = []
    registry = json.loads((ROOT / "content/public-pages.json").read_text(encoding="utf-8"))
    if registry.get("site_url") != SITE_URL:
        errors.append("registry site_url must equal production canonical host")
    pages = registry.get("pages", [])
    page_by_path = {page["path"]: page for page in pages}
    if len(page_by_path) != len(pages):
        errors.append("registry contains duplicate public paths")
    if len({page["source"] for page in pages}) != len(pages):
        errors.append("registry contains duplicate public sources")

    parsed: dict[str, LinksAndIds] = {}
    schemas: dict[str, list[object]] = {}
    for path, page in page_by_path.items():
        source = ROOT / page["source"]
        if not source.is_file():
            errors.append(f"{path}: registered source is missing: {page['source']}")
            continue
        html = source.read_text(encoding="utf-8")
        expected = SITE_URL + path
        if canonical(html) != expected:
            errors.append(f"{path}: canonical must be {expected}")
        robots = attr(html, "robots") or ""
        if "noindex" in robots.lower():
            errors.append(f"{path}: indexed registry page is marked noindex")
        if html.lower().count("<h1") != 1:
            errors.append(f"{path}: expected exactly one h1")
        reader = LinksAndIds()
        reader.feed(html)
        parsed[path] = reader
        schemas[path] = []
        for block in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.I | re.S):
            try:
                schemas[path].append(json.loads(block.strip()))
            except json.JSONDecodeError as error:
                errors.append(f"{path}: invalid JSON-LD: {error.msg}")

    def schema_types(value: object) -> set[str]:
        if not isinstance(value, dict):
            return set()
        nodes = value.get("@graph", [value])
        return {node.get("@type") for node in nodes if isinstance(node, dict) and isinstance(node.get("@type"), str)}

    required_schema = {
        "/": {"WebSite", "ProfessionalService"},
        "/o-torgatlas/": {"WebPage", "BreadcrumbList"},
        "/proverka-lota/": {"Service", "BreadcrumbList"},
        "/poisk-imushchestva/": {"Service", "BreadcrumbList"},
    }
    for route, expected_types in required_schema.items():
        actual_types = set().union(*(schema_types(block) for block in schemas.get(route, [])))
        missing = expected_types - actual_types
        if missing:
            errors.append(f"{route}: missing JSON-LD types: {', '.join(sorted(missing))}")

    def walk_json(value: object):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from walk_json(child)
        elif isinstance(value, list):
            for child in value:
                yield from walk_json(child)

    for route, blocks in schemas.items():
        for block in blocks:
            for node in walk_json(block):
                if node.get("@type") != "Organization":
                    continue
                if node.get("url") != f"{SITE_URL}/":
                    errors.append(f"{route}: Organization must use the canonical site URL")
                if node.get("logo") != f"{SITE_URL}/assets/og-card.png":
                    errors.append(f"{route}: Organization must declare the canonical logo")

    for source in ROOT.glob("**/index.html"):
        relative = source.relative_to(ROOT).as_posix()
        path = route_for_source(relative)
        html = source.read_text(encoding="utf-8")
        robots = attr(html, "robots") or ""
        if "noindex" not in robots.lower() and path not in page_by_path:
            errors.append(f"{path}: indexable page is absent from registry")

    sitemap = ROOT / "sitemap.xml"
    try:
        xml = ET.parse(sitemap).getroot()
        namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        entries = xml.findall("sm:url", namespace)
        actual = []
        for entry in entries:
            loc = entry.findtext("sm:loc", namespaces=namespace)
            lastmod = entry.findtext("sm:lastmod", namespaces=namespace)
            actual.append((loc, lastmod))
        expected = [(SITE_URL + page["path"], page.get("lastmod")) for page in pages]
        if actual != expected:
            errors.append("sitemap URLs or lastmod values differ from registry order")
    except ET.ParseError as error:
        errors.append(f"sitemap.xml is invalid XML: {error}")

    robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
    if f"Sitemap: {SITE_URL}/sitemap.xml" not in robots:
        errors.append("robots.txt must declare the canonical sitemap")
    if not re.search(r"(?im)^User-agent:\s*\*$", robots) or not re.search(r"(?im)^Allow:\s*/$", robots):
        errors.append("robots.txt must retain the public allow-all group")
    if re.search(r"(?im)^Disallow:\s*/\s*$", robots):
        errors.append("robots.txt blocks the entire public site")

    llms = ROOT / "llms.txt"
    if not llms.is_file() or "https://torgatlas.ru/o-torgatlas/" not in llms.read_text(encoding="utf-8"):
        errors.append("llms.txt must be a truthful public navigation file linking to /o-torgatlas/")

    known_paths = set(page_by_path) | {"/ai-poisk-lotov/", "/404.html"}
    for origin, reader in parsed.items():
        for href in reader.links:
            if href.startswith(("mailto:", "tel:", "javascript:", "data:")):
                continue
            target = urlparse(urljoin(SITE_URL + origin, href))
            if target.scheme and target.netloc and target.netloc != "torgatlas.ru":
                continue
            path = target.path or "/"
            if path.endswith("/index.html"):
                path = path.removesuffix("index.html")
            if path not in known_paths:
                errors.append(f"{origin}: broken internal link {href}")
                continue
            if target.fragment and path in parsed and target.fragment not in parsed[path].ids:
                errors.append(f"{origin}: missing anchor {href}")

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"PASS: {len(pages)} indexed canonical URLs; sitemap, robots and internal links are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
