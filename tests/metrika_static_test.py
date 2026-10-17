import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def pages():
    names = subprocess.check_output(["git", "ls-files", "*.html"], cwd=ROOT, text=True).split()
    return [n for n in names if not n.startswith("tests/")]


class MetrikaStaticTest(unittest.TestCase):
    def test_every_public_page_has_exactly_one_loader_in_head(self):
        for name in pages():
            html = (ROOT / name).read_text(encoding="utf-8")
            head = html.split("</head>")[0]
            self.assertEqual(len(re.findall(r'<script src="/assets/metrika\.js(?:\?v=[0-9a-f]{12})?" defer></script>', head)), 1, name)
            self.assertEqual(html.count("metrika.js"), 1, name)

    def test_no_inline_snippet_or_noscript_pixel_on_pages(self):
        for name in pages():
            html = (ROOT / name).read_text(encoding="utf-8")
            for banned in ("mc.yandex.ru", "ym(113657048", "watch/113657048"):
                self.assertNotIn(banned, html, f"{name}: {banned}")

    def test_loader_is_off_by_default_and_privacy_safe(self):
        js = (ROOT / "assets/metrika.js").read_text(encoding="utf-8")
        self.assertIn("METRIKA_ENABLED = false", js)
        self.assertEqual(js.count("COUNTER_ID = 113657048"), 1)
        self.assertIn("trackLinks: false", js)
        for banned in ("webvisor", "ecommerce", "userParams", "params(", "location.href,"):
            self.assertNotIn(banned, js.replace("Webvisor and ecommerce are not enabled", ""))
        self.assertEqual(sorted(re.findall(r"reachGoal", js)), ["reachGoal"])

    def test_goal_identifiers(self):
        js = (ROOT / "assets/metrika.js").read_text(encoding="utf-8")
        goals = set(re.findall(r":\s*'([a-z_]+)',?\n", js.split("var GOALS")[1].split("};")[0] + "\n"))
        self.assertEqual(goals, {"ai_search_submit", "ai_search_results", "lot_source_click", "lead_form_start", "lead_submit_success", "contact_click"})


if __name__ == "__main__":
    unittest.main()
