"""TEST_ONLY: disposable DBs and synthetic payloads; these tests do not prove live production behaviour."""
import base64
import datetime as dt
import hashlib
import http.client
import http.server
import importlib
import json
import os
import socket
import sqlite3
import stat
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

SERVICE = Path(__file__).resolve().parents[1] / "services" / "lead-intake"
sys.path.insert(0, str(SERVICE))
lead = importlib.import_module("lead_intake")
altcha = lead.altcha

CONTACT = "test-e2e@example.invalid"
MESSAGE = "TEST_ONLY синтетическая заявка для автоматического теста, без реальных данных."
SMTP_ENV = {"SMTP_HOST": "smtp.example.invalid", "SMTP_PORT": "587", "SMTP_USER": "u",
            "SMTP_PASSWORD": "p", "SMTP_FROM": "a@example.invalid", "LEAD_EMAIL_TO": "b@example.invalid"}


def solve(challenge, tamper=None):
    """Behaves like the official widget: brute-force the number, base64-encode the payload."""
    for n in range(challenge["maxnumber"] + 1):
        if hashlib.sha256((challenge["salt"] + str(n)).encode()).hexdigest() == challenge["challenge"]:
            payload = {"algorithm": challenge["algorithm"], "challenge": challenge["challenge"],
                       "number": n, "salt": challenge["salt"], "signature": challenge["signature"]}
            if tamper:
                payload.update(tamper)
            return base64.b64encode(json.dumps(payload).encode()).decode()
    raise AssertionError("unsolvable")


class Base(unittest.TestCase):
    smtp = False

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.chmod(self.tmp.name, 0o700)
        self.path = str(Path(self.tmp.name) / "leads.sqlite3")
        self.env = {
            "DIRECT_LEADS_ENABLED": "true", "DIRECT_LEADS_LEGAL_APPROVED": "true",
            "LEAD_ALLOWED_ORIGIN": "https://torgatlas.ru", "LEAD_CONSENT_VERSION": "2026-10-12.2",
            "LEAD_HASH_SALT": "hash-salt-" + "Qw3rTy9uIoPaSdFgHjKl" * 2,
            "ALTCHA_HMAC_KEY": "hmac-key-" + "Zx7cVb1nMqWeRtYuIoPa" * 2,
            "DATA_DB_PATH": self.path,
        }
        if self.smtp:
            self.env.update(SMTP_ENV)
        self.sent = []
        self.fail_delivery = None
        self.now = [1_800_000_000.0]
        self.app = self.make_app()

    def make_app(self):
        def delivery(*args):
            if self.fail_delivery:
                raise self.fail_delivery
            self.sent.append(args)
        return lead.App(self.env, delivery=delivery, wall=lambda: self.now[0], spawn=lambda fn: fn())

    def post(self, body, headers=None, ip="203.0.113.5", app=None):
        h = {"origin": "https://torgatlas.ru", "content-type": "application/json"}
        h.update(headers or {})
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        return (app or self.app).process("POST", "/api/lead", h, raw, ip)

    def token(self, app=None):
        return solve((app or self.app).process("GET", "/api/altcha-challenge", {})[1])

    def payload(self, **over):
        item = {"id": str(uuid.uuid4()), "kind": "lot", "contact": CONTACT, "message": MESSAGE,
                "privacyVersion": "2026-10-12.2", "consent": True, "website": "", "altcha": self.token()}
        item.update(over)
        return item

    def rows(self, sql="SELECT * FROM leads"):
        db = sqlite3.connect(self.path)
        try:
            return db.execute(sql).fetchall()
        finally:
            db.close()


