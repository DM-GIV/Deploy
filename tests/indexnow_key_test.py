import unittest
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parents[1]
KEY="b9b9a861bbfa8cfb5b68212f4817fabe"
class IndexNowTests(unittest.TestCase):
    def test_key_file_and_release(self):
        self.assertEqual((ROOT/(KEY+".txt")).read_text().strip(),KEY)
        spec=importlib.util.spec_from_file_location("release",ROOT/"scripts/build-static-release.py")
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        self.assertTrue(m.is_static_payload(Path(KEY+".txt")))
        self.assertIn(KEY+".txt",m.ROOT_FILES)
