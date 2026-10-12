import importlib.util
import io
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / "services" / "lead-intake" / "lead_intake.py"
SPEC = importlib.util.spec_from_file_location("lead_intake", FILE)
lead = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lead)


class LeadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / "leads.db")
        self.env = {
            "DIRECT_LEADS_ENABLED": "true",
            "DIRECT_LEADS_LEGAL_APPROVED": "true",
            "LEAD_ALLOWED_ORIGIN": "https://torgatlas.ru",
            "LEAD_CONSENT_VERSION": "2026-10-11",
            "SMARTCAPTCHA_SITE_KEY": "test_site_key",
            "SMARTCAPTCHA_SECRET": "fake_server_key",
            "SMTP_HOST": "example.test",
            "SMTP_PORT": "587",
            "SMTP_USER": "testing",
            "SMTP_PASSWORD": "testing",
            "SMTP_FROM": "sender@example.test",
            "LEAD_EMAIL_TO": "owner@example.test",
            "LEAD_HASH_SALT": "S"*40,
            "DATA_DB_PATH": self.path,
        }
        self.messages = []
        self.captcha_calls = []
        self.fail_captcha = False
        self.fail_delivery = False
        def captcha(token, ip):
            self.captcha_calls.append((token, ip))
            if self.fail_captcha:
                raise TimeoutError("provider down")
            return token == "valid-captcha-123"
        def smtp(ident, kind, contact, message, version):
            if self.fail_delivery:
                raise TimeoutError("SMTP timeout")
            self.messages.append((ident, kind, contact, message, version))
        self.captcha = captcha
        self.smtp = smtp
        self.app = lead.App(self.env, captcha, smtp)
        self.ident = str(uuid.uuid4())
        self.payload = {
            "id": self.ident, "kind": "lot", "contact": "user@example.test",
            "message": "Detailed lot investigation request with enough information.",
            "consent": True, "privacyVersion": "2026-10-11",
            "website": "", "captchaToken": "valid-captcha-123",
        }
        self.headers = {"origin": "https://torgatlas.ru", "content-type": "application/json"}

    def post(self, data=None, headers=None, ip="192.0.2.2"):
        raw = json.dumps(self.payload if data is None else data, ensure_ascii=False).encode()
        return self.app.process("POST", "/api/lead", headers or self.headers, raw, ip)

    def status(self):
        db = sqlite3.connect(self.path)
        try:
            row = db.execute("SELECT status FROM leads WHERE id=?", (self.ident,)).fetchone()
            return row[0] if row else None
        finally:
            db.close()

    def test_disabled_no_external_call_or_db(self):
        self.env.pop("DIRECT_LEADS_ENABLED")
        app = lead.App(self.env, lambda *a: self.fail("captcha called"), lambda *a: self.fail("smtp called"))
        self.assertEqual(app.process("GET", "/api/lead-config", {})[1], {"enabled": False})
        self.assertEqual(app.process("POST", "/api/lead", {}, b"personal data")[0], 503)
        self.assertFalse(Path(self.path).exists())

    def test_missing_config_fails_closed(self):
        for key in ("SMARTCAPTCHA_SECRET", "SMTP_PASSWORD", "LEAD_EMAIL_TO", "LEAD_HASH_SALT", "DIRECT_LEADS_LEGAL_APPROVED"):
            e = self.env.copy()
            e.pop(key)
            self.assertFalse(lead.App(e).enabled(), key)

    def test_enabled_config_public_key_only(self):
        code, body = self.app.process("GET", "/api/lead-config", {})
        self.assertEqual(code, 200)
        self.assertEqual(body, {"enabled": True, "siteKey": "test_site_key"})
        self.assertNotIn("fake_server_key", repr(body))

    def test_validation_before_captcha(self):
        bad = [
            ({"origin": "https://evil.example", "content-type": "application/json"}, self.payload, 403),
            ({"origin": "https://torgatlas.ru", "content-type": "text/plain"}, self.payload, 415),
            (self.headers, {**self.payload, "consent": False}, 422),
            (self.headers, {**self.payload, "privacyVersion": "old-policy"}, 422),
            ({"origin": "https://torgatlas.ru", "content-type": "application/jsonbogus"}, self.payload, 415),
            (self.headers, {**self.payload, "website": "spam"}, 422),
            (self.headers, {**self.payload, "message": "short"}, 422),
            (self.headers, {**self.payload, "contact": "x"}, 422),
            (self.headers, {**self.payload, "turnstileToken": "old"}, 422),
            (self.headers, {**self.payload, "id": "not-uuid"}, 422),
        ]
        for i, (headers, body, expected) in enumerate(bad):
            with self.subTest(i=i):
                self.assertEqual(self.post(body, headers)[0], expected)
        self.assertEqual(self.captcha_calls, [])
        self.assertEqual(self.messages, [])

    def test_body_size_json_and_type(self):
        self.assertEqual(self.app.process("POST", "/api/lead", self.headers, b"x"*12289)[0], 413)
        self.assertEqual(self.app.process("POST", "/api/lead", self.headers, b"{")[0], 400)
        self.assertEqual(self.app.process("POST", "/api/lead", self.headers, b"[]")[0], 422)

    def test_captcha_rejection_and_timeout_fail_closed(self):
        bad = {**self.payload, "captchaToken": "invalid-captcha"}
        self.assertEqual(self.post(bad)[0], 403)
        self.fail_captcha = True
        self.assertEqual(self.post()[0], 403)
        self.assertEqual(self.messages, [])
        self.assertFalse(Path(self.path).exists() and self.status() == "accepted")

    def test_acceptance_persistence_duplicate_and_conflict(self):
        code, payload = self.post()
        self.assertEqual(code, 200)
        self.assertEqual(payload, {"ok": True, "code": "ACCEPTED", "receipt": self.ident, "accepted": True, "id": self.ident})
        self.assertEqual(self.status(), "accepted")
        self.assertEqual(len(self.messages), 1)
        again = lead.App(self.env, self.captcha, self.smtp)
        self.assertEqual(again.process("POST", "/api/lead", self.headers, json.dumps(self.payload).encode())[0], 200)
        self.assertEqual(len(self.messages), 1)
        altered = {**self.payload, "contact": "some-other@example.test"}
        self.assertEqual(again.process("POST", "/api/lead", self.headers, json.dumps(altered).encode())[0], 409)
        self.assertEqual(len(self.messages), 1)

    def test_smtp_fail_not_accepted_or_retried(self):
        self.fail_delivery = True
        code, payload = self.post()
        self.assertEqual(code, 502)
        self.assertEqual(payload["code"], "DELIVERY_UNCONFIRMED")
        self.assertEqual(self.status(), "delivery_unknown")
        self.fail_delivery = False
        self.assertEqual(self.post()[0], 503)
        self.assertEqual(len(self.messages), 0)

    def test_rate_limit_guard(self):
        for _ in range(20):
            self.assertEqual(self.post({**self.payload, "website": "trap"})[0], 422)
        self.assertEqual(self.post()[0], 429)
        self.assertEqual(self.messages, [])

    def test_no_pii_in_http_codes_and_logs(self):
        self.fail_delivery = True
        result = self.post()
        self.assertNotIn("user@example.test", str(result))
        self.assertNotIn("Detailed lot", str(result))
        import inspect
        self.assertNotIn("self.path", inspect.getsource(lead.Handler.log_message))

    def test_smartcaptcha_api_contract_and_host(self):
        class FakeReply:
            status = 200
            def __init__(self, payload):
                self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return self.payload
        def call(request, timeout):
            self.assertEqual(request.full_url, lead.VERIFY_URL)
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(timeout, 5)
            self.assertIn("secret=fake_server_key", request.data.decode())
            return FakeReply(b'{"status":"ok","host":"torgatlas.ru"}')
        with patch.object(lead.urllib.request, "urlopen", side_effect=call):
            self.assertTrue(self.app.verify_captcha("valid-captcha-123", "192.0.2.2"))
        for value in (b'{"status":"failed"}', b'{"status":"ok","host":"evil.example"}'):
            with patch.object(lead.urllib.request, "urlopen", return_value=FakeReply(value)):
                self.assertFalse(self.app.verify_captcha("valid-captcha-123", "192.0.2.2"))
        with patch.object(lead.urllib.request, "urlopen", side_effect=TimeoutError):
            self.assertFalse(self.app.verify_captcha("valid-captcha-123", "192.0.2.2"))

    def test_sqlite_no_raw_ip(self):
        self.assertEqual(self.post()[0], 200)
        db = sqlite3.connect(self.path)
        try:
            row = db.execute("SELECT contact,message,ip_hash FROM leads").fetchone()
        finally:
            db.close()
        self.assertEqual(row[0], self.payload["contact"])
        self.assertEqual(row[1], self.payload["message"])
        self.assertNotIn("192.0.2.2", row[2])
        self.assertEqual(len(row[2]), 64)
        if os.name == "posix":
            self.assertEqual(Path(self.path).stat().st_mode & 0o777, 0o600)
        db = sqlite3.connect(self.path)
        try:
            consent = db.execute("SELECT consent_given,consent_at,privacy_version FROM leads").fetchone()
        finally:
            db.close()
        self.assertEqual(consent[0], 1)
        self.assertEqual(consent[2], self.payload["privacyVersion"])
        self.assertTrue(consent[1].startswith("20"))

    def test_retention_requires_explicit_legal_gate(self):
        import importlib.util
        mod_path = FILE.with_name("retention.py")
        spec = importlib.util.spec_from_file_location("lead_retention", mod_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(self.post()[0], 200)
        conn = sqlite3.connect(self.path)
        try:
            conn.execute("UPDATE leads SET created_at='2020-01-01T00:00:00+00:00'")
            conn.commit()
        finally:
            conn.close()
        e = self.env.copy()
        e["LEAD_RETENTION_DAYS"] = "365"
        e["LEAD_RETENTION_LEGAL_APPROVED"] = "false"
        self.assertEqual(module.run(e, False), {"ok": True, "mode": "DRY_RUN", "candidates": 1})
        self.assertEqual(module.run(e, True)["code"], "LEGAL_APPROVAL_REQUIRED")
        self.assertEqual(self.status(), "accepted")
        e["LEAD_RETENTION_LEGAL_APPROVED"] = "true"
        self.assertEqual(module.run(e, True), {"ok": True, "mode": "EXECUTED", "deleted": 1})
        self.assertEqual(self.status(), None)

    def test_real_local_http_disabled_contract(self):
        import http.client
        import http.server
        http.server.ThreadingHTTPServer.allow_reuse_address = True
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lead.Handler)
        httpd.app = lead.App({})
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=3)
            conn.request("GET", "/api/lead-config")
            r = conn.getresponse()
            self.assertEqual(r.status, 200)
            self.assertEqual(json.loads(r.read()), {"enabled": False})
            conn.request("POST", "/api/lead", body=b"synthetic private data", headers={
                "Origin": "https://torgatlas.ru", "Content-Type": "application/json"})
            r = conn.getresponse()
            self.assertEqual(r.status, 503)
            self.assertEqual(json.loads(r.read())["code"], "NOT_CONFIGURED")
            conn.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            t.join(timeout=3)

    def test_handler_no_body_read_while_disabled(self):
        # HTTP-handler logic explicitly gates rfile.read on app.enabled.
        import inspect
        source = inspect.getsource(lead.Handler.serve)
        self.assertIn('path == "/api/lead" and app.enabled()', source)
        self.assertIn('self.rfile.read(int(length))', source)
        self.assertLess(source.index('and app.enabled()'), source.index('self.rfile.read(int(length))'))


if __name__ == "__main__":
    unittest.main()