class ConfigTests(Base):
    def test_enabled_needs_only_local_settings_not_smtp_or_smartcaptcha(self):
        self.assertTrue(self.app.enabled())
        self.assertFalse(any(k.startswith(("SMTP_", "SMARTCAPTCHA_")) for k in self.env))
        self.assertEqual(self.app.process("GET", "/api/lead-config", {})[1]["enabled"], True)

    def test_each_requirement_fails_closed(self):
        for key, bad in (("DIRECT_LEADS_ENABLED", "false"), ("DIRECT_LEADS_LEGAL_APPROVED", ""),
                         ("LEAD_ALLOWED_ORIGIN", "https://evil.example"), ("LEAD_CONSENT_VERSION", "2020-01-01"),
                         ("DATA_DB_PATH", "relative/leads.db"), ("LEAD_HASH_SALT", "short"),
                         ("ALTCHA_HMAC_KEY", "a" * 40), ("ALTCHA_HMAC_KEY", "changeme" + "xyzABCDEFGH" * 3)):
            env = dict(self.env, **{key: bad})
            self.assertFalse(lead.App(env).enabled(), key)
        env = dict(self.env)
        env["ALTCHA_HMAC_KEY"] = env["LEAD_HASH_SALT"]
        self.assertFalse(lead.App(env).enabled())
        env.pop("ALTCHA_HMAC_KEY")
        self.assertFalse(lead.App(env).enabled())

    def test_disabled_contract(self):
        app = lead.App(dict(self.env, DIRECT_LEADS_ENABLED="false"))
        self.assertEqual(app.process("GET", "/api/lead-config", {}), (200, {"enabled": False}))
        self.assertEqual(app.process("POST", "/api/lead", {}, b"{}")[0], 503)
        self.assertEqual(app.process("GET", "/api/altcha-challenge", {})[0], 503)
        self.assertFalse(Path(self.path).exists(), "disabled service must not touch SQLite")

    def test_not_ready_when_storage_is_not_private(self):
        os.chmod(self.tmp.name, 0o755)
        self.assertFalse(self.make_app().ready())
        self.assertEqual(self.make_app().process("GET", "/api/lead-config", {})[1], {"enabled": False})

    def test_not_ready_when_database_unwritable(self):
        env = dict(self.env, DATA_DB_PATH=str(Path(self.tmp.name) / "missing" / "leads.sqlite3"))
        self.assertFalse(lead.App(env).ready())

    def test_files_are_private_and_durable(self):
        self.assertTrue(self.app.ready())
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        db = self.app.connect()
        try:
            self.assertEqual(db.execute("PRAGMA synchronous").fetchone()[0], 2)  # FULL
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], lead.SCHEMA_VERSION)
        finally:
            db.close()


class ChallengeTests(Base):
    def test_challenge_is_official_v1_shape_and_unique(self):
        a = self.app.process("GET", "/api/altcha-challenge", {})[1]
        b = self.app.process("GET", "/api/altcha-challenge", {})[1]
        self.assertEqual(set(a), {"algorithm", "challenge", "maxnumber", "salt", "signature"})
        self.assertEqual(a["algorithm"], "SHA-256")
        self.assertEqual(a["maxnumber"], lead.ALTCHA_MAX_NUMBER)
        self.assertNotEqual((a["salt"], a["challenge"]), (b["salt"], b["challenge"]))
        self.assertIn("expires=%d" % (int(self.now[0]) + lead.ALTCHA_TTL_SECONDS), a["salt"])
        # independent re-computation of the documented protocol (no vendored code involved)
        number = json.loads(base64.b64decode(solve(a)))["number"]
        self.assertEqual(hashlib.sha256((a["salt"] + str(number)).encode()).hexdigest(), a["challenge"])
        import hmac as _h
        self.assertEqual(_h.new(self.env["ALTCHA_HMAC_KEY"].encode(), a["challenge"].encode(), hashlib.sha256).hexdigest(), a["signature"])

    def test_vendored_library_is_the_pinned_release(self):
        digest = hashlib.sha256((SERVICE / "vendor" / "altcha_v1.py").read_bytes()).hexdigest()
        self.assertEqual(digest, "2eda6647ce6da1ed960c2ce5e10774d0f40b64041e9a2cb453ab46f7114fd569")

    def test_challenge_rate_limit(self):
        codes = [self.app.process("GET", "/api/altcha-challenge", {}, None, "198.51.100.9")[0]
                 for _ in range(lead.CHALLENGE_RATE_LIMIT + 3)]
        self.assertEqual(codes.count(200), lead.CHALLENGE_RATE_LIMIT)
        self.assertEqual(codes[-1], 429)


