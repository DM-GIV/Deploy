import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = "yandex_dcff75ab84eb360e.html"
TOKEN = "dcff75ab84eb360e"

class YandexVerificationTests(unittest.TestCase):
    def test_exact_public_verification_file(self):
        contents = (ROOT / FILE).read_text(encoding="utf-8")
        self.assertIn("Verification: " + TOKEN, contents)
        self.assertIn("<body>Verification: " + TOKEN + "</body>", contents)
        self.assertNotIn("<script", contents)

    def test_release_includes_verification_file(self):
        spec = importlib.util.spec_from_file_location("static_release", ROOT / "scripts/build-static-release.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(module.is_static_payload(Path(FILE)))
        self.assertIn(FILE, module.ROOT_FILES)

if __name__ == "__main__":
    unittest.main()
