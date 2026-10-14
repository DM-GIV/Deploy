#!/usr/bin/env python3
"""Build a compact weekly report while separating observations from hypotheses."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def rows(path: Path | None) -> list[dict[str, str]]:
    if not path or not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demand", type=Path)
    parser.add_argument("--geo", type=Path)
    parser.add_argument("--umami", type=Path)
    parser.add_argument("--leads", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    demand, geo, umami, leads = map(rows, (args.demand, args.geo, args.umami, args.leads))
    observed = {
        "confirmed_keyword_observations": len(demand),
        "geo_answer_observations": len(geo),
        "umami_rows": len(umami),
        "lead_rows": len(leads),
    }
    hypotheses = [
        "Рост покрытия тем может увеличить показы только после индексации и накопления спроса.",
        "Улучшение перелинковки может помочь обнаружению новых материалов; эффект требуется измерять.",
    ]
    report = {"schema": "torgatlas-growth-report-v1", "observed": observed, "hypotheses": hypotheses, "notes": ["Пустой источник остаётся пустым и не заменяется оценкой.", "Клик по контакту не считается полученной заявкой."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"status": "WRITTEN", "output": str(args.output), "observed": observed}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

