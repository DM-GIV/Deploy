#!/usr/bin/env python3
"""Fail-closed scheduler for the OWNER_APPROVED_ONLY editorial queue."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "content/editorial/queue.json"
REQUIRED_GATES = {"demand", "official_sources", "editorial", "legal", "originality", "metadata", "interlinking", "tests"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_queue(path: Path = QUEUE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_queue(queue: dict, root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    if queue.get("mode") != "OWNER_APPROVED_ONLY":
        errors.append("mode must remain OWNER_APPROVED_ONLY")
    if queue.get("timezone") != "Europe/Moscow" or queue.get("cadence_days") != 3:
        errors.append("timezone/cadence must be Europe/Moscow and 3 days")
    ids: set[str] = set()
    routes: set[str] = set()
    for item in queue.get("items", []):
        if item.get("id") in ids:
            errors.append(f"duplicate id: {item.get('id')}")
        if item.get("route") in routes:
            errors.append(f"duplicate route: {item.get('route')}")
        ids.add(item.get("id"))
        routes.add(item.get("route"))
        source = root / item.get("source_path", "")
        if not source.is_file():
            errors.append(f"{item.get('id')}: source_path is missing")
            continue
        if item.get("status") == "OWNER_APPROVED":
            missing = REQUIRED_GATES - {key for key, passed in item.get("gates", {}).items() if passed is True}
            if missing:
                errors.append(f"{item['id']}: owner-approved item has failed gates: {sorted(missing)}")
            if not item.get("owner_approved_by") or not item.get("owner_approved_at"):
                errors.append(f"{item['id']}: explicit owner approval evidence is required")
            if digest(source) != item.get("content_sha256"):
                errors.append(f"{item['id']}: content changed after owner approval")
            html = source.read_text(encoding="utf-8")
            if 'name="robots" content="noindex,follow"' not in html:
                errors.append(f"{item['id']}: approved source must remain noindex until scheduled materialization")
        try:
            date.fromisoformat(item.get("scheduled_date", ""))
        except ValueError:
            errors.append(f"{item.get('id')}: invalid scheduled_date")
    return errors


def decision(queue: dict, at: datetime, root: Path = ROOT) -> dict:
    errors = validate_queue(queue, root)
    if errors:
        return {"status": "BLOCKED", "reason": "queue_validation_failed", "errors": errors}
    local_day = at.astimezone(ZoneInfo("Europe/Moscow")).date()
    last = queue.get("last_published_at")
    if last:
        last_day = datetime.fromisoformat(last).astimezone(ZoneInfo("Europe/Moscow")).date()
        next_day = last_day + timedelta(days=3)
        if local_day < next_day:
            return {"status": "SKIP", "reason": "cadence_window_not_open", "next_date": next_day.isoformat()}
    due = sorted(
        (item for item in queue.get("items", []) if item.get("status") == "OWNER_APPROVED" and date.fromisoformat(item["scheduled_date"]) <= local_day),
        key=lambda item: (item["scheduled_date"], item["id"]),
    )
    if not due:
        return {"status": "SKIP", "reason": "no_owner_approved_article", "date": local_day.isoformat()}
    item = due[0]
    return {"status": "READY", "article_id": item["id"], "route": item["route"], "date": local_day.isoformat(), "content_sha256": item["content_sha256"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=Path, default=QUEUE)
    parser.add_argument("--at", help="ISO-8601 instant; defaults to now")
    parser.add_argument("--log", type=Path, help="append JSONL decision log")
    args = parser.parse_args()
    queue = load_queue(args.queue)
    at = datetime.fromisoformat(args.at) if args.at else datetime.now(tz=ZoneInfo("Europe/Moscow"))
    if at.tzinfo is None:
        at = at.replace(tzinfo=ZoneInfo("Europe/Moscow"))
    result = decision(queue, at, args.queue.resolve().parents[2])
    record = {"observed_at": at.isoformat(), **result}
    if args.log:
        args.log.parent.mkdir(parents=True, exist_ok=True)
        with args.log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    print(json.dumps(record, ensure_ascii=False, sort_keys=True))
    return 1 if result["status"] == "BLOCKED" else 0


if __name__ == "__main__":
    raise SystemExit(main())

