#!/usr/bin/env python3
"""Validate an owner-exported search-demand CSV and emit normalized rows.

This tool never authenticates to Wordstat/GSC/Yandex and never infers missing
frequency. The owner supplies an official export through --input.
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date, datetime
from pathlib import Path

FIELDS = ["query", "metric", "value", "region", "period_start", "period_end", "source", "source_url", "exported_at"]
SOURCES = {"wordstat_csv", "gsc_csv", "yandex_webmaster_csv", "search_suggest_manual", "serp_manual"}
NUMERIC_METRICS = {"monthly_frequency", "impressions", "clicks", "position", "ctr"}


def validate(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != FIELDS:
            raise ValueError(f"columns must be exactly: {','.join(FIELDS)}")
        rows = list(reader)
    errors: list[str] = []
    seen: set[tuple[str, str, str, str, str]] = set()
    for line, row in enumerate(rows, 2):
        row["query"] = " ".join(row["query"].split()).casefold()
        if not row["query"]:
            errors.append(f"line {line}: query is required")
        if row["source"] not in SOURCES:
            errors.append(f"line {line}: unsupported source {row['source']!r}")
        if row["metric"] not in NUMERIC_METRICS:
            errors.append(f"line {line}: unsupported metric {row['metric']!r}")
        try:
            value = float(row["value"])
            if value < 0:
                raise ValueError
        except ValueError:
            errors.append(f"line {line}: value must be a non-negative number")
        for field in ("period_start", "period_end"):
            try:
                date.fromisoformat(row[field])
            except ValueError:
                errors.append(f"line {line}: {field} must be YYYY-MM-DD")
        try:
            datetime.fromisoformat(row["exported_at"])
        except ValueError:
            errors.append(f"line {line}: exported_at must be ISO-8601 with timezone")
        if row["source"] in {"wordstat_csv", "gsc_csv", "yandex_webmaster_csv"} and not row["source_url"]:
            errors.append(f"line {line}: official export needs source_url or OWNER_EXPORT marker")
        key = (row["query"], row["metric"], row["region"], row["period_start"], row["source"])
        if key in seen:
            errors.append(f"line {line}: duplicate observation")
        seen.add(key)
    if errors:
        raise ValueError("\n".join(errors))
    return sorted(rows, key=lambda row: (row["query"], row["metric"], row["period_start"], row["source"]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        rows = validate(args.input)
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "REJECTED", "error": str(error)}, ensure_ascii=False))
        return 1
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        temporary.replace(args.output)
    print(json.dumps({"status": "ACCEPTED", "rows": len(rows), "output": str(args.output) if args.output else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

