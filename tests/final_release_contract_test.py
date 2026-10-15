from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FinalReleaseContractTests(unittest.TestCase):
    def test_contact_panels_are_accessible_and_unconfirmed_channels_are_inert(self):
        pages = [
            ROOT / "index.html",
            ROOT / "proverka-lota/index.html",
            ROOT / "poisk-imushchestva/index.html",
            ROOT / "soprovozhdenie-torgov/index.html",
            ROOT / "pokupka-imushchestva/index.html",
        ]
        for page in pages:
            html = page.read_text(encoding="utf-8")
            self.assertIn('href="tel:+79800512327"', html, page)
            self.assertIn('href="mailto:dmitry.g.iv@yandex.ru"', html, page)
            self.assertIn('href="https://t.me/Dmitry_G_Iv"', html, page)
            self.assertIn('aria-label="Скопировать номер для MAX"', html, page)
            self.assertIn('aria-label="VK — официальный профиль ещё не подтверждён"', html, page)
            self.assertNotIn('href="https://vk.com/', html, page)
            self.assertNotIn('href="https://dzen.ru/', html, page)
            self.assertIn('data-contact-status aria-live="polite"', html, page)
        channels = json.loads((ROOT / "content/contact-channels.json").read_text(encoding="utf-8"))
        by_id = {channel["id"]: channel for channel in channels["channels"]}
        self.assertFalse(by_id["vk"]["confirmed"])
        self.assertFalse(by_id["dzen"]["confirmed"])

    def test_service_links_have_distinct_accessible_text(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("Подробнее об услуге", html)
        for phrase in ["проверке лота", "поиске имущества", "сопровождении торгов", "покупке имущества"]:
            self.assertIn(phrase, html)

    def test_intro_article_is_owner_only_noindex_and_absent_from_public_registry(self):
        route = "/blog/o-chem-budem-pisat-v-torgatlas/"
        html = (ROOT / "blog/o-chem-budem-pisat-v-torgatlas/index.html").read_text(encoding="utf-8")
        self.assertIn('name="robots" content="noindex,follow"', html)
        self.assertEqual(html.count("<h1>"), 1)
        self.assertIn('"@type":"BlogPosting"', html)
        queue = json.loads((ROOT / "content/editorial/queue.json").read_text(encoding="utf-8"))
        item = next(item for item in queue["items"] if item["route"] == route)
        self.assertEqual(item["status"], "DRAFT_FOR_OWNER_APPROVAL")
        self.assertIsNone(item["owner_approved_at"])
        public_pages = json.loads((ROOT / "content/public-pages.json").read_text(encoding="utf-8"))
        self.assertNotIn(route, json.dumps(public_pages, ensure_ascii=False))
        self.assertNotIn(route, (ROOT / "sitemap.xml").read_text(encoding="utf-8"))

    def test_video_is_optional_and_player_loads_only_after_click(self):
        schema = json.loads((ROOT / "content/editorial/content-schema.json").read_text(encoding="utf-8"))
        self.assertNotIn("video_url", schema["required"])
        script = (ROOT / "assets/lite-video.js").read_text(encoding="utf-8")
        self.assertIn("data-video-load", script)
        self.assertNotIn("DOMContentLoaded', function", script)
        for path in ROOT.glob("**/index.html"):
            if ".git" not in path.parts:
                self.assertNotIn("<iframe", path.read_text(encoding="utf-8"), path)

    def test_social_packages_are_drafts_for_unconfirmed_channels(self):
        channels = json.loads((ROOT / "content/social/channels.json").read_text(encoding="utf-8"))
        package = json.loads((ROOT / "content/social/publication-packages.json").read_text(encoding="utf-8"))["packages"][0]
        self.assertTrue(all(not row["confirmed"] for row in channels["channels"].values()))
        self.assertEqual(package["source_status"], "DRAFT_FOR_OWNER_APPROVAL")
        self.assertEqual(package["vk"]["status"], "DRAFT")
        self.assertEqual(package["yandex_dzen"]["status"], "DRAFT")


if __name__ == "__main__":
    unittest.main()
