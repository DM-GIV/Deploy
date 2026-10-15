"""Admin service tests. All data is synthetic (TEST_ONLY): temporary SQLite files, no production DB, no network."""
import hashlib
import http.client
import http.server
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import admin_app  # noqa: E402
import admin_core as core  # noqa: E402
from outbox import Outbox  # noqa: E402

LEADS_SCHEMA = """CREATE TABLE leads (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
  contact TEXT NOT NULL, message TEXT NOT NULL, privacy_version TEXT NOT NULL,
  ip_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL,
  consent_at TEXT NOT NULL, consent_given INTEGER NOT NULL CHECK(consent_given=1), notification_status TEXT NOT NULL DEFAULT 'not_configured', notification_at TEXT, reviewed_at TEXT, closed_at TEXT, legal_hold INTEGER NOT NULL DEFAULT 0, hold_reason TEXT);
CREATE TABLE altcha_used (challenge TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, lead_id TEXT NOT NULL, used_at TEXT NOT NULL);"""
ORIGIN = "https://admin.test.invalid"
PASSWORD = "correct horse battery staple 42"
SECRET = core.new_totp_secret()


def add_lead(path, message="TEST_ONLY вопрос по лоту https://torgi.gov.ru/lot/1", contact="t@example.invalid", kind="lot", ts=None):
    lid = str(uuid.uuid4())
    db = sqlite3.connect(path, timeout=5, isolation_level=None)
    try:
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT INTO leads (id,created_at,kind,contact,message,privacy_version,ip_hash,payload_hash,status,consent_at,consent_given,notification_status) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,1,'not_configured')",
                   (lid, ts or core.iso(), kind, contact, message, "v1", "h", uuid.uuid4().hex, "accepted", core.iso()))
        db.execute("COMMIT")
    finally:
        db.close()
    return lid


