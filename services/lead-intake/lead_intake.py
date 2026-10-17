"""TorgAtlas-only lead service: local ALTCHA + durable SQLite, SMTP optional.

Standard library plus the vendored MIT altcha-lib-py v1 module. No Cloud/Core
dependency, no external CAPTCHA/verification endpoint, no outbound network
except the optional best-effort SMTP notification after durable acceptance.
"""
import base64
import binascii
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
import stat
import threading
import time
import urllib.parse
import uuid
from collections import defaultdict, deque
from email.message import EmailMessage
from pathlib import Path

try:  # run as a package module (tests) or as a flat /app layout (container)
    from .vendor import altcha_v1 as altcha
except ImportError:
    from vendor import altcha_v1 as altcha

MAX_BODY = 12288
SUBMIT_RATE_LIMIT = 20          # POST /api/lead per HMAC-IP per minute
CHALLENGE_RATE_LIMIT = 30       # GET /api/altcha-challenge per HMAC-IP per minute
ALTCHA_ALGORITHM = "SHA-256"
ALTCHA_MAX_NUMBER = 300000      # proof-of-work ceiling, also enforced on verification
ALTCHA_TTL_SECONDS = 600
ALTCHA_SALT_BYTES = 16
ALTCHA_PAYLOAD_MAX = 2048
ACCEPTED_CONSENT_VERSIONS = frozenset({"2026-10-12.2"})
SCHEMA_VERSION = 3
SMTP_KEYS = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "LEAD_EMAIL_TO")
HEX64 = frozenset("0123456789abcdef")


def strong_secret(value):
    """>=32 chars with real variety; rejects placeholders such as 'aaaa...' or 'changeme...'."""
    return (isinstance(value, str) and len(value) >= 32 and len(set(value)) >= 12
            and value == value.strip() and not value.lower().startswith(("change", "example", "todo")))


