"""HOTFIX-007 contract: fingerprinted assets, shared article containers, no future dates, new home offer."""
import datetime
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEW = ["kak-uchastvovat-v-torgah-po-bankrotstvu", "publichnoe-predlozhenie-bankrotstvo", "zadatok-na-torgah-po-bankrotstvu"]
OLD = ["kak-proverit-lot-pered-torgami", "kak-proverit-avtomobil-s-torgov", "kak-proverit-zemelnyi-uchastok-s-torgov"]


def page(slug):
    return (ROOT / "blog" / slug / "index.html").read_text(encoding="utf-8")


class UxHotfix(unittest.TestCase):
    def test_every_local_css_js_reference_is_fingerprinted_and_current(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/fingerprint-assets.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_articles_use_the_same_containers_as_the_reference_articles(self):
        for slug in OLD + NEW:
            html = page(slug)
            if slug in NEW:
                self.assertRegex(html, r'class="[^"]*\barticle-copy\b', slug)
            self.assertNotIn("post-wrap", html, slug)
            self.assertRegex(html, r'<link rel="stylesheet" href="/assets/seo\.css\?v=[a-f0-9]{12}">', slug)
            self.assertIn('class="wrap"', html, slug)

    def test_seo_css_has_no_orphan_post_wrap_and_centres_the_article(self):
        css = (ROOT / "assets/seo.css").read_text(encoding="utf-8")
        self.assertNotIn(".post-wrap", css)
        self.assertRegex(css, r"\.article-copy\{[^}]*max-width:760px;margin-inline:auto")

    def test_no_public_date_is_later_than_today_on_the_server(self):
        today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date()
        iso = re.compile(r"\b(20\d\d-\d\d-\d\d)\b")
        files = [ROOT / "sitemap.xml", ROOT / "content/public-pages.json"] + [ROOT / "blog" / s / "index.html" for s in NEW]
        for f in files:
            for d in iso.findall(f.read_text(encoding="utf-8")):
                self.assertLessEqual(datetime.date.fromisoformat(d), today, f"{f.name}: {d}")
        json.loads((ROOT / "content/public-pages.json").read_text(encoding="utf-8"))

    def test_home_offer_replaced_without_losing_commercial_ctas(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        h1 = re.search(r"<h1>(.*?)</h1>", html, re.S).group(1)
        text = re.sub(r"<[^>]+>", "", h1).replace("&nbsp;", " ")
        self.assertEqual(text, "От интересного лота до уверенного решения")
        self.assertIn("Помогаем найти имущество на торгах, разобраться в его стоимости, документах и условиях продажи, чтобы вы могли принять обоснованное решение о покупке", html)
        self.assertNotIn("без покупки вслепую", html)
        self.assertNotIn("с анализом цены и рисков", html)
        self.assertIn("hero-buttons", html)

    def test_social_cards_identical(self):
        self.assertEqual((ROOT / "assets/og-card.png").read_bytes(), (ROOT / "assets/torgatlas-social.png").read_bytes())


if __name__ == "__main__":
    unittest.main()
