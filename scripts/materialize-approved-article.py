#!/usr/bin/env python3
"""Materialize one scheduler-approved article into the static public registry.

Dry-run is the default. --apply only changes Git files; it never commits, pushes,
deploys, calls a production API, or submits a URL to a search engine.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from editorial_scheduler import QUEUE, ROOT, decision, load_queue


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=Path, default=QUEUE)
    parser.add_argument("--at", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    at = datetime.fromisoformat(args.at)
    if at.tzinfo is None:
        at = at.replace(tzinfo=ZoneInfo("Europe/Moscow"))
    queue = load_queue(args.queue)
    root = args.queue.resolve().parents[2]
    result = decision(queue, at, root)
    if result.get("status") != "READY":
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 1 if result.get("status") == "BLOCKED" else 0
    item = next(row for row in queue["items"] if row["id"] == result["article_id"])
    registry_path = root / "content/public-pages.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    existing = next((row for row in registry["pages"] if row["path"] == item["route"]), None)
    if existing:
        print(json.dumps({"status": "ALREADY_MATERIALIZED", "article_id": item["id"], "route": item["route"]}, ensure_ascii=False))
        return 0
    preview = {"status": "DRY_RUN", "article_id": item["id"], "route": item["route"], "lastmod": result["date"]}
    if not args.apply:
        print(json.dumps(preview, ensure_ascii=False, sort_keys=True))
        return 0
    source = root / item["source_path"]
    html = source.read_text(encoding="utf-8")
    before = 'name="robots" content="noindex,follow"'
    after = 'name="robots" content="index,follow,max-image-preview:large"'
    if html.count(before) != 1:
        raise RuntimeError("article must contain exactly one noindex robots directive")
    temporary = source.with_suffix(".html.tmp")
    temporary.write_text(html.replace(before, after), encoding="utf-8")
    temporary.replace(source)
    registry["pages"].append({"path": item["route"], "source": item["source_path"], "lastmod": result["date"]})
    atomic_json(registry_path, registry)
    subprocess.run(["python3", "scripts/generate-sitemap.py"], cwd=root, check=True)
    item["status"] = "STAGED_FOR_RELEASE"
    item["staged_at"] = at.isoformat()
    queue["last_published_at"] = at.isoformat()
    atomic_json(args.queue, queue)
    print(json.dumps({**preview, "status": "STAGED_FOR_RELEASE"}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