class App:
    def __init__(self, env=None, delivery=None, clock=None, wall=None, spawn=None):
        self.env = dict(os.environ if env is None else env)
        self.delivery = delivery or self.send_email
        self.clock = clock or time.monotonic
        self.wall = wall or time.time
        self.spawn = spawn or self._spawn_thread
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()
        self._ready_cache = (0.0, False)

    @staticmethod
    def _spawn_thread(fn):
        threading.Thread(target=fn, daemon=True).start()

    # ---- configuration gates -------------------------------------------------
    def enabled(self):
        """Configuration gate only. SMTP_* and any external network never matter here."""
        e = self.env
        path = e.get("DATA_DB_PATH")
        return (e.get("DIRECT_LEADS_ENABLED") == "true"
                and e.get("DIRECT_LEADS_LEGAL_APPROVED") == "true"
                and e.get("LEAD_ALLOWED_ORIGIN") == "https://torgatlas.ru"
                and e.get("LEAD_CONSENT_VERSION") in ACCEPTED_CONSENT_VERSIONS
                and isinstance(path, str) and Path(path).is_absolute()
                and strong_secret(e.get("LEAD_HASH_SALT"))
                and strong_secret(e.get("ALTCHA_HMAC_KEY"))
                and e.get("LEAD_HASH_SALT") != e.get("ALTCHA_HMAC_KEY"))

    def smtp_configured(self):
        e = self.env
        return (all(isinstance(e.get(k), str) and e[k].strip() for k in SMTP_KEYS)
                and e["SMTP_PORT"] in ("465", "587", "1126", "1127"))

    def ready(self):
        """enabled() plus a real, privately stored, durable, migrated database (cached 5 s)."""
        if not self.enabled():
            return False
        now = self.clock()
        checked, value = self._ready_cache
        if checked and now - checked < 5:
            return value
        try:
            db = self.connect()
            try:
                value = (db.execute("PRAGMA synchronous").fetchone()[0] == 2
                         and db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
                         and db.execute("PRAGMA journal_mode").fetchone()[0].lower() in ("delete", "wal")
                         and self.private_storage_ok())
            finally:
                db.close()
        except (sqlite3.Error, OSError):
            value = False
        self._ready_cache = (now, value)
        return value

    def private_storage_ok(self):
        path = Path(self.env["DATA_DB_PATH"])
        try:
            return (stat.S_IMODE(path.parent.stat().st_mode) & 0o077 == 0
                    and stat.S_IMODE(path.stat().st_mode) & 0o077 == 0)
        except OSError:
            return False

    # ---- hashing / rate limits ----------------------------------------------
    def hash(self, text):
        return hmac.new(self.env["LEAD_HASH_SALT"].encode(), text.encode(), hashlib.sha256).hexdigest()

    def limit(self, ip, bucket="submit", cap=SUBMIT_RATE_LIMIT):
        key = bucket + ":" + self.hash(ip)
        now = self.clock()
        with self.lock:
            if key not in self.hits and len(self.hits) >= 8192:
                for old in list(self.hits):
                    if not self.hits[old] or self.hits[old][-1] < now - 60:
                        del self.hits[old]
                if len(self.hits) >= 8192:
                    return False
            q = self.hits[key]
            while q and q[0] <= now - 60:
                q.popleft()
            if len(q) >= cap:
                return False
            q.append(now)
            return True

    # ---- SQLite ---------------------------------------------------------------
    def connect(self):
        """Open the database, apply PRAGMAs, and migrate (with exact backup first) when needed."""
        path = Path(self.env["DATA_DB_PATH"])
        if not path.parent.is_dir():
            raise OSError("DB_PARENT_MISSING")
        previous = os.umask(0o077)
        try:
            db = sqlite3.connect(str(path), timeout=5, isolation_level=None)
            try:
                db.execute("PRAGMA synchronous=FULL")
                db.execute("PRAGMA busy_timeout=5000")
                self._migrate(db, path)
            except BaseException:
                db.close()
                raise
            return db
        finally:
            os.umask(previous)

    def _migrate(self, db, path):
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version == SCHEMA_VERSION:
            return
        if version > SCHEMA_VERSION:
            raise sqlite3.DatabaseError("SCHEMA_NEWER_THAN_CODE")
        had_data = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='leads'").fetchone()
        if had_data:  # exact copy of real submissions before any ALTER; never overwritten
            backup_dir = path.parent / "pre-migration-backups"
            backup_dir.mkdir(mode=0o700, exist_ok=True)
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            target = backup_dir / ("leads-v%d-%s.sqlite3" % (version, stamp))
            fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
            copy = sqlite3.connect(str(target))
            try:
                db.backup(copy)
            finally:
                copy.close()
        db.execute("BEGIN IMMEDIATE")
        try:
            if db.execute("PRAGMA user_version").fetchone()[0] != version:
                db.execute("ROLLBACK")  # another process migrated first
                return self._migrate(db, path)
            db.execute("""CREATE TABLE IF NOT EXISTS leads (
              id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
              contact TEXT NOT NULL, message TEXT NOT NULL, privacy_version TEXT NOT NULL,
              ip_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL,
              consent_at TEXT NOT NULL, consent_given INTEGER NOT NULL CHECK(consent_given=1))""")
            cols = {row[1] for row in db.execute("PRAGMA table_info(leads)")}
            for name, ddl in (("notification_status", "TEXT NOT NULL DEFAULT 'not_configured'"),
                              ("notification_at", "TEXT"),
                              ("reviewed_at", "TEXT"),
                              ("closed_at", "TEXT"),              # purpose reached / interaction finished (owner action)
                              ("legal_hold", "INTEGER NOT NULL DEFAULT 0"),  # other lawful basis, e.g. contract
                              ("hold_reason", "TEXT")):
                if name not in cols:
                    db.execute("ALTER TABLE leads ADD COLUMN %s %s" % (name, ddl))
            db.execute("""CREATE TABLE IF NOT EXISTS altcha_used (
              challenge TEXT PRIMARY KEY, expires_at INTEGER NOT NULL,
              lead_id TEXT NOT NULL, used_at TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS altcha_used_expires ON altcha_used(expires_at)")
            db.execute("PRAGMA user_version=%d" % SCHEMA_VERSION)
            db.execute("COMMIT")
        except BaseException:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        try:
            os.chmod(str(path), 0o600)
        except OSError:
            pass

    # ---- ALTCHA -----------------------------------------------------------------
    def issue_challenge(self):
        expires = dt.datetime.fromtimestamp(int(self.wall()) + ALTCHA_TTL_SECONDS, dt.timezone.utc)
        challenge = altcha.create_challenge(altcha.ChallengeOptions(
            algorithm=ALTCHA_ALGORITHM, max_number=ALTCHA_MAX_NUMBER, salt_length=ALTCHA_SALT_BYTES,
            hmac_key=self.env["ALTCHA_HMAC_KEY"], expires=expires)).to_dict()
        challenge["maxnumber"] = challenge.pop("maxNumber")  # field name used by the ALTCHA protocol documentation
        return challenge

    def verify_altcha(self, token):
        """Stateless cryptographic check per the official ALTCHA v1 protocol. Returns (challenge, expires) or None."""
        if not isinstance(token, str) or not 20 <= len(token) <= ALTCHA_PAYLOAD_MAX:
            return None
        try:
            data = json.loads(base64.b64decode(token, validate=True).decode("utf-8"))
        except (ValueError, binascii.Error, UnicodeError):
            return None
        if not isinstance(data, dict):
            return None
        number, salt, challenge, signature = data.get("number"), data.get("salt"), data.get("challenge"), data.get("signature")
        if (data.get("algorithm") != ALTCHA_ALGORITHM or type(number) is not int
                or not 0 <= number <= ALTCHA_MAX_NUMBER):
            return None
        if not (isinstance(salt, str) and 10 <= len(salt) <= 200 and isinstance(challenge, str)
                and isinstance(signature, str) and len(challenge) == 64 and len(signature) == 64
                and set(challenge) <= HEX64 and set(signature) <= HEX64):
            return None
        core = {k: data[k] for k in ("algorithm", "challenge", "number", "salt", "signature")}
        try:
            expires = altcha.extract_params(core).get("expires") or []
            if len(expires) != 1:
                return None
            expires_at = int(expires[0])
            now = int(self.wall())
            if expires_at < now or expires_at > now + ALTCHA_TTL_SECONDS + 5:
                return None
            ok, _ = altcha.verify_solution(core, self.env["ALTCHA_HMAC_KEY"], check_expires=True)
        except (ValueError, TypeError, KeyError):
            return None
        return (challenge, expires_at) if ok else None

    # ---- optional SMTP (after durable acceptance only) -------------------------
    def send_email(self, ident, kind, contact, message, version):
        env = self.env
        mail = EmailMessage()
        mail["From"] = env["SMTP_FROM"]
        mail["To"] = env["LEAD_EMAIL_TO"]
        mail["Subject"] = "TorgAtlas lead " + ident
        mail.set_content("ID: " + ident + "\nType: " + kind + "\nContact: " + contact +
                         "\nConsent: " + version + "\n\n" + message)
        port = int(env["SMTP_PORT"])
        if port in (465, 1127):
            smtp = smtplib.SMTP_SSL(env["SMTP_HOST"], port, timeout=7, context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(env["SMTP_HOST"], port, timeout=7)
        with smtp:
            if port in (587, 1126):
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            smtp.login(env["SMTP_USER"], env["SMTP_PASSWORD"])
            if smtp.send_message(mail):
                raise RuntimeError("RECIPIENT_REFUSED")

    def notify(self, ident, kind, contact, message, version):
        """At-most-once claim: only the claim winner sends; an ambiguous result is never retried."""
        def set_state(expected, new):
            try:
                db = self.connect()
                try:
                    cur = db.execute("UPDATE leads SET notification_status=?, notification_at=? "
                                     "WHERE id=? AND notification_status=?",
                                     (new, dt.datetime.now(dt.timezone.utc).isoformat(), ident, expected))
                    return cur.rowcount == 1
                finally:
                    db.close()
            except (sqlite3.Error, OSError):
                return False
        if not set_state("pending", "sending"):
            return
        try:
            self.delivery(ident, kind, contact, message, version)
            set_state("sending", "sent")
        except Exception:
            set_state("sending", "failed")

    # ---- request processing -----------------------------------------------------
    @staticmethod
    def accepted(ident):
        return 200, {"ok": True, "code": "ACCEPTED", "receipt": ident, "accepted": True, "id": ident}

    def process(self, method, path, headers, raw=None, ip="127.0.0.1"):
        if method == "GET" and path == "/health":
            return 200, {"ok": True, "enabled": self.enabled()}
        if method == "GET" and path == "/api/lead-config":
            if not self.ready():
                return 200, {"enabled": False}
            return 200, {"enabled": True, "consentVersion": self.env["LEAD_CONSENT_VERSION"],
                         "altcha": {"challengeUrl": "/api/altcha-challenge", "maxNumber": ALTCHA_MAX_NUMBER}}
        if method == "GET" and path == "/api/altcha-challenge":
            if not self.ready():
                return 503, {"ok": False, "code": "NOT_CONFIGURED"}
            if not self.limit(ip, "challenge", CHALLENGE_RATE_LIMIT):
                return 429, {"ok": False, "code": "RATE_LIMITED"}
            return 200, self.issue_challenge()
        if path != "/api/lead":
            return 404, {"ok": False, "code": "NOT_FOUND"}
        if method != "POST":
            return 405, {"ok": False, "code": "METHOD_NOT_ALLOWED"}
        # Must run before request body consumption, SQLite or any other work.
        if not self.ready():
            return 503, {"ok": False, "code": "NOT_CONFIGURED"}
        if headers.get("origin") != self.env["LEAD_ALLOWED_ORIGIN"]:
            return 403, {"ok": False, "code": "ORIGIN_DENIED"}
        if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
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
        try:
            ident = item["id"]
            kind = item["kind"]
            contact = item["contact"]
            message = item["message"]
            version = item["privacyVersion"]
            token = item["altcha"]
            consent = item["consent"]
            if not all(isinstance(v, str) for v in (ident, kind, contact, message, version, token)):
                raise ValueError("type")
            obj = uuid.UUID(ident)
            contact, message = contact.strip(), message.strip()
            # Explicit checks (never `assert`): they must hold under `python -O` too.
            if str(obj) != ident or obj.version != 4:
                raise ValueError("id")
            if kind not in ("lot", "search"):
                raise ValueError("kind")
            if not (5 <= len(contact) <= 180) or "\n" in contact or "\r" in contact:
                raise ValueError("contact")
            if not (40 <= len(message) <= 6000):
                raise ValueError("message")
            if consent is not True or item.get("website", "") != "":
                raise ValueError("consent")
            if version != self.env["LEAD_CONSENT_VERSION"]:
                raise ValueError("version")
        except (KeyError, TypeError, ValueError, AttributeError):
            return 422, {"ok": False, "code": "INVALID_INPUT"}
        payload_hash = self.hash(json.dumps([ident, kind, contact, message, version],
                                             ensure_ascii=False, separators=(",", ":")))
        # Idempotency first: same UUID + identical payload is a replay of the same request, not a new CAPTCHA use.
        try:
            db = self.connect()
            try:
                saved = db.execute("SELECT payload_hash FROM leads WHERE id=?", (ident,)).fetchone()
            finally:
                db.close()
        except (sqlite3.Error, OSError):
            return 503, {"ok": False, "code": "UNAVAILABLE"}
        if saved:
            if not hmac.compare_digest(saved[0], payload_hash):
                return 409, {"ok": False, "code": "ID_CONFLICT"}
            return self.accepted(ident)
        solved = self.verify_altcha(token)
        if solved is None:
            return 403, {"ok": False, "code": "CAPTCHA_FAILED"}
        challenge, challenge_expires = solved
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        smtp_state = "pending" if self.smtp_configured() else "not_configured"
        try:
            db = self.connect()
            try:
                db.execute("BEGIN IMMEDIATE")
                try:
                    saved = db.execute("SELECT payload_hash FROM leads WHERE id=?", (ident,)).fetchone()
                    if saved:
                        db.execute("ROLLBACK")
                        if not hmac.compare_digest(saved[0], payload_hash):
                            return 409, {"ok": False, "code": "ID_CONFLICT"}
                        return self.accepted(ident)
                    try:
                        db.execute("INSERT INTO altcha_used (challenge,expires_at,lead_id,used_at) VALUES (?,?,?,?)",
                                   (challenge, challenge_expires, ident, now))
                    except sqlite3.IntegrityError:
                        db.execute("ROLLBACK")
                        return 403, {"ok": False, "code": "CAPTCHA_REPLAY"}
                    db.execute("""INSERT INTO leads
                        (id,created_at,kind,contact,message,privacy_version,ip_hash,payload_hash,status,
                         consent_at,consent_given,notification_status)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                               (ident, now, kind, contact, message, version, self.hash(ip), payload_hash,
                                "accepted", now, 1, smtp_state))
                    db.execute("DELETE FROM altcha_used WHERE expires_at < ?", (int(self.wall()) - 60,))
                    db.execute("COMMIT")  # a failure here means NOT accepted
                except BaseException:
                    try:
                        db.execute("ROLLBACK")
                    except sqlite3.Error:
                        pass
                    raise
            finally:
                db.close()
        except (sqlite3.Error, OSError):
            return 503, {"ok": False, "code": "UNAVAILABLE"}
        if smtp_state == "pending":
            try:
                self.spawn(lambda: self.notify(ident, kind, contact, message, version))
            except Exception:
                pass  # notification is best-effort; the lead is already durably accepted
        return self.accepted(ident)