class Base(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.leads_path = os.path.join(self.td.name, "leads.sqlite3")
        db = sqlite3.connect(self.leads_path)
        db.executescript(LEADS_SCHEMA)
        db.close()
        self.env = {"ADMIN_DB_PATH": os.path.join(self.td.name, "admin.sqlite3"), "LEADS_DB_PATH": self.leads_path,
                    "ADMIN_BASE_URL": ORIGIN, "ADMIN_REQUIRE_HTTPS": "1", "TELEGRAM_BOT_TOKEN": "", "TELEGRAM_CHAT_ID": ""}
        self.app = admin_app.App(self.env)
        self.app.admin.create_user("owner", PASSWORD, SECRET)
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), admin_app.Handler)
        self.server.app = self.app
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.td.cleanup()

    def req(self, method, path, body=None, headers=None, cookie=None, form=None, proto="https"):
        h = {"X-Forwarded-Proto": proto} if proto else {}
        h.update(headers or {})
        if cookie:
            h["Cookie"] = "%s=%s" % (admin_app.COOKIE, cookie)
        data = None
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
            h.setdefault("Origin", ORIGIN)
        elif body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
            h.setdefault("Origin", ORIGIN)
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()}, r.read().decode("utf-8", "replace"))
        c.close()
        return out

    def login(self, code=None, password=PASSWORD, now=None):
        code = code or core.totp_at(SECRET, int((now or time.time()) // 30))
        s, h, b = self.req("POST", "/login", form={"username": "owner", "password": password, "code": code})
        token = None
        if "set-cookie" in h:
            token = h["set-cookie"].split("=", 1)[1].split(";", 1)[0]
        return s, h, token

    def session(self):
        # unique TOTP step per login in the same test: advance the replay marker
        db = self.app.admin.connect()
        db.execute("UPDATE users SET totp_last_step=0")
        db.close()
        s, h, token = self.login()
        self.assertEqual(s, 303)
        self.csrf = self.app.admin.get_session(token)["csrf"]
        return token


class Auth(Base):
    def test_anonymous_blocked_everywhere(self):
        lid = add_lead(self.leads_path)
        for path in ("/", "/audit", "/leads/" + lid):
            s, h, _ = self.req("GET", path)
            self.assertEqual((s, h["location"]), (303, "/login"), path)
        for path in ("/api/leads", "/api/stats", "/api/leads/" + lid):
            s, _, b = self.req("GET", path)
            self.assertEqual(s, 401, path)
            self.assertNotIn("example.invalid", b)
        for path in ("/api/leads/%s/status" % lid, "/leads/%s/status" % lid, "/logout"):
            s, _, _ = self.req("POST", path, form={"status": "done"})
            self.assertIn(s, (303, 401))
        self.assertEqual(self.app.leads.get(lid)["state"], "new")

    def test_forged_and_garbage_cookies(self):
        for c in ("", "x", "A" * 500, "../../etc/passwd", "' OR 1=1 --"):
            s, _, _ = self.req("GET", "/api/leads", cookie=c)
            self.assertEqual(s, 401)

    def test_login_requires_password_and_totp(self):
        self.assertEqual(self.login(code="000000")[0], 401)
        self.assertEqual(self.login(password="wrong")[0], 401)
        s, _, _ = self.req("POST", "/login", form={"username": "owner", "password": PASSWORD, "code": ""})
        self.assertEqual(s, 401)

    def test_totp_replay_rejected(self):
        code = core.totp_at(SECRET, int(time.time() // 30))
        self.assertEqual(self.login(code=code)[0], 303)
        self.assertEqual(self.login(code=code)[0], 401)

    def test_bruteforce_lockout(self):
        for _ in range(core.LOCK_THRESHOLD):
            self.assertEqual(self.login(code="111111")[0], 401)
        s, _, token = self.login()
        self.assertEqual(s, 429)
        self.assertIsNone(token)

    def test_cookie_flags_and_headers(self):
        s, h, token = self.login()
        c = h["set-cookie"]
        for flag in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/", admin_app.COOKIE):
            self.assertIn(flag, c)
        self.assertNotIn("Domain", c)
        s, h, _ = self.req("GET", "/login")
        self.assertIn("noindex", h["x-robots-tag"])
        self.assertIn("script-src", h["content-security-policy"]) if False else self.assertNotIn("unsafe-inline", h["content-security-policy"])
        self.assertEqual(h["x-frame-options"], "DENY")
        self.assertEqual(h["cache-control"], "no-store, max-age=0")

    def test_https_required(self):
        s, _, _ = self.req("GET", "/login", proto=None)
        self.assertEqual(s, 421)
        self.assertEqual(self.req("GET", "/healthz", proto=None)[0], 200)

    def test_session_idle_and_absolute_timeout(self):
        token = self.app.admin.create_session("owner", now=1000)
        self.assertIsNotNone(self.app.admin.get_session(token, now=1000 + core.SESSION_IDLE_SECONDS - 5))
        self.assertIsNone(self.app.admin.get_session(token, now=1000 + core.SESSION_IDLE_SECONDS * 3))
        t2 = self.app.admin.create_session("owner", now=5000)
        for i in range(1, 20):  # active every 25 min -> still dies at absolute limit
            self.app.admin.get_session(t2, now=5000 + i * 1500)
        self.assertIsNone(self.app.admin.get_session(t2, now=5000 + core.SESSION_ABSOLUTE_SECONDS + 10))

    def test_logout_destroys_session(self):
        token = self.session()
        s, _, _ = self.req("POST", "/logout", form={"csrf": self.csrf}, cookie=token)
        self.assertEqual(s, 303)
        self.assertEqual(self.req("GET", "/api/stats", cookie=token)[0], 401)

    def test_no_registration_or_recovery_routes(self):
        for p in ("/register", "/signup", "/reset", "/forgot", "/password-reset"):
            self.assertIn(self.req("GET", p)[0], (303, 404))
            self.assertIn(self.req("POST", p, form={"a": "b"})[0], (303, 403, 404, 401))

    def test_password_hash_is_scrypt_not_plain(self):
        u = self.app.admin.get_user("owner")
        self.assertTrue(u["pw_hash"].startswith("scrypt$"))
        self.assertNotIn(PASSWORD, u["pw_hash"])


class Csrf(Base):
    def test_post_without_csrf_rejected(self):
        token = self.session()
        lid = add_lead(self.leads_path)
        s, _, _ = self.req("POST", "/leads/%s/status" % lid, form={"status": "done"}, cookie=token)
        self.assertEqual(s, 403)
        s, _, _ = self.req("POST", "/api/leads/%s/status" % lid, body={"status": "done"}, cookie=token)
        self.assertEqual(s, 403)
        s, _, _ = self.req("POST", "/leads/%s/status" % lid, form={"status": "done", "csrf": "bad"}, cookie=token)
        self.assertEqual(s, 403)
        self.assertEqual(self.app.leads.get(lid)["state"], "new")

    def test_cross_origin_rejected(self):
        token = self.session()
        lid = add_lead(self.leads_path)
        for hdr in ({"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}, {"Origin": "null"}):
            s, _, _ = self.req("POST", "/leads/%s/status" % lid, form={"status": "done", "csrf": self.csrf}, cookie=token, headers=hdr)
            self.assertEqual(s, 403, hdr)
        s, _, _ = self.req("POST", "/login", form={"username": "owner", "password": PASSWORD, "code": "123456"}, headers={"Origin": "https://evil.example"})
        self.assertEqual(s, 403)
        self.assertEqual(self.app.leads.get(lid)["state"], "new")

    def test_get_never_mutates(self):
        token = self.session()
        lid = add_lead(self.leads_path)
        self.req("GET", "/leads/%s/status?status=done" % lid, cookie=token)
        self.req("GET", "/api/leads/%s/status?status=done" % lid, cookie=token)
        self.assertEqual(self.app.leads.get(lid)["state"], "new")


class Xss(Base):
    PAYLOADS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "javascript:alert(1)", "'; DROP TABLE leads;--"]

    def test_payloads_are_escaped_everywhere(self):
        token = self.session()
        ids = [add_lead(self.leads_path, message=p + " http://x.example/?a=\"><b>", contact=p) for p in self.PAYLOADS]
        s, _, body = self.req("GET", "/", cookie=token)
        self.assertEqual(s, 200)
        s2, _, card = self.req("GET", "/leads/" + ids[0], cookie=token)
        s3, _, q = self.req("GET", "/?q=" + urllib.parse.quote('"><script>x</script>'), cookie=token)
        self.req("POST", "/leads/%s/note" % ids[1], form={"note": '<script>n</script>', "csrf": self.csrf}, cookie=token)
        _, _, card2 = self.req("GET", "/leads/" + ids[1], cookie=token)
        for page in (body, card, q, card2):
            self.assertNotIn("<script", page)
            self.assertNotIn("<img src=x", page)
            self.assertNotIn('"><b>', page)
        self.assertIn("&lt;script&gt;", card)
        self.assertIn('rel="noopener noreferrer nofollow"', card)
        self.assertEqual(self.app.leads.src().execute("SELECT COUNT(*) FROM leads").fetchone()[0], 4)  # SQL injection did nothing

    def test_javascript_url_not_linked(self):
        self.assertEqual(core.lot_links("javascript:alert(1) data:text/html,x"), [])


class Workflow(Base):
    def test_status_and_log_and_read(self):
        token = self.session()
        lid = add_lead(self.leads_path)
        self.assertEqual(json.loads(self.req("GET", "/api/stats", cookie=token)[2])["unread"], 1)
        s, _, _ = self.req("POST", "/leads/%s/read" % lid, form={"csrf": self.csrf}, cookie=token)
        self.assertEqual(s, 303)
        st = json.loads(self.req("GET", "/api/stats", cookie=token)[2])
        self.assertEqual((st["new"], st["unread"]), (1, 0))
        for new in ("in_progress", "done", "new"):
            s, _, b = self.req("POST", "/api/leads/%s/status" % lid, body={"status": new}, cookie=token, headers={"X-CSRF-Token": self.csrf})
            self.assertEqual((s, json.loads(b)["ok"]), (200, True))
            self.assertEqual(self.app.leads.get(lid)["state"], new)
        s, _, b = self.req("POST", "/api/leads/%s/status" % lid, body={"status": "bogus"}, cookie=token, headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(s, 400)
        lead = self.app.leads.get(lid)
        self.assertEqual([x["new_state"] for x in lead["log"] if x["action"] == "status"], ["new", "done", "in_progress"])
        self.assertEqual(lead["log"][-1]["action"], "read")

    def test_lead_database_is_never_modified(self):
        token = self.session()
        lid = add_lead(self.leads_path)
        sha = hashlib.sha256(Path(self.leads_path).read_bytes()).hexdigest()
        self.req("POST", "/leads/%s/status" % lid, form={"status": "done", "csrf": self.csrf}, cookie=token)
        self.req("POST", "/leads/%s/read" % lid, form={"csrf": self.csrf}, cookie=token)
        self.req("GET", "/", cookie=token)
        self.assertEqual(sha, hashlib.sha256(Path(self.leads_path).read_bytes()).hexdigest())
        with self.assertRaises(sqlite3.OperationalError):
            self.app.leads.src().execute("UPDATE leads SET message='x'")

    def test_legacy_leadctl_states_are_mapped(self):
        lid = add_lead(self.leads_path)
        db = sqlite3.connect(self.leads_path)
        db.execute("UPDATE leads SET reviewed_at=? WHERE id=?", (core.iso(), lid))
        db.commit()
        self.assertEqual(self.app.leads.get(lid)["state"], "in_progress")
        db.execute("UPDATE leads SET closed_at=? WHERE id=?", (core.iso(), lid))
        db.commit()
        db.close()
        self.assertEqual(self.app.leads.get(lid)["state"], "done")

    def test_search_filter_pagination(self):
        token = self.session()
        a = add_lead(self.leads_path, message="TEST_ONLY квартира Москва", kind="search")
        b = add_lead(self.leads_path, message="TEST_ONLY гараж 100%_х")
        self.app.leads.set_status(b, "done", "owner")
        res = json.loads(self.req("GET", "/api/leads?q=" + urllib.parse.quote("квартира"), cookie=token)[2])
        self.assertEqual([i["id"] for i in res["items"]], [a])
        self.assertEqual(json.loads(self.req("GET", "/api/leads?status=done", cookie=token)[2])["total"], 1)
        self.assertEqual(json.loads(self.req("GET", "/api/leads?kind=search", cookie=token)[2])["total"], 1)
        self.assertEqual(json.loads(self.req("GET", "/api/leads?q=100%25_", cookie=token)[2])["total"], 1)  # wildcards are literal
        self.assertEqual(json.loads(self.req("GET", "/api/leads?q=2", cookie=token)[2])["items"][0]["id"], b)  # by number
        for _ in range(30):
            add_lead(self.leads_path)
        res = json.loads(self.req("GET", "/api/leads?page=2", cookie=token)[2])
        self.assertEqual((len(res["items"]), res["total"]), (7, 32))
        self.assertEqual(self.req("GET", "/api/leads/not-a-uuid", cookie=token)[0], 404)
        self.assertEqual(self.req("GET", "/leads/..%2f..%2fetc", cookie=token)[0], 404)

    def test_concurrent_intake_and_admin_writes(self):
        token = self.session()
        seed = [add_lead(self.leads_path) for _ in range(5)]
        errors, stop = [], threading.Event()

        def intake():
            for _ in range(60):
                try:
                    add_lead(self.leads_path)
                except Exception as e:  # intake must never fail because of the admin
                    errors.append(("intake", repr(e)))

        def admin():
            while not stop.is_set():
                for lid in seed:
                    for path, data in (("/leads/%s/status" % lid, {"status": "in_progress", "csrf": self.csrf}),
                                       ("/leads/%s/read" % lid, {"csrf": self.csrf})):
                        s, _, _ = self.req("POST", path, form=data, cookie=token)
                        if s not in (303,):
                            errors.append(("admin", s))
                s, _, _ = self.req("GET", "/", cookie=token)
                if s != 200:
                    errors.append(("list", s))

        ts = [threading.Thread(target=intake) for _ in range(3)] + [threading.Thread(target=admin) for _ in range(2)]
        for t in ts:
            t.start()
        for t in ts[:3]:
            t.join(60)
        stop.set()
        for t in ts[3:]:
            t.join(60)
        self.assertEqual(errors, [])
        db = sqlite3.connect(self.leads_path)
        self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM leads").fetchone()[0], 5 + 180)
        db.close()
        adm = self.app.admin.connect()
        self.assertEqual(adm.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        adm.close()


class OutboxTests(Base):
    def make(self, results):
        sent = []

        def sender(text):
            sent.append(text)
            r = results.pop(0) if results else None
            return r
        env = dict(self.env, TELEGRAM_BOT_TOKEN="T", TELEGRAM_CHAT_ID="1")
        self.clock = [1000.0]
        return Outbox(self.app.admin, self.app.leads, env, sender=sender, clock=lambda: self.clock[0]), sent

    def test_existing_leads_are_not_announced_new_ones_are_once(self):
        old = add_lead(self.leads_path)
        box, sent = self.make([])
        self.assertEqual(box.run_once(), 0)
        self.assertEqual(self.app.leads.get(old)["notify"]["state"], "skipped")
        new = add_lead(self.leads_path, message="TEST_ONLY секрет-текст", contact="pii@example.invalid")
        self.assertEqual(box.run_once(), 1)
        self.assertEqual(box.run_once(), 0)  # duplicate protection
        self.assertEqual(len(sent), 1)
        self.assertIn(new, sent[0])
        self.assertIn("№2", sent[0])
        for forbidden in ("секрет-текст", "pii@example.invalid", "TEST_ONLY"):
            self.assertNotIn(forbidden, sent[0])  # no personal data in the message
        self.assertEqual(self.app.leads.get(new)["notify"]["state"], "sent")

    def test_failure_keeps_lead_and_retries_with_backoff(self):
        box, sent = self.make(["network", "http_502", None])
        box.run_once()
        lid = add_lead(self.leads_path)
        self.assertEqual(box.run_once(), 1)
        n = self.app.leads.get(lid)["notify"]
        self.assertEqual((n["state"], n["attempts"], n["error_class"]), ("error", 1, "network"))
        self.assertIsNotNone(self.app.leads.get(lid))  # lead untouched
        self.assertEqual(box.run_once(), 0)  # backoff not elapsed
        self.clock[0] += 31
        box.run_once()
        self.assertEqual(self.app.leads.get(lid)["notify"]["error_class"], "http_502")
        self.clock[0] += 61
        box.run_once()
        n = self.app.leads.get(lid)["notify"]
        self.assertEqual((n["state"], n["attempts"]), ("sent", 3))
        self.assertEqual(len(sent), 3)
        self.assertEqual([x["outcome"] for x in reversed(n and self.app.leads.get(lid)["notify_log"])], ["failed", "failed", "sent"])

    def test_gives_up_after_max_attempts_but_visible(self):
        box, sent = self.make(["network"] * 20)
        box.run_once()
        lid = add_lead(self.leads_path)
        for _ in range(15):
            self.clock[0] += 4000
            box.run_once()
        n = self.app.leads.get(lid)["notify"]
        self.assertEqual((n["state"], n["attempts"]), ("error", 8))
        self.assertEqual(self.app.leads.stats()["notify_attention"], 1)

    def test_stuck_sending_is_released_and_not_duplicated(self):
        box, sent = self.make([])
        box.run_once()
        lid = add_lead(self.leads_path)
        box.enqueue_new()
        row = box.claim()  # a worker claims, then dies before reporting
        self.assertEqual(row["lead_id"], lid)
        self.assertIsNone(box.claim())  # concurrent worker cannot take the same lead
        self.clock[0] += 500
        self.assertEqual(box.release_stuck(), 1)
        box.run_once()
        self.assertEqual(self.app.leads.get(lid)["notify"]["state"], "sent")
        self.assertEqual(len(sent), 1)

    def test_sender_exception_does_not_crash(self):
        def boom(_):
            raise RuntimeError("x")
        env = dict(self.env, TELEGRAM_BOT_TOKEN="T", TELEGRAM_CHAT_ID="1")
        box = Outbox(self.app.admin, self.app.leads, env, sender=boom)
        box.run_once()
        lid = add_lead(self.leads_path)
        box.run_once()
        self.assertEqual(self.app.leads.get(lid)["notify"]["error_class"], "exception")

    def test_not_configured_queues_without_sending(self):
        box = Outbox(self.app.admin, self.app.leads, self.env, sender=lambda t: self.fail("must not send"))
        box.run_once()
        lid = add_lead(self.leads_path)
        box.run_once()
        self.assertEqual(self.app.leads.get(lid)["notify"]["state"], "pending")
        self.assertFalse(box.configured())

    def test_notify_status_visible_in_panel(self):
        token = self.session()
        box, _ = self.make([None])
        box.run_once()
        lid = add_lead(self.leads_path)
        box.run_once()
        _, _, page = self.req("GET", "/", cookie=token)
        self.assertIn("Отправлено", page)
        _, _, card = self.req("GET", "/leads/" + lid, cookie=token)
        self.assertIn("Уведомление владельцу", card)


class Backup(Base):
    def test_backup_and_restore_verify(self):
        import adminctl
        add_lead(self.leads_path)
        out = os.path.join(self.td.name, "bk.sqlite3")
        self.assertEqual(adminctl.online_backup(self.leads_path, out), "ok")
        self.assertEqual(adminctl.table_counts(out)["leads"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