def make_challenge(key, number, expires_at, max_number=100):
    return altcha.create_challenge(altcha.ChallengeOptions(
        algorithm="SHA-256", max_number=max_number, hmac_key=key, number=number,
        expires=None if expires_at is None else dt.datetime.fromtimestamp(expires_at, dt.timezone.utc))).to_dict() | {"maxnumber": max_number}


class SubmitTests(Base):
    def test_valid_submission_is_durable_and_returns_receipt(self):
        item = self.payload()
        code, body = self.post(item)
        self.assertEqual((code, body), (200, {"ok": True, "code": "ACCEPTED", "receipt": item["id"],
                                              "accepted": True, "id": item["id"]}))
        rows = self.rows("SELECT id,status,contact,notification_status FROM leads")
        self.assertEqual(rows, [(item["id"], "accepted", CONTACT, "not_configured")])
        self.assertEqual(len(self.rows("SELECT * FROM altcha_used")), 1)
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)

    def test_no_network_is_used(self):
        def forbidden(*a, **k):
            raise AssertionError("network access attempted")
        with patch("socket.socket.connect", forbidden), patch("socket.create_connection", forbidden):
            self.assertEqual(self.post(self.payload())[0], 200)

    def test_captcha_rejections_write_nothing(self):
        good = self.token()
        challenge = self.app.process("GET", "/api/altcha-challenge", {})[1]
        key, now = self.env["ALTCHA_HMAC_KEY"], self.now[0]
        cases = (
            ("missing", ""), ("garbage", "!!!notbase64!!!"),
            ("not-json", base64.b64encode(b"x" * 40).decode()),
            ("bad-signature", solve(challenge, {"signature": "0" * 64})),
            ("bad-number", solve(challenge, {"number": 1})),
            ("sha1", solve(challenge, {"algorithm": "SHA-1"})),
            ("oversize", "A" * 5000),
            ("expired", solve(make_challenge(key, 7, now - 5))),
            ("foreign-key", solve(make_challenge("another-key-" + "k" * 30, 7, now + 300))),
            ("no-expiry", solve(make_challenge(key, 7, None))),
            ("far-future", solve(make_challenge(key, 7, now + 86400))),
        )
        for label, token in cases:
            code, body = self.post(self.payload(altcha=token))
            self.assertEqual((code, body["code"]), (403, "CAPTCHA_FAILED"), label)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.post(self.payload(altcha=good))[0], 200)  # unused valid token still works

    def test_expiry_in_time(self):
        token = self.token()
        self.now[0] += lead.ALTCHA_TTL_SECONDS + 1
        self.assertEqual(self.post(self.payload(altcha=token))[1]["code"], "CAPTCHA_FAILED")
        self.assertEqual(self.rows(), [])

    def test_replay_with_other_uuid_rejected_and_nothing_written(self):
        token = self.token()
        self.assertEqual(self.post(self.payload(altcha=token))[0], 200)
        code, body = self.post(self.payload(altcha=token))
        self.assertEqual((code, body["code"]), (403, "CAPTCHA_REPLAY"))
        self.assertEqual(len(self.rows()), 1)

    def test_replay_after_restart(self):
        token = self.token()
        self.assertEqual(self.post(self.payload(altcha=token))[0], 200)
        restarted = self.make_app()
        self.assertEqual(self.post(self.payload(altcha=token), app=restarted)[1]["code"], "CAPTCHA_REPLAY")
        self.assertEqual(len(self.rows()), 1)

    def test_same_uuid_same_payload_returns_same_receipt_without_new_insert_or_mail(self):
        self.env.update(SMTP_ENV)
        app = self.make_app()
        item = self.payload(altcha=self.token(app))
        first = self.post(item, app=app)
        for token in (item["altcha"], self.token(app), "", "garbage"):  # retry may carry any CAPTCHA state
            self.assertEqual(self.post(dict(item, altcha=token), app=app), first)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.rows("SELECT * FROM altcha_used")), 1)

    def test_same_uuid_other_payload_is_409(self):
        item = self.payload()
        self.assertEqual(self.post(item)[0], 200)
        code, body = self.post(dict(item, message=MESSAGE + " изменено", altcha=self.token()))
        self.assertEqual((code, body["code"]), (409, "ID_CONFLICT"))
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(len(self.rows("SELECT * FROM altcha_used")), 1)

    def test_input_validation(self):
        self.assertEqual(self.post(self.payload(), headers={"origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.post(self.payload(), headers={"content-type": "text/plain"})[0], 415)
        self.assertEqual(self.post(b"x" * (lead.MAX_BODY + 1))[0], 413)
        self.assertEqual(self.post(b"{not json")[0], 400)
        self.assertEqual(self.post([1, 2])[0], 422)
        for label, over in (("honeypot", {"website": "http://spam"}), ("no consent", {"consent": False}),
                            ("consent string", {"consent": "true"}), ("version mismatch", {"privacyVersion": "2026-10-11"}),
                            ("bad uuid", {"id": "123"}), ("uuid v1", {"id": str(uuid.uuid1())}), ("kind", {"kind": "file"}),
                            ("short contact", {"contact": "ab"}), ("newline contact", {"contact": "a@b.example\nBcc: x"}),
                            ("short message", {"message": "мало"}), ("long message", {"message": "x" * 6001}),
                            ("captcha not string", {"altcha": None})):
            self.assertEqual(self.post(self.payload(**over))[0], 422, label)
        item = self.payload()
        del item["consent"]
        self.assertEqual(self.post(item)[0], 422)
        self.assertEqual(self.rows(), [])

    def test_ip_rate_limit(self):
        codes = [self.post(self.payload(altcha="x"), ip="198.51.100.77")[0] for _ in range(lead.SUBMIT_RATE_LIMIT + 2)]
        self.assertEqual(codes[-1], 429)
        self.assertEqual(self.post(self.payload(), ip="198.51.100.78")[0], 200)

    def test_commit_failure_is_never_accepted_and_retry_is_safe(self):
        real_connect = self.app.connect
        state = {"fail": True}

        class Proxy:
            def __init__(self, db):
                self.db = db

            def execute(self, sql, *a):
                if sql.strip().upper() == "COMMIT":
                    raise sqlite3.OperationalError("disk I/O error")
                return self.db.execute(sql, *a)

            def close(self):
                self.db.close()

        def connect():
            db = real_connect()
            return Proxy(db) if state["fail"] else db
        self.app.connect = connect
        item = self.payload()
        code, body = self.post(item)
        self.assertEqual((code, body), (503, {"ok": False, "code": "UNAVAILABLE"}))
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.rows("SELECT * FROM altcha_used"), [])  # challenge not consumed
        state["fail"] = False
        self.assertEqual(self.post(item)[0], 200)  # same payload/same CAPTCHA retried safely
        self.assertEqual(len(self.rows()), 1)

    def test_database_errors_are_failures_not_acceptance(self):
        item = self.payload()
        broken = lead.App(dict(self.env, DATA_DB_PATH=str(Path(self.tmp.name) / "gone" / "x.db")))
        code, body = broken.process("POST", "/api/lead", {"origin": "https://torgatlas.ru", "content-type": "application/json"},
                                    json.dumps(item).encode())
        self.assertNotEqual(code, 200)
        self.assertFalse(body.get("accepted", False))
        if os.geteuid() != 0:
            os.chmod(self.path, 0o400)
            code, body = self.make_app().process("POST", "/api/lead", {"origin": "https://torgatlas.ru", "content-type": "application/json"},
                                                 json.dumps(item).encode())
            os.chmod(self.path, 0o600)
            self.assertNotEqual(code, 200)
            self.assertFalse(body.get("accepted", False))
        self.assertEqual(self.rows(), [])

    def test_concurrent_same_challenge_only_one_wins(self):
        token = self.token()
        results = []
        barrier = threading.Barrier(2)

        def run():
            app = self.make_app()
            item = self.payload(altcha=token)
            barrier.wait()
            results.append(self.post(item, app=app))
        threads = [threading.Thread(target=run) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(r[0] for r in results), [200, 403])
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(len(self.rows("SELECT * FROM altcha_used")), 1)

    def test_concurrent_same_uuid_creates_one_row(self):
        item = self.payload()
        results = []
        barrier = threading.Barrier(4)

        def run():
            app = self.make_app()
            barrier.wait()
            results.append(self.post(item, app=app))
        threads = [threading.Thread(target=run) for _ in range(4)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertTrue(all(r == results[0] and r[0] == 200 for r in results), results)
        self.assertEqual(len(self.rows()), 1)

    def test_responses_do_not_contain_pii_or_secrets(self):
        item = self.payload()
        code, body = self.post(item)
        text = json.dumps(body)
        for secret in (CONTACT, MESSAGE, item["altcha"], self.env["ALTCHA_HMAC_KEY"], "203.0.113.5"):
            self.assertNotIn(secret, text)
        self.assertEqual(set(body), {"ok", "code", "receipt", "accepted", "id"})


class SmtpTests(Base):
    def test_absent_smtp_accepts_and_marks_not_configured(self):
        self.assertEqual(self.post(self.payload())[0], 200)
        self.assertEqual(self.rows("SELECT notification_status FROM leads"), [("not_configured",)])
        self.assertEqual(self.sent, [])

    def test_incomplete_smtp_config_is_not_configured(self):
        self.assertFalse(lead.App(dict(self.env, SMTP_HOST="smtp.example.invalid")).smtp_configured())


class SmtpConfiguredTests(Base):
    smtp = True

    def test_smtp_success(self):
        self.assertEqual(self.post(self.payload())[0], 200)
        self.assertEqual(self.rows("SELECT status,notification_status FROM leads"), [("accepted", "sent")])
        self.assertEqual(len(self.sent), 1)

    def test_smtp_failure_never_changes_acceptance_or_duplicates(self):
        self.fail_delivery = TimeoutError("smtp down")
        item = self.payload()
        self.assertEqual(self.post(item)[0], 200)
        self.assertEqual(self.rows("SELECT status,notification_status FROM leads"), [("accepted", "failed")])
        self.fail_delivery = None
        self.assertEqual(self.post(item)[0], 200)  # idempotent, no second mail
        self.assertEqual(self.sent, [])
        self.assertEqual(len(self.rows()), 1)

    def test_ambiguous_state_is_never_auto_retried(self):
        item = self.payload()
        self.post(item)
        self.assertEqual(len(self.sent), 1)
        db = sqlite3.connect(self.path)
        db.execute("UPDATE leads SET notification_status='sending'")
        db.commit()
        db.close()
        self.app.notify(item["id"], "lot", CONTACT, MESSAGE, "2026-10-12.2")
        self.assertEqual(len(self.sent), 1)  # the 'sending' claim blocks any second send

    def test_smtp_not_used_when_commit_fails(self):
        real = self.app.connect

        class Proxy:
            def __init__(self, db):
                self.db = db

            def execute(self, sql, *a):
                if sql.strip().upper() == "COMMIT":
                    raise sqlite3.OperationalError("disk full")
                return self.db.execute(sql, *a)

            def close(self):
                self.db.close()
        self.app.connect = lambda: Proxy(real())
        self.assertEqual(self.post(self.payload())[0], 503)
        self.assertEqual(self.sent, [])


class MigrationTests(Base):
    def test_legacy_database_is_backed_up_and_preserved(self):
        db = sqlite3.connect(self.path)
        db.execute("""CREATE TABLE leads (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
          contact TEXT NOT NULL, message TEXT NOT NULL, privacy_version TEXT NOT NULL, ip_hash TEXT NOT NULL,
          payload_hash TEXT NOT NULL, status TEXT NOT NULL, consent_at TEXT NOT NULL,
          consent_given INTEGER NOT NULL CHECK(consent_given=1))""")
        db.execute("INSERT INTO leads VALUES ('11111111-1111-4111-8111-111111111111','2026-10-01','lot','legacy-contact',"
                   "'legacy message','v','h','p','delivery_unknown','2026-10-01',1)")
        db.commit()
        db.close()
        os.chmod(self.path, 0o600)
        before = self.rows()
        self.assertTrue(self.app.ready())
        folder = Path(self.tmp.name) / "pre-migration-backups"
        backups = list(folder.glob("*.sqlite3"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)
        copy = sqlite3.connect(str(backups[0]))
        self.assertEqual(copy.execute("SELECT * FROM leads").fetchall(), before)
        copy.close()
        self.assertEqual(self.rows("SELECT id,contact,status,notification_status FROM leads"),
                         [("11111111-1111-4111-8111-111111111111", "legacy-contact", "delivery_unknown", "not_configured")])
        self.assertTrue(self.make_app().ready())  # idempotent, no second backup
        self.assertEqual(len(list(folder.glob("*.sqlite3"))), 1)


class HttpTests(Base):
    def serve(self, app):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lead.Handler)
        server.app = app
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def test_disabled_never_reads_pii_body(self):
        port = self.serve(lead.App(dict(self.env, DIRECT_LEADS_ENABLED="false")))
        s = socket.create_connection(("127.0.0.1", port), timeout=3)
        s.sendall(b"POST /api/lead HTTP/1.1\r\nHost: x\r\nOrigin: https://torgatlas.ru\r\nContent-Type: application/json\r\n"
                  b"Content-Length: 5000\r\n\r\n{\"contact\":")
        reply = b""
        while True:  # answered although the body was never completed; server closes the connection
            chunk = s.recv(4096)
            if not chunk:
                break
            reply += chunk
        s.close()
        self.assertIn(b" 503 ", reply.split(b"\r\n")[0] + b" ")
        self.assertIn(b"no-store", reply)
        self.assertIn(b'"code":"NOT_CONFIGURED"', reply)

    def test_challenge_endpoint_headers_and_forwarded_ip_trust(self):
        port = self.serve(self.make_app())
        conn = http.client.HTTPConnection("127.0.0.1", port)
        conn.request("GET", "/api/altcha-challenge")
        r = conn.getresponse()
        self.assertEqual((r.status, r.getheader("Cache-Control")), (200, "no-store, max-age=0"))
        self.assertEqual(json.loads(r.read())["algorithm"], "SHA-256")
        for _ in range(lead.CHALLENGE_RATE_LIMIT):  # X-Real-IP trusted from loopback: own bucket
            c = http.client.HTTPConnection("127.0.0.1", port)
            c.request("GET", "/api/altcha-challenge", headers={"X-Real-IP": "198.51.100.200"})
            c.getresponse().read()
        c = http.client.HTTPConnection("127.0.0.1", port)
        c.request("GET", "/api/altcha-challenge", headers={"X-Real-IP": "198.51.100.200"})
        self.assertEqual(c.getresponse().status, 429)
        c = http.client.HTTPConnection("127.0.0.1", port)
        c.request("GET", "/api/altcha-challenge", headers={"X-Real-IP": "198.51.100.201"})
        self.assertEqual(c.getresponse().status, 200)

    def test_forwarded_header_ignored_from_untrusted_peer(self):
        port = self.serve(lead.App(dict(self.env, LEAD_TRUSTED_PROXIES="10.99.0.1")))
        for i in range(lead.CHALLENGE_RATE_LIMIT):
            c = http.client.HTTPConnection("127.0.0.1", port)
            c.request("GET", "/api/altcha-challenge", headers={"X-Real-IP": "198.51.100.%d" % (i + 1)})
            c.getresponse().read()
        c = http.client.HTTPConnection("127.0.0.1", port)
        c.request("GET", "/api/altcha-challenge", headers={"X-Real-IP": "198.51.100.250"})
        self.assertEqual(c.getresponse().status, 429)  # rotating spoofed X-Real-IP did not evade the limit

    def test_end_to_end_over_http(self):
        port = self.serve(self.make_app())
        c = http.client.HTTPConnection("127.0.0.1", port)
        c.request("GET", "/api/altcha-challenge")
        token = solve(json.loads(c.getresponse().read()))
        item = {"id": str(uuid.uuid4()), "kind": "search", "contact": CONTACT, "message": MESSAGE,
                "privacyVersion": "2026-10-12.2", "consent": True, "website": "", "altcha": token}
        body = json.dumps(item)
        headers = {"Origin": "https://torgatlas.ru", "Content-Type": "application/json"}
        c = http.client.HTTPConnection("127.0.0.1", port)
        c.request("POST", "/api/lead", body, headers)
        r = c.getresponse()
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(r.read())["receipt"], item["id"])
        c = http.client.HTTPConnection("127.0.0.1", port)
        c.putrequest("POST", "/api/lead")
        for k, v in headers.items():
            c.putheader(k, v)
        c.putheader("Transfer-Encoding", "chunked")
        c.endheaders(b"0\r\n\r\n")
        self.assertEqual(c.getresponse().status, 411)


ROOT = Path(__file__).resolve().parents[1]


class InputValidationTests(Base):
    """Fail-closed validation must not depend on `assert` (stripped by `python -O`)."""

    def invalid_cases(self):
        good = str(uuid.uuid4())
        return [
            ("id-not-uuid", {"id": "not-a-uuid"}), ("id-uuid1", {"id": str(uuid.uuid1())}),
            ("id-uppercase", {"id": good.upper()}), ("id-int", {"id": 5}), ("id-none", {"id": None}),
            ("kind-bad", {"kind": "other"}), ("kind-int", {"kind": 1}), ("kind-list", {"kind": ["lot"]}),
            ("contact-short", {"contact": "a@b"}), ("contact-long", {"contact": "x" * 181}),
            ("contact-newline", {"contact": "valid@example.invalid\nBcc: x@y.z"}),
            ("contact-cr", {"contact": "valid@example.invalid\rBcc"}),
            ("contact-int", {"contact": 123456}), ("contact-none", {"contact": None}),
            ("message-short", {"message": "short"}), ("message-long", {"message": "m" * 6001}),
            ("message-list", {"message": ["x" * 50]}),
            ("version-wrong", {"privacyVersion": "1999"}), ("version-int", {"privacyVersion": 1}),
            ("consent-false", {"consent": False}), ("consent-string", {"consent": "true"}),
            ("consent-one", {"consent": 1}), ("consent-none", {"consent": None}),
            ("honeypot-filled", {"website": "http://spam.invalid"}), ("honeypot-int", {"website": 1}),
            ("altcha-int", {"altcha": 5}), ("altcha-none", {"altcha": None}),
        ]

    def test_invalid_inputs_create_no_rows(self):
        n = [0]
        tok = self.token()  # never consumed: every case below is rejected before CAPTCHA use

        def build(**over):
            item = {"id": str(uuid.uuid4()), "kind": "lot", "contact": CONTACT, "message": MESSAGE,
                    "privacyVersion": "2026-10-12.2", "consent": True, "website": "", "altcha": tok}
            item.update(over)
            return item

        def post(item):  # distinct client IPs: the rate limiter is not under test here
            n[0] += 1
            return self.post(item, ip="198.51.100.%d" % n[0])
        for label, over in self.invalid_cases():
            code, body = post(build(**over))
            self.assertEqual((code, body["code"]), (422, "INVALID_INPUT"), label)
        for key in ("id", "kind", "contact", "message", "privacyVersion", "consent", "altcha"):
            item = build()
            del item[key]
            self.assertEqual(post(item)[0], 422, "missing " + key)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.rows("SELECT * FROM altcha_used"), [])
        self.assertEqual(post(build())[0], 200)  # control: valid input is still accepted
        self.assertEqual(len(self.rows()), 1)

    def test_no_assert_statements_in_service_code(self):
        import ast
        src = (ROOT / "services" / "lead-intake" / "lead_intake.py").read_text(encoding="utf-8")
        self.assertEqual([n.lineno for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Assert)], [])

    def test_same_validation_under_python_O(self):
        if sys.flags.optimize:
            self.assertGreaterEqual(sys.flags.optimize, 1)
            return
        import subprocess
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        r = subprocess.run([sys.executable, "-O", "-m", "unittest",
                            "tests.lead_intake_test.InputValidationTests.test_invalid_inputs_create_no_rows",
                            "tests.lead_intake_test.InputValidationTests.test_same_validation_under_python_O"],
                           cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Ran 2 tests", r.stderr)


if __name__ == "__main__":
    unittest.main()
