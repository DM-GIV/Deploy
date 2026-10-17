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
        self.assertIn("METRIKA_ENABLED = true", js)
        self.assertEqual(js.count("COUNTER_ID = 113657048"), 1)
        self.assertIn("trackLinks: false", js)
        for banned in ("webvisor", "ecommerce", "userParams", "params(", "location.href,"):
            self.assertNotIn(banned, js.replace("Webvisor and ecommerce are not enabled", ""))
        self.assertEqual(sorted(re.findall(r"reachGoal", js)), ["reachGoal"])

    def test_every_page_has_banner_script_and_no_stray_counter_code(self):
        for name in pages():
            html = (ROOT / name).read_text(encoding="utf-8")
            self.assertEqual(len(re.findall(r'src="/assets/analytics\.js', html)), 1, name)
        js = (ROOT / "assets/metrika.js").read_text(encoding="utf-8")
        self.assertNotIn("noscript><div", js)
        self.assertNotIn("watch/113657048", js)

    def test_goal_identifiers(self):
        js = (ROOT / "assets/metrika.js").read_text(encoding="utf-8")
        goals = set(re.findall(r":\s*'([a-z_]+)',?\n", js.split("var GOALS")[1].split("};")[0] + "\n"))
        self.assertEqual(goals, {"ai_search_submit", "ai_search_results", "lot_source_click", "lead_form_start", "lead_submit_success", "contact_click"})

    def test_policy_roles_registry_and_consent_version(self):
        policy = (ROOT / "privacy/index.html").read_text(encoding="utf-8")
        self.assertIn("лицом, действующим по поручению Оператора", policy)
        self.assertIn("п. 5.4", policy)
        self.assertEqual(policy.count("https://yandex.ru/legal/metrica_termsofuse/"), 1)
        self.assertEqual(policy.count("https://yandex.ru/legal/confidential/"), 1)
        self.assertIn("https://yandex.ru/support/metrica/ru/general/cookie-usage.html", policy)
        self.assertEqual(policy.count("№ 100456724 от 12 октября 2026 года"), 2)
        self.assertEqual(policy.count("Утвержден приказ, в который входит данное уведомление об изменении"), 2)
        self.assertEqual(policy.count("приказ № 252 от 16 октября 2026 года"), 2)
        for goal in ("ведение кадрового и бухгалтерского учёта", "анализ посещаемости сайта torgatlas.ru, источников переходов, действий посетителей и конверсий с применением Яндекс Метрики", "подготовка, заключение и исполнение гражданско-правового договора"):
            self.assertIn(goal, policy)
        for banned in ("внесены в реестр", "отражены в реестре", "не подана", "повторная подача", "подано изменение", "Яндекс Метрика использует cookie (см. выше)"):
            self.assertNotIn(banned, policy)
        self.assertEqual(policy.count("документально не подтвержд"), 1)  # only Yandex-side retention (sec.9)
        self.assertIn("не удаляет данные, которые Яндекс уже получил", policy)
        consent = subprocess.check_output(["git", "show", "48cd39f:privacy/consent/index.html"], cwd=ROOT, text=True)
        now = (ROOT / "privacy/consent/index.html").read_text(encoding="utf-8")
        strip = lambda h: re.sub(r'<script src="/assets/(?:metrika|analytics)\.js[^"]*" defer></script>', "", h)
        self.assertEqual(strip(now), strip(consent), "consent text of version 2026-10-12.2 must not change")


if __name__ == "__main__":
    unittest.main()
