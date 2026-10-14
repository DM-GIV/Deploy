"""Regression tests for the generated public URL contract."""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class PublicSiteContractTests(unittest.TestCase):
    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, *args], cwd=ROOT, text=True, capture_output=True, check=False)

    def test_sitemap_is_generated_from_registry(self) -> None:
        result = self.run_script("scripts/generate-sitemap.py", "--check")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_public_url_contract(self) -> None:
        result = self.run_script("scripts/validate-public-site.py")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_structured_data_keeps_organization_identity_complete(self) -> None:
        result = self.run_script("scripts/validate-public-site.py")
        self.assertEqual(result.returncode, 0, result.stderr)
        article = (ROOT / "blog/kak-proverit-lot-pered-torgami/index.html").read_text(encoding="utf-8")
        self.assertIn('"logo":"https://torgatlas.ru/assets/og-card.png"', article)


if __name__ == "__main__":
    unittest.main()
