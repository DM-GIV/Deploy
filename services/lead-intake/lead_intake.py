"""TorgAtlas-only lead service; fail-closed, standard library, independent of Cloud."""
import datetime as dt
import hashlib
import hmac
import http.server
import ipaddress
import json
import os
import smtplib
import sqlite3
import ssl
import threading
import time
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict, deque
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlsplit

VERIFY_URL = "https://smartcaptcha.cloud.yandex.ru/validate"
MAX_BODY = 12288
RATE_LIMIT = 20


class App:
    def __init__(self, env=None, captcha=None, delivery=None, clock=None):
        self.env = dict(os.environ if env is None else env)
        self.captcha = captcha or self.verify_captcha
        self.delivery = delivery or self.send_email
        self.clock = clock or time.monotonic
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def enabled(self):
        e = self.env
        required = ("SMARTCAPTCHA_SITE_KEY", "SMARTCAPTCHA_SECRET", "SMTP_HOST", "SMTP_PORT",
                    "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "LEAD_EMAIL_TO",
                    "LEAD_ALLOWED_ORIGIN", "DATA_DB_PATH", "LEAD_HASH_SALT")
        return (e.get("DIRECT_LEADS_ENABLED") == "true"
                and e.get("DIRECT_LEADS_LEGAL_APPROVED") == "true"
                and all(isinstance(e.get(k), str) and e[k].strip() for k in required)
                and len(e["LEAD_HASH_SALT"]) >= 32
                and e["LEAD_ALLOWED_ORIGIN"] == "https://torgatlas.ru"
                and e["SMTP_PORT"] in ("465", "587")
                and Path(e["DATA_DB_PATH"]).is_absolute())

    def hash(self, text):
        return hmac.new(self.env["LEAD_HASH_SALT"].encode(), text.encode(), hashlib.sha256).hexdigest()

    def limit(self, ip):
        key = self.hash(ip)
        now = self.clock()
        with self.lock:
            q = self.hits[key]
            while q and q[0] <= now - 60:
                q.popleft()
            if len(q) >= RATE_LIMIT:
                return False
            q.append(now)
            if len(self.hits) > 10000:
                for k in list(self.hits):
                    if not self.hits[k] or self.hits[k][-1] < now - 60:
                        del self.hits[k]
            return True

    def connect(self):
        path = Path(self.env["DATA_DB_PATH"])
        if not path.parent.is_dir():
            raise OSError("DB_PARENT_MISSING")
        previous = os.umask(0o077)
        try:
            db = sqlite3.connect(str(path), timeout=3)
            db.execute("""CREATE TABLE IF NOT EXISTS leads (
              id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
              contact TEXT NOT NULL, message TEXT NOT NULL, privacy_version TEXT NOT NULL,
              ip_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL,
              consent_at TEXT NOT NULL, consent_given INTEGER NOT NULL CHECK(consent_given=1))""")
            return db
        finally:
            os.umask(previous)

    def set_status(self, ident, status):
        try:
            db = self.connect()
            try:
                with db:
                    db.execute("UPDATE leads SET status=? WHERE id=?", (status, ident))
                return True
            finally:
                db.close()
        except (sqlite3.Error, OSError):
            return False

    def verify_captcha(self, token, ip):
        params = {"secret": self.env["SMARTCAPTCHA_SECRET"], "token": token}
        try:
            ipaddress.ip_address(ip)
            params["ip"] = ip
        except ValueError:
            pass
        request = urllib.request.Request(
            VERIFY_URL, data=urllib.parse.urlencode(params).encode(), method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(request, timeout=5) as reply:
                if reply.status != 200:
                    return False
                data = reply.read(2049)
            if len(data) > 2048:
                return False
            result = json.loads(data)
            return (result.get("status") == "ok"
                    and result.get("host") == urlsplit(self.env["LEAD_ALLOWED_ORIGIN"]).hostname)
        except (OSError, TimeoutError, ValueError):
            return False

    def send_email(self, ident, kind, contact, message, version):
        env = self.env
        mail = EmailMessage()
        mail["From"] = env["SMTP_FROM"]
        mail["To"] = env["LEAD_EMAIL_TO"]
        mail["Subject"] = "TorgAtlas lead " + ident
        mail.set_content("ID: "+ident+"\nType: "+kind+"\nContact: "+contact+
                         "\nConsent: "+version+"\n\n"+message)
        port = int(env["SMTP_PORT"])
        if port == 465:
            smtp = smtplib.SMTP_SSL(env["SMTP_HOST"], port, timeout=7, context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(env["SMTP_HOST"], port, timeout=7)
        with smtp:
            if port == 587:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            smtp.login(env["SMTP_USER"], env["SMTP_PASSWORD"])
            if smtp.send_message(mail):
                raise RuntimeError("RECIPIENT_REFUSED")

    def process(self, method, path, headers, raw=None, ip="127.0.0.1"):
        if method == "GET" and path == "/health":
            return 200, {"ok": True, "enabled": self.enabled()}
        if method == "GET" and path == "/api/lead-config":
            if not self.enabled():
                return 200, {"enabled": False}
            return 200, {"enabled": True, "siteKey": self.env["SMARTCAPTCHA_SITE_KEY"]}
        if path != "/api/lead":
            return 404, {"ok": False, "code": "NOT_FOUND"}
        if method != "POST":
            return 405, {"ok": False, "code": "METHOD_NOT_ALLOWED"}
        # This must run before request body consumption, SQLite or outbound network.
        if not self.enabled():
            return 503, {"ok": False, "code": "NOT_CONFIGURED"}
        if headers.get("origin") != self.env["LEAD_ALLOWED_ORIGIN"]:
            return 403, {"ok": False, "code": "ORIGIN_DENIED"}
        if not headers.get("content-type", "").lower().startswith("application/json"):
            return 415, {"ok": False, "code": "UNSUPPORTED_MEDIA"}
        if raw is None or len(raw) > MAX_BODY:
            return (413 if raw is not None else 400), {"ok": False, "code": "INVALID_BODY"}
        if not self.limit(ip):
            return 429, {"ok": False, "code": "RATE_LIMITED"}
        try:
            item = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            return 400, {"ok": False, "code": "INVALID_JSON"}
        if not isinstance(item, dict):
            return 422, {"ok": False, "code": "INVALID_INPUT"}
        if "turnstileToken" in item:
            return 422, {"ok": False, "code": "OLD_CAPTCHA_UNSUPPORTED"}
        try:
            ident = item["id"]
            obj = uuid.UUID(ident)
            assert str(obj) == ident and obj.version == 4
            kind = item["kind"]
            contact = item["contact"].strip()
            message = item["message"].strip()
            version = item["privacyVersion"]
            token = item["captchaToken"]
            assert kind in ("lot", "search")
            assert 5 <= len(contact) <= 180 and "\n" not in contact and "\r" not in contact
            assert 40 <= len(message) <= 6000
            assert item["consent"] is True and item.get("website", "") == ""
            assert isinstance(version, str) and 1 <= len(version) <= 40 and version.replace("-", "").isalnum()
            assert isinstance(token, str) and 10 <= len(token) <= 4096
        except (KeyError, TypeError, ValueError, AttributeError, AssertionError):
            return 422, {"ok": False, "code": "INVALID_INPUT"}
        payload_hash = self.hash(json.dumps([ident, kind, contact, message, version],
                                             ensure_ascii=False, separators=(",", ":")))
        if Path(self.env["DATA_DB_PATH"]).exists():
            try:
                db = self.connect()
                try:
                    saved = db.execute("SELECT status,payload_hash FROM leads WHERE id=?", (ident,)).fetchone()
                    if saved:
                        if not hmac.compare_digest(saved[1], payload_hash):
                            return 409, {"ok": False, "code": "ID_CONFLICT"}
                        if saved[0] == "accepted":
                            return 200, {"ok": True, "code": "ACCEPTED", "receipt": ident, "accepted": True, "id": ident}
                        return 503, {"ok": False, "code": "DELIVERY_UNCONFIRMED"}
                finally:
                    db.close()
            except (sqlite3.Error, OSError):
                return 503, {"ok": False, "code": "UNAVAILABLE"}
        try:
            valid = self.captcha(token, ip)
        except Exception:
            valid = False
        if not valid:
            return 403, {"ok": False, "code": "CAPTCHA_FAILED"}
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        try:
            db = self.connect()
            try:
                db.execute("BEGIN IMMEDIATE")
                saved = db.execute("SELECT status,payload_hash FROM leads WHERE id=?", (ident,)).fetchone()
                if saved:
                    db.rollback()
                    if not hmac.compare_digest(saved[1], payload_hash):
                        return 409, {"ok": False, "code": "ID_CONFLICT"}
                    if saved[0] == "accepted":
                        return 200, {"ok": True, "code": "ACCEPTED", "receipt": ident, "accepted": True, "id": ident}
                    return 503, {"ok": False, "code": "DELIVERY_UNCONFIRMED"}
                db.execute("""INSERT INTO leads
                    (id,created_at,kind,contact,message,privacy_version,ip_hash,payload_hash,status,consent_at,consent_given)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                           (ident, now, kind, contact, message, version,
                            self.hash(ip), payload_hash, "pending_delivery", now, 1))
                db.commit()
            finally:
                db.close()
        except (sqlite3.Error, OSError):
            return 503, {"ok": False, "code": "UNAVAILABLE"}
        try:
            self.delivery(ident, kind, contact, message, version)
        except Exception:
            self.set_status(ident, "delivery_unknown")
            return 502, {"ok": False, "code": "DELIVERY_UNCONFIRMED"}
        if not self.set_status(ident, "accepted"):
            return 503, {"ok": False, "code": "DELIVERY_UNCONFIRMED"}
        return 200, {"ok": True, "code": "ACCEPTED", "receipt": ident, "accepted": True, "id": ident}


class Handler(http.server.BaseHTTPRequestHandler):
    def serve(self):
        app = self.server.app
        path = urllib.parse.urlsplit(self.path).path
        method = self.command
        headers = {k.lower(): v for k, v in self.headers.items()}
        # Disabled: never consume PII body. Always close keepalive after response.
        if method == "POST" and path == "/api/lead" and app.enabled():
            length = self.headers.get("Content-Length", "")
            if not length.isdigit():
                code, result = 411, {"ok": False, "code": "LENGTH_REQUIRED"}
            elif int(length) > MAX_BODY:
                code, result = 413, {"ok": False, "code": "INVALID_BODY"}
            else:
                raw = self.rfile.read(int(length))
                code, result = app.process(method, path, headers, raw, self.client_ip())
        else:
            code, result = app.process(method, path, headers)
        encoded = json.dumps(result, separators=(",", ":")).encode()
        self.send_response(code)
        for key, value in (("Content-Type", "application/json; charset=utf-8"),
                           ("Cache-Control", "no-store, max-age=0"),
                           ("X-Content-Type-Options", "nosniff"),
                           ("Content-Length", str(len(encoded))), ("Connection", "close")):
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)
        self.close_connection = True

    def client_ip(self):
        ip = self.client_address[0]
        if ip in ("127.0.0.1", "::1") and self.headers.get("X-Real-IP"):
            value = self.headers["X-Real-IP"]
            try:
                ipaddress.ip_address(value)
                return value
            except ValueError:
                pass
        return ip

    do_GET = serve
    do_POST = serve
    do_HEAD = serve
    do_OPTIONS = serve

    def log_message(self, *_):
        # Never output user content, URL, IP, contact or token.
        return


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 8081), Handler)
    server.app = App()
    print("TorgAtlas lead service initialized; enabled="+str(server.app.enabled()), flush=True)
    server.serve_forever()
