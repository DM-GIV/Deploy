"""TorgAtlas admin: storage, authentication and lead access (stdlib only, no third-party dependencies).

Design rules
- The lead database written by lead-intake is opened READ-ONLY here. Its schema and rows are never modified.
- Processing state (new / in_progress / done), notes, users, sessions and the audit log live in a separate admin database.
- Passwords: scrypt. MFA: TOTP (RFC 6238) with replay protection. Sessions: random token, only its SHA-256 is stored.
"""
import base64
import datetime as dt
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import sqlite3
import struct
import threading
import time
import urllib.parse
import uuid
from pathlib import Path

ADMIN_SCHEMA_VERSION = 1
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 15, 8, 1
SESSION_IDLE_SECONDS = 30 * 60
SESSION_ABSOLUTE_SECONDS = 8 * 3600
LOCK_THRESHOLD, LOCK_WINDOW, LOCK_SECONDS = 5, 15 * 60, 15 * 60
STATUSES = ("new", "in_progress", "done")
STATUS_LABELS = {"new": "Новая", "in_progress": "В работе", "done": "Завершена"}
KIND_LABELS = {"lot": "Вопрос по лоту", "search": "Подбор имущества"}
MSK = dt.timezone(dt.timedelta(hours=3))  # Moscow has no DST; avoids a tzdata dependency
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_hash_slots = threading.BoundedSemaphore(2)  # scrypt uses ~32 MiB each; bound concurrent logins


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def iso(ts=None):
    return (ts or utcnow()).isoformat(timespec="seconds")


# ---------------------------------------------------------------- passwords / TOTP
def hash_password(password):
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, maxmem=96 * 1024 * 1024, dklen=32)
    return "scrypt$%d$%d$%d$%s$%s" % (SCRYPT_N, SCRYPT_R, SCRYPT_P, base64.b64encode(salt).decode(), base64.b64encode(key).decode())


def verify_password(password, stored):
    try:
        scheme, n, r, p, salt, key = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n), int(r), int(p)
        if n > 2 ** 17 or r > 16 or p > 4:
            return False
        calc = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=n, r=r, p=p, maxmem=160 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(key))
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = None


def dummy_hash():
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    return _DUMMY_HASH


def new_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_at(secret, step):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    return "%06d" % ((struct.unpack(">I", digest[off:off + 4])[0] & 0x7FFFFFFF) % 1000000)


