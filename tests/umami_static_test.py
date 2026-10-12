"""Static guards for the Umami deployment files (no Docker needed)."""
import pathlib, re, unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "services" / "umami"
COMPOSE = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")


class UmamiStatic(unittest.TestCase):
    def test_images_pinned_by_digest(self):
        images = re.findall(r"image:\s*(\S+)", COMPOSE)
        self.assertEqual(len(images), 2)
        for i in images:
            self.assertRegex(i, r"@sha256:[0-9a-f]{64}$")
            self.assertNotIn(":latest", i)

    def test_hardening(self):
        self.assertEqual(COMPOSE.count("read_only: true"), 2)
        self.assertEqual(COMPOSE.count("no-new-privileges:true"), 2)
        self.assertEqual(COMPOSE.count("cap_drop: [ALL]"), 2)
        self.assertEqual(COMPOSE.count("mem_limit"), 2)

    def test_network_exposure(self):
        ports = re.findall(r'-\s*"([^"]+:3000)"', COMPOSE)
        self.assertEqual(len(ports), 1)
        self.assertTrue(ports[0].startswith("127.0.0.1:"))
        db_block = COMPOSE.split("umami-db:")[1].split("\n  umami:")[0]
        self.assertNotIn("ports:", db_block)
        self.assertIn("internal: true", COMPOSE)

    def test_no_secrets_committed(self):
        for p in ROOT.rglob("*"):
            if p.is_file():
                text = p.read_text(encoding="utf-8", errors="ignore")
                self.assertNotRegex(text, r"(APP_SECRET|POSTGRES_PASSWORD)=[0-9a-f]{32,}", p)
        self.assertNotIn("password=", COMPOSE.lower())

    def test_dashboard_not_public(self):
        inc = (ROOT / "nginx" / "umami-locations.inc").read_text(encoding="utf-8")
        locs = re.findall(r"location\s+(?:=|\^~)\s+(\S+)", inc)
        self.assertEqual(locs, ["/ta/s.js", "/ta/api/send", "/ta/"])


if __name__ == "__main__":
    unittest.main()
