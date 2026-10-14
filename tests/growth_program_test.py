from __future__ import annotations

import csv
import copy
import importlib.util
import json
import unittest
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


SCHEDULER = load_module("editorial_scheduler", ROOT / "scripts/editorial_scheduler.py")


class GrowthProgramTests(unittest.TestCase):
    def test_ninety_day_plan_has_thirty_three_day_slots(self):
        with (ROOT / "content/editorial/content-plan-90-days.csv").open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), 30)
        days = [date.fromisoformat(row["scheduled_date"]) for row in rows]
        self.assertTrue(all((right - left).days == 3 for left, right in zip(days, days[1:])))
        self.assertTrue(all(row["owner_approval"] == "REQUIRED" for row in rows))

    def test_unverified_seeds_do_not_invent_frequency(self):
        with (ROOT / "content/demand/semantic-seeds.csv").open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertGreaterEqual(len(rows), 30)
        self.assertTrue(all(row["status"] == "HYPOTHESIS_UNVERIFIED" for row in rows))
        self.assertTrue(all(not row["frequency"] and not row["frequency_unit"] for row in rows))
        with (ROOT / "content/demand/confirmed-keywords.csv").open(encoding="utf-8", newline="") as stream:
            self.assertEqual(list(csv.DictReader(stream)), [])

    def test_default_queue_skips_instead_of_publishing_draft(self):
        queue = SCHEDULER.load_queue()
        self.assertEqual(SCHEDULER.validate_queue(queue), [])
        result = SCHEDULER.decision(queue, datetime.fromisoformat("2026-10-18T09:00:00+03:00"))
        self.assertEqual(result, {"status": "SKIP", "reason": "no_owner_approved_article", "date": "2026-10-18"})

    def test_owner_approved_requires_every_gate_and_exact_hash(self):
        queue = copy.deepcopy(SCHEDULER.load_queue())
        item = queue["items"][0]
        item["status"] = "OWNER_APPROVED"
        item["owner_approved_by"] = "owner"
        item["owner_approved_at"] = "2026-10-17T12:00:00+03:00"
        blocked = SCHEDULER.decision(queue, datetime.fromisoformat("2026-10-18T09:00:00+03:00"))
        self.assertEqual(blocked["status"], "BLOCKED")
        item["gates"] = {key: True for key in SCHEDULER.REQUIRED_GATES}
        ready = SCHEDULER.decision(queue, datetime.fromisoformat("2026-10-18T09:00:00+03:00"))
        self.assertEqual(ready["status"], "READY")
        self.assertEqual(ready["article_id"], "deposit-guide-v1")

    def test_geo_matrix_has_bounded_question_set(self):
        with (ROOT / "content/geo-aeo/questions.csv").open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertGreaterEqual(len(rows), 15)
        self.assertLessEqual(len(rows), 30)
        self.assertEqual(len({row["question"] for row in rows}), len(rows))


if __name__ == "__main__":
    unittest.main()