def totp_match(secret, code, now=None, last_step=0):
    """Return the matched time step (>last_step) or None. Window +-1 step; a used step is never accepted again."""
    if not (isinstance(code, str) and len(code) == 6 and code.isdigit()):
        return None
    cur = int((now if now is not None else time.time()) // 30)
    for step in (cur - 1, cur, cur + 1):
        if step > last_step and hmac.compare_digest(totp_at(secret, step), code):
            return step
    return None


# ---------------------------------------------------------------- admin database
class AdminDB:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.Lock()
        self.init()

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def init(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        db = self.connect()
        try:
            db.execute("PRAGMA journal_mode=WAL")  # own database: WAL is safe here and keeps readers non-blocking
            db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
              username TEXT PRIMARY KEY, pw_hash TEXT NOT NULL, totp_secret TEXT NOT NULL,
              totp_last_step INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, csrf TEXT NOT NULL,
              created REAL NOT NULL, last_seen REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS login_attempts (
              id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, key TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key, ts);
            CREATE TABLE IF NOT EXISTS lead_no (
              num INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS lead_state (
              lead_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('new','in_progress','done')),
              updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, read_at TEXT);
            CREATE TABLE IF NOT EXISTS lead_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT NOT NULL, ts TEXT NOT NULL, actor TEXT NOT NULL,
              action TEXT NOT NULL, old_state TEXT, new_state TEXT, note TEXT);
            CREATE INDEX IF NOT EXISTS lead_log_lead ON lead_log(lead_id, id);
            CREATE TABLE IF NOT EXISTS audit (
              id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT, ip TEXT, action TEXT NOT NULL,
              target TEXT, ok INTEGER NOT NULL);
            -- persistent outbox: one row per lead (PRIMARY KEY = no duplicate notification), states:
            -- pending -> sending -> sent | error (retry until MAX_ATTEMPTS) | skipped (existed before notifications were enabled)
            CREATE TABLE IF NOT EXISTS notify (
              lead_id TEXT PRIMARY KEY, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              next_try REAL NOT NULL DEFAULT 0, ts TEXT NOT NULL, error_class TEXT, claimed REAL);
            CREATE TABLE IF NOT EXISTS notify_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT NOT NULL, ts TEXT NOT NULL, outcome TEXT NOT NULL, error_class TEXT);
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            db.execute("PRAGMA user_version=%d" % ADMIN_SCHEMA_VERSION)
        finally:
            db.close()
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    # ---- users
    def get_user(self, username):
        db = self.connect()
        try:
            return db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        finally:
            db.close()

    def create_user(self, username, password, secret):
        db = self.connect()
        try:
            db.execute("INSERT INTO users (username,pw_hash,totp_secret,created_at) VALUES (?,?,?,?)",
                       (username, hash_password(password), secret, iso()))
        finally:
            db.close()

    def has_users(self):
        db = self.connect()
        try:
            return db.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0
        finally:
            db.close()

    # ---- audit
    def audit(self, actor, ip, action, target=None, ok=True):
        db = self.connect()
        try:
            db.execute("INSERT INTO audit (ts,actor,ip,action,target,ok) VALUES (?,?,?,?,?,?)",
                       (iso(), actor, ip, action, target, 1 if ok else 0))
            db.execute("DELETE FROM audit WHERE id < (SELECT COALESCE(MAX(id),0) FROM audit) - 50000")
        finally:
            db.close()

    def audit_rows(self, limit=200):
        db = self.connect()
        try:
            return db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        finally:
            db.close()

    # ---- brute-force protection
    def locked(self, keys, now=None):
        now = now if now is not None else time.time()
        db = self.connect()
        try:
            for key in keys:
                rows = db.execute("SELECT ts FROM login_attempts WHERE key=? AND ts>? ORDER BY ts DESC",
                                  (key, now - LOCK_WINDOW)).fetchall()
                if len(rows) >= LOCK_THRESHOLD and now - rows[0][0] < LOCK_SECONDS:
                    return True
            return False
        finally:
            db.close()

    def record_failure(self, keys, now=None):
        now = now if now is not None else time.time()
        db = self.connect()
        try:
            for key in keys:
                db.execute("INSERT INTO login_attempts (ts,key) VALUES (?,?)", (now, key))
            db.execute("DELETE FROM login_attempts WHERE ts<?", (now - 86400,))
        finally:
            db.close()

    def clear_failures(self, keys):
        db = self.connect()
        try:
            for key in keys:
                db.execute("DELETE FROM login_attempts WHERE key=?", (key,))
        finally:
            db.close()

    # ---- sessions
    def create_session(self, username, now=None):
        now = now if now is not None else time.time()
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        db = self.connect()
        try:
            db.execute("DELETE FROM sessions WHERE created<?", (now - SESSION_ABSOLUTE_SECONDS,))
            db.execute("INSERT INTO sessions (token_hash,username,csrf,created,last_seen) VALUES (?,?,?,?,?)",
                       (hashlib.sha256(token.encode()).hexdigest(), username, csrf, now, now))
        finally:
            db.close()
        return token

    def get_session(self, token, now=None):
        if not token or len(token) > 100:
            return None
        now = now if now is not None else time.time()
        h = hashlib.sha256(token.encode()).hexdigest()
        db = self.connect()
        try:
            row = db.execute("SELECT s.*, u.active FROM sessions s JOIN users u ON u.username=s.username WHERE token_hash=?", (h,)).fetchone()
            if not row:
                return None
            if (not row["active"] or now - row["created"] > SESSION_ABSOLUTE_SECONDS
                    or now - row["last_seen"] > SESSION_IDLE_SECONDS):
                db.execute("DELETE FROM sessions WHERE token_hash=?", (h,))
                return None
            if now - row["last_seen"] > 30:
                db.execute("UPDATE sessions SET last_seen=? WHERE token_hash=?", (now, h))
            return {"username": row["username"], "csrf": row["csrf"]}
        finally:
            db.close()

    def destroy_session(self, token):
        db = self.connect()
        try:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256((token or "").encode()).hexdigest(),))
        finally:
            db.close()

    # ---- login
    def login(self, username, password, code, ip, now=None):
        """Return (token|None, reason). The same generic failure is reported for every credential problem."""
        now = now if now is not None else time.time()
        username = (username or "").strip().lower()[:64]
        keys = ["ip:" + ip, "user:" + username]
        if self.locked(keys, now):
            self.audit(username or None, ip, "login_locked", ok=False)
            return None, "locked"
        user = self.get_user(username)
        with _hash_slots:
            pw_ok = verify_password(password or "", user["pw_hash"] if user else dummy_hash())
        step = totp_match(user["totp_secret"], code or "", now, user["totp_last_step"]) if user else None
        if not (user and user["active"] and pw_ok and step):
            self.record_failure(keys, now)
            self.audit(username or None, ip, "login_failed", ok=False)
            return None, "invalid"
        db = self.connect()
        try:
            changed = db.execute("UPDATE users SET totp_last_step=? WHERE username=? AND totp_last_step<?",
                                 (step, username, step)).rowcount
        finally:
            db.close()
        if not changed:  # concurrent replay of the same code
            self.record_failure(keys, now)
            self.audit(username, ip, "login_replay", ok=False)
            return None, "invalid"
        self.clear_failures(keys)
        self.audit(username, ip, "login_ok")
        return self.create_session(username, now), "ok"


