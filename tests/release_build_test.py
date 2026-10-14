import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_static_release", ROOT / "scripts" / "build-static-release.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class StaticReleaseBuildTest(unittest.TestCase):
    def test_build_contains_public_site_and_excludes_server_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "release"
            manifest = MODULE.build_release(ROOT, target, allow_dirty=True)
            paths = {row["path"] for row in manifest["files"]}
            self.assertIn("index.html", paths)
            self.assertIn("ai-poisk-lotov/index.html", paths)
            self.assertIn("assets/ai-search.js", paths)
            self.assertIn("blog/zadatok-na-torgah-po-bankrotstvu/index.html", paths)
            self.assertNotIn("api/ai-lot-search.mjs", paths)
            self.assertNotIn("services/ai-search/server.mjs", paths)
            self.assertFalse(any(path.startswith("docs/") or path.startswith("tests/") for path in paths))
            stored = json.loads((target / "release-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(stored, manifest)
            self.assertTrue(all(len(row["sha256"]) == 64 for row in manifest["files"]))


if __name__ == "__main__":
    unittest.main()
