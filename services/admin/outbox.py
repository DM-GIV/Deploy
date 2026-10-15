"""Persistent notification outbox for new leads (Telegram). Part of the admin service, not a separate service.

Guarantees
- The lead is already durably stored by lead-intake before anything happens here; this module only READS the lead DB.
  A Telegram failure can therefore never cancel or lose a lead.
- One outbox row per lead (PRIMARY KEY): a lead is never announced twice, even across restarts or two workers.
- Delivery is claimed atomically (pending/error -> sending). A claim older than STUCK_SECONDS is treated as stuck and re-queued.
- Retries use exponential backoff up to MAX_ATTEMPTS; every attempt is written to notify_log (no personal data, only a class of error).
- The message carries the lead number and a link to the protected admin card. It never contains contacts or the message text.
- Leads that existed when notifications were first enabled are marked 'skipped' (no flood), unless NOTIFY_EXISTING=1.
"""
import json
import sqlite3
import threading
import time
import urllib.error
import urllib.request

from admin_core import iso

MAX_ATTEMPTS = 8
STUCK_SECONDS = 120
BACKOFF = (30, 60, 120, 300, 600, 1800, 3600, 3600)


def telegram_send(token, chat_id, text, timeout=8, proxy=None):
    """Return None on success or a short error class. Never includes the token or the response body."""
    req = urllib.request.Request("https://api.telegram.org/bot%s/sendMessage" % token,
                                 data=json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy} if proxy else {}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            body = json.loads(resp.read(65536) or b"{}")
            return None if body.get("ok") is True else "telegram_rejected"
    except urllib.error.HTTPError as e:
        return "http_%d" % e.code
    except (urllib.error.URLError, TimeoutError, OSError):
        return "network"
    except ValueError:
        return "bad_response"


class Outbox:
    def __init__(self, admin, leads, env, sender=None, clock=time.time):
        self.admin, self.leads, self.env, self.clock = admin, leads, env, clock
        self.sender = sender or (lambda text: telegram_send(env.get("TELEGRAM_BOT_TOKEN", ""), env.get("TELEGRAM_CHAT_ID", ""), text,
                                                             proxy=env.get("TELEGRAM_PROXY") or None))
        self._stop = threading.Event()

    def configured(self):
        return bool(self.env.get("TELEGRAM_BOT_TOKEN") and self.env.get("TELEGRAM_CHAT_ID") and self.env.get("ADMIN_BASE_URL"))

    def message(self, lead_id, num):
        return "ТоргАтлас: новая заявка №%s.\nОткрыть: %s/leads/%s" % (num, self.env["ADMIN_BASE_URL"].rstrip("/"), lead_id)

    def enqueue_new(self):
        """Create outbox rows for leads that have none. Safe to call repeatedly and from several workers."""
        self.leads.sync_numbers()
        src = self.leads.src()
        try:
            ids = [r[0] for r in src.execute("SELECT id FROM leads ORDER BY created_at, id LIMIT ?", (self.leads.SCAN_LIMIT,))]
        finally:
            src.close()
        db = self.admin.connect()
        try:
            first = db.execute("SELECT value FROM meta WHERE key='outbox_started'").fetchone() is None
            skip = first and self.env.get("NOTIFY_EXISTING") != "1"
            db.execute("BEGIN IMMEDIATE")
            if first:
                db.execute("INSERT INTO meta (key,value) VALUES ('outbox_started',?)", (iso(),))
            known = {r[0] for r in db.execute("SELECT lead_id FROM notify")}
            for i in ids:
                if i not in known:
                    db.execute("INSERT OR IGNORE INTO notify (lead_id,state,ts) VALUES (?,?,?)", (i, "skipped" if skip else "pending", iso()))
            db.execute("COMMIT")
        except BaseException:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            db.close()

    def release_stuck(self):
        now = self.clock()
        db = self.admin.connect()
        try:
            rows = db.execute("SELECT lead_id FROM notify WHERE state='sending' AND claimed<?", (now - STUCK_SECONDS,)).fetchall()
            for r in rows:
                db.execute("UPDATE notify SET state='pending', error_class='stuck_released' WHERE lead_id=? AND state='sending'", (r[0],))
                db.execute("INSERT INTO notify_log (lead_id,ts,outcome,error_class) VALUES (?,?,?,?)", (r[0], iso(), "stuck_released", None))
            return len(rows)
        finally:
            db.close()

    def claim(self):
        now = self.clock()
        db = self.admin.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT lead_id,attempts FROM notify WHERE state IN ('pending','error') AND attempts<? AND next_try<=? "
                             "ORDER BY ts LIMIT 1", (MAX_ATTEMPTS, now)).fetchone()
            if row:
                db.execute("UPDATE notify SET state='sending', claimed=? WHERE lead_id=?", (now, row["lead_id"]))
            db.execute("COMMIT")
            return row
        except BaseException:
            try:
                db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            db.close()

    def deliver_one(self):
        row = self.claim()
        if not row:
            return False
        lead_id, attempts = row["lead_id"], row["attempts"] + 1
        db = self.admin.connect()
        try:
            n = db.execute("SELECT num FROM lead_no WHERE lead_id=?", (lead_id,)).fetchone()
        finally:
            db.close()
        try:
            err = self.sender(self.message(lead_id, n[0] if n else "?"))
        except Exception:
            err = "exception"
        db = self.admin.connect()
        try:
            if err is None:
                db.execute("UPDATE notify SET state='sent', attempts=?, error_class=NULL, ts=? WHERE lead_id=? AND state='sending'", (attempts, iso(), lead_id))
            else:
                delay = BACKOFF[min(attempts - 1, len(BACKOFF) - 1)]
                db.execute("UPDATE notify SET state='error', attempts=?, error_class=?, next_try=?, ts=ts WHERE lead_id=? AND state='sending'",
                           (attempts, err, self.clock() + delay, lead_id))
            db.execute("INSERT INTO notify_log (lead_id,ts,outcome,error_class) VALUES (?,?,?,?)",
                       (lead_id, iso(), "sent" if err is None else "failed", err))
        finally:
            db.close()
        return True

    def run_once(self):
        self.enqueue_new()
        if not self.configured():
            return 0
        self.release_stuck()
        sent = 0
        while self.deliver_one() and sent < 20:
            sent += 1
        return sent

    def summary(self):
        db = self.admin.connect()
        try:
            out = {r[0]: r[1] for r in db.execute("SELECT state,COUNT(*) FROM notify GROUP BY state")}
        finally:
            db.close()
        out["configured"] = self.configured()
        return out

    def loop(self, interval=15):
        while not self._stop.wait(interval):
            try:
                self.run_once()
            except Exception:
                pass  # never crash the admin service; state is persisted, next tick retries

    def start(self):
        t = threading.Thread(target=self.loop, daemon=True, name="outbox")
        t.start()
        return t

    def stop(self):
        self._stop.set()