# ---------------------------------------------------------------- leads (read-only source + overlay)
class Leads:
    SCAN_LIMIT = 20000

    def __init__(self, leads_path, admin):
        self.path = str(leads_path)
        self.admin = admin

    def src(self):
        if not Path(self.path).is_file():
            raise FileNotFoundError("leads database missing")
        db = sqlite3.connect("file:%s?mode=ro" % self.path, uri=True, timeout=3)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=3000")
        db.execute("PRAGMA query_only=ON")
        return db

    def sync_numbers(self):
        """Assign stable, human-friendly numbers (1,2,3...) to leads in creation order. Writes only the admin DB."""
        src = self.src()
        try:
            ids = [r[0] for r in src.execute("SELECT id FROM leads ORDER BY created_at, id LIMIT ?", (self.SCAN_LIMIT,))]
        finally:
            src.close()
        db = self.admin.connect()
        try:
            known = {r[0] for r in db.execute("SELECT lead_id FROM lead_no")}
            missing = [i for i in ids if i not in known]
            if missing:
                db.execute("BEGIN IMMEDIATE")
                db.executemany("INSERT OR IGNORE INTO lead_no (lead_id) VALUES (?)", [(i,) for i in missing])
                db.execute("COMMIT")
        finally:
            db.close()

    @staticmethod
    def derived_state(row, overlay):
        if overlay:
            return overlay
        if row["closed_at"]:
            return "done"
        if row["reviewed_at"]:
            return "in_progress"  # reviewed with the legacy leadctl ack
        return "new"

    def overlay_maps(self):
        db = self.admin.connect()
        try:
            nums = {r[0]: r[1] for r in db.execute("SELECT lead_id,num FROM lead_no")}
            states = {r[0]: r[1] for r in db.execute("SELECT lead_id,state FROM lead_state")}
            self._read = {r[0] for r in db.execute("SELECT lead_id FROM lead_state WHERE read_at IS NOT NULL")}
            return nums, states
        finally:
            db.close()

    def list(self, q="", status="", kind="", page=1, per_page=25):
        self.sync_numbers()
        nums, states = self.overlay_maps()
        notif = self.notify_states()
        src = self.src()
        try:
            sql = "SELECT id,created_at,kind,substr(message,1,400) AS message,reviewed_at,closed_at FROM leads"
            where, args = [], []
            if kind in KIND_LABELS:
                where.append("kind=?")
                args.append(kind)
            q = (q or "").strip()[:100]
            numq = None
            if q:
                if q.lstrip("#№").isdigit():
                    numq = int(q.lstrip("#№"))
                else:
                    esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                    where.append("(message LIKE ? ESCAPE '\\' OR contact LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')")
                    args += ["%" + esc + "%"] * 3
            if where:
                sql += " WHERE " + " AND ".join(where)
            sql += " ORDER BY created_at DESC, id LIMIT ?"
            rows = src.execute(sql, args + [self.SCAN_LIMIT]).fetchall()
            counts = {s: 0 for s in STATUSES}
            for r in src.execute("SELECT id,reviewed_at,closed_at FROM leads LIMIT ?", (self.SCAN_LIMIT,)):
                counts[self.derived_state(r, states.get(r["id"]))] += 1
        finally:
            src.close()
        items = []
        for r in rows:
            st = self.derived_state(r, states.get(r["id"]))
            n = nums.get(r["id"])
            if status in STATUSES and st != status:
                continue
            if numq is not None and n != numq:
                continue
            items.append({"id": r["id"], "num": n, "created_at": r["created_at"], "kind": r["kind"],
                          "summary": r["message"], "status": st, "unread": st == "new" and r["id"] not in self._read,
                          "notify": notif.get(r["id"], "none")})
        total = len(items)
        page = max(1, page)
        return {"items": items[(page - 1) * per_page:page * per_page], "total": total, "page": page,
                "per_page": per_page, "counts": counts}

    def notify_states(self):
        db = self.admin.connect()
        try:
            return {r[0]: r[1] for r in db.execute("SELECT lead_id,state FROM notify")}
        finally:
            db.close()

    def mark_read(self, lead_id, actor):
        if not UUID_RE.match(lead_id or "") or not self.get(lead_id):
            return False
        db = self.admin.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT read_at FROM lead_state WHERE lead_id=?", (lead_id,)).fetchone()
            if row and row["read_at"]:
                db.execute("COMMIT")
                return True
            if row:
                db.execute("UPDATE lead_state SET read_at=? WHERE lead_id=?", (iso(), lead_id))
            else:
                db.execute("INSERT INTO lead_state (lead_id,state,updated_at,updated_by,read_at) VALUES (?,?,?,?,?)",
                           (lead_id, "new", iso(), actor, iso()))
            db.execute("INSERT INTO lead_log (lead_id,ts,actor,action) VALUES (?,?,?,?)", (lead_id, iso(), actor, "read"))
            db.execute("COMMIT")
        except BaseException:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            db.close()
        return True

    def get(self, lead_id):
        if not UUID_RE.match(lead_id or ""):
            return None
        self.sync_numbers()
        src = self.src()
        try:
            r = src.execute("SELECT id,created_at,kind,contact,message,privacy_version,status,consent_at,consent_given,"
                            "notification_status,notification_at,reviewed_at,closed_at,legal_hold,hold_reason "
                            "FROM leads WHERE id=?", (lead_id,)).fetchone()
        finally:
            src.close()
        if not r:
            return None
        db = self.admin.connect()
        try:
            n = db.execute("SELECT num FROM lead_no WHERE lead_id=?", (lead_id,)).fetchone()
            st = db.execute("SELECT state,updated_at,updated_by,read_at FROM lead_state WHERE lead_id=?", (lead_id,)).fetchone()
            nt = db.execute("SELECT state,attempts,ts,error_class FROM notify WHERE lead_id=?", (lead_id,)).fetchone()
            nlog = db.execute("SELECT ts,outcome,error_class FROM notify_log WHERE lead_id=? ORDER BY id DESC LIMIT 20", (lead_id,)).fetchall()
            log = db.execute("SELECT ts,actor,action,old_state,new_state,note FROM lead_log WHERE lead_id=? ORDER BY id DESC LIMIT 200",
                             (lead_id,)).fetchall()
        finally:
            db.close()
        d = dict(r)
        d["num"] = n[0] if n else None
        d["state"] = self.derived_state(r, st["state"] if st else None)
        d["state_updated_at"] = st["updated_at"] if st else None
        d["read_at"] = st["read_at"] if st else None
        d["notify"] = dict(nt) if nt else None
        d["notify_log"] = [dict(x) for x in nlog]
        d["log"] = [dict(x) for x in log]
        return d

    def set_status(self, lead_id, new_state, actor):
        if new_state not in STATUSES or not UUID_RE.match(lead_id or ""):
            return False, "invalid"
        cur = self.get(lead_id)
        if not cur:
            return False, "not_found"
        db = self.admin.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM lead_state WHERE lead_id=?", (lead_id,)).fetchone()
            old = row["state"] if row else cur["state"]
            db.execute("INSERT INTO lead_state (lead_id,state,updated_at,updated_by) VALUES (?,?,?,?) "
                       "ON CONFLICT(lead_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                       (lead_id, new_state, iso(), actor))
            db.execute("INSERT INTO lead_log (lead_id,ts,actor,action,old_state,new_state) VALUES (?,?,?,?,?,?)",
                       (lead_id, iso(), actor, "status", old, new_state))
            db.execute("COMMIT")
        except BaseException:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            db.close()
        return True, "ok"

    def add_note(self, lead_id, text, actor):
        text = (text or "").strip()[:2000]
        if not text or not UUID_RE.match(lead_id or "") or not self.get(lead_id):
            return False
        db = self.admin.connect()
        try:
            db.execute("INSERT INTO lead_log (lead_id,ts,actor,action,note) VALUES (?,?,?,?,?)",
                       (lead_id, iso(), actor, "note", text))
        finally:
            db.close()
        return True

    def stats(self):
        self.sync_numbers()
        _, states = self.overlay_maps()
        src = self.src()
        try:
            counts = {s: 0 for s in STATUSES}
            total = 0
            for r in src.execute("SELECT id,reviewed_at,closed_at FROM leads LIMIT ?", (self.SCAN_LIMIT,)):
                counts[self.derived_state(r, states.get(r["id"]))] += 1
                total += 1
        finally:
            src.close()
        db = self.admin.connect()
        try:
            n_err = db.execute("SELECT COUNT(*) FROM notify WHERE state IN ('error','sending','pending')").fetchone()[0]
        finally:
            db.close()
        unread = max(0, counts["new"] - self.read_new_count())
        return {"total": total, **counts, "unread": unread, "notify_attention": n_err}

    def read_new_count(self):
        db = self.admin.connect()
        try:
            return db.execute("SELECT COUNT(*) FROM lead_state WHERE state='new' AND read_at IS NOT NULL").fetchone()[0]
        finally:
            db.close()


def lot_links(text):
    """Return http(s) URLs found in the message (as plain strings; the caller must escape them)."""
    out = []
    for m in re.finditer(r"https?://[^\s<>\"']{4,300}", text or ""):
        u = m.group(0).rstrip(".,;:)»")
        p = urllib.parse.urlsplit(u)
        if p.scheme in ("http", "https") and p.hostname and u not in out:
            out.append(u)
    return out[:5]


def msk(ts):
    try:
        return dt.datetime.fromisoformat(ts).astimezone(MSK).strftime("%d.%m.%Y %H:%M")
    except (TypeError, ValueError):
        return ts or "—"


def trusted_peer(peer, spec):
    try:
        addr = ipaddress.ip_address(peer)
        return any(addr in ipaddress.ip_network(n.strip(), strict=False) for n in spec.split(",") if n.strip())
    except ValueError:
        return False