class Handler(http.server.BaseHTTPRequestHandler):
    timeout = 10  # slow/stalled clients must not pin worker threads

    def serve(self):
        app = self.server.app
        path = urllib.parse.urlsplit(self.path).path
        method = self.command
        headers = {k.lower(): v for k, v in self.headers.items()}
        # Disabled/not-ready: never consume the PII body. Always close keep-alive after the response.
        if method == "POST" and path == "/api/lead" and app.ready():
            length = self.headers.get("Content-Length", "")
            if "transfer-encoding" in headers or not (length.isascii() and length.isdigit()):
                code, result = 411, {"ok": False, "code": "LENGTH_REQUIRED"}
            elif int(length) > MAX_BODY:
                code, result = 413, {"ok": False, "code": "INVALID_BODY"}
            else:
                raw = self.rfile.read(int(length))
                code, result = app.process(method, path, headers, raw, self.client_ip())
        else:
            code, result = app.process(method, path, headers, None, self.client_ip())
        encoded = json.dumps(result, separators=(",", ":")).encode()
        self.send_response(code)
        for key, value in (("Content-Type", "application/json; charset=utf-8"),
                           ("Cache-Control", "no-store, max-age=0"),
                           ("X-Content-Type-Options", "nosniff"),
                           ("Content-Length", str(len(encoded))), ("Connection", "close")):
            self.send_header(key, value)
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(encoded)
        self.close_connection = True

    def client_ip(self):
        """X-Real-IP is honoured only from explicitly trusted proxy addresses (nginx on this host)."""
        peer = self.client_address[0]
        trusted = [n.strip() for n in self.server.app.env.get("LEAD_TRUSTED_PROXIES", "127.0.0.1,::1").split(",") if n.strip()]
        try:
            ok = any(ipaddress.ip_address(peer) in ipaddress.ip_network(n, strict=False) for n in trusted)
        except ValueError:
            ok = False
        value = self.headers.get("X-Real-IP")
        if ok and value:
            try:
                ipaddress.ip_address(value)
                return value
            except ValueError:
                pass
        return peer

    do_GET = serve
    do_POST = serve
    do_HEAD = serve
    do_OPTIONS = serve

    def log_message(self, *_):
        # Never output user content, URL, IP, contact, token or receipt.
        return


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 8081), Handler)
    server.app = App()
    print("TorgAtlas lead service initialized; enabled=" + str(server.app.enabled()), flush=True)
    server.serve_forever()
