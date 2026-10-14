"""Low-cost regressions for keyboard focus and motion preferences in static CSS."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class AccessibilityStaticTests(unittest.TestCase):
    def test_homepage_has_visible_keyboard_focus_for_links_and_controls(self) -> None:
        css = (ROOT / "assets/home-bundle.css").read_text(encoding="utf-8")
        self.assertIn("a:focus-visible,button:focus-visible,summary:focus-visible", css)
        self.assertIn("outline:3px solid #ffcb70", css)

    def test_homepage_respects_reduced_motion(self) -> None:
        css = (ROOT / "assets/home-bundle.css").read_text(encoding="utf-8")
        self.assertIn("@media(prefers-reduced-motion:reduce)", css)
        self.assertIn("scroll-behavior:auto", css)

    def test_internal_pages_keep_visible_focus(self) -> None:
        css = (ROOT / "assets/seo.css").read_text(encoding="utf-8")
        self.assertIn("a:focus-visible,summary:focus-visible", css)


if __name__ == "__main__":
    unittest.main()
