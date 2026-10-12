"""TEST_ONLY: owner CLI and retention tool on a disposable database."""
import contextlib
import importlib
import io
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1] / "services" / "lead-intake"
sys.path.insert(0, str(SERVICE))
sys.dont_write_bytecode = True
lead = importlib.import_module("lead_intake")
ctl = importlib.import_module("leadctl")
retention = importlib.import_module("retention")

TEST_ID = "11111111-1111-4111-8111-111111111111"
REAL_ID = "22222222-2222-4222-8222-222222222222"


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.chmod(self.tmp.name, 0o700)
        self.db = str(Path(self.tmp.name) / "leads.sqlite3")
        env = {"DATA_DB_PATH": self.db, "LEAD_HASH_SALT": "x" * 40}
        conn = lead.App(env).connect()
        for ident, contact, message, created in ((TEST_ID, "t@example.invalid", "TEST_E2E_AUC204 synthetic", "2020-01-01T00:00:00+00:00"),
                                                  (REAL_ID, "real@example.org", "real enquiry text", "2020-01-02T00:00:00+00:00")):
            conn.execute("INSERT INTO leads (id,created_at,kind,contact,message,privacy_version,ip_hash,payload_hash,status,consent_at,consent_given) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,1)", (ident, created, "lot", contact, message, "v", "h", "p", "accepted", created))
            conn.execute("INSERT INTO altcha_used VALUES (?,?,?,?)", ("c" + ident[:8], 1, ident, created))
        conn.close()

    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            ctl.main(["--db", self.db, *args])
        return out.getvalue()

    def count(self):
        c = sqlite3.connect(self.db)
        try:
            return c.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
        finally:
            c.close()

    def test_stats_has_no_personal_data(self):
        text = self.run_cli("stats")
        self.assertIn("total=2", text)
        self.assertIn("new_unreviewed=2", text)
        self.assertNotIn("example", text)

    def test_list_show_ack(self):
        self.assertIn("real@example.org", self.run_cli("list"))
        self.run_cli("ack", REAL_ID)
        self.assertNotIn("real@example.org", self.run_cli("list"))
        self.assertIn("real@example.org", self.run_cli("list", "--all"))
        shown = self.run_cli("show", REAL_ID)
        self.assertIn("real enquiry text", shown)
        self.assertNotIn("payload_hash", shown)

    def test_list_is_read_only(self):
        with self.assertRaises(sqlite3.OperationalError):
            conn = ctl.open_db(self.db)
            conn.execute("DELETE FROM leads")

    def test_cleanup_refuses_real_leads_and_defaults_to_dry_run(self):
        with self.assertRaises(SystemExit):
            self.run_cli("cleanup-test", REAL_ID, "--execute")
        self.assertIn("DRY_RUN", self.run_cli("cleanup-test", TEST_ID))
        self.assertEqual(self.count(), 2)
        self.assertIn("deleted=1", self.run_cli("cleanup-test", TEST_ID, "--execute"))
        self.assertEqual(self.count(), 1)

    def test_close_hold_and_retention_workflow(self):
        env = {"DATA_DB_PATH": self.db}
        self.run_cli("ack", REAL_ID)  # merely reading is NOT purpose reached
        self.assertEqual(retention.run(env)["candidates"], 0)
        self.run_cli("close", TEST_ID)
        self.run_cli("close", REAL_ID)
        self.run_cli("hold", REAL_ID, "--reason", "contract")
        with self.assertRaises(SystemExit):
            self.run_cli("hold", "no-such-id", "--reason", "x")
        self.assertEqual(retention.run(env)["candidates"], 0)  # inside the 1-day recovery window
        self.assertEqual(retention.run(env, grace_days=0)["candidates"], 1)  # held lead excluded
        self.assertEqual(retention.run(env, execute=True), {"ok": False, "code": "LEGAL_APPROVAL_REQUIRED"})
        self.assertEqual(self.count(), 2)
        self.assertEqual(retention.run(dict(env, LEAD_RETENTION_LEGAL_APPROVED="true"), execute=True, grace_days=0)["deleted"], 1)
        self.assertEqual(self.count(), 1)  # only the closed, unheld lead was destroyed
        self.run_cli("release-hold", REAL_ID)
        self.assertEqual(retention.run(env, grace_days=0)["candidates"], 1)
        self.assertEqual(retention.run({}), {"ok": False, "code": "RETENTION_NOT_CONFIGURED"})


if __name__ == "__main__":
    unittest.main()
