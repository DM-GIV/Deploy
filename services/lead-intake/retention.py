"""Manual bounded destruction tool (art. 21 152-FZ): dry-run by default, never scheduled, never age-based.

Only leads that the owner explicitly CLOSED (purpose reached) at least GRACE_DAYS ago and that carry no legal hold
are candidates. Unclosed, merely read, held (contract / other lawful basis) leads are never touched.
Deletion needs --execute and LEAD_RETENTION_LEGAL_APPROVED=true (owner-approved process). Run:
  python3 retention.py [--db PATH]            # dry-run count
  python3 retention.py --db PATH --execute
"""
import argparse
import datetime as dt
import os
import sqlite3
from pathlib import Path

DEFAULT_DB = "/home/deploy/torgatlas-ops/isolated/lead-intake/data/leads.sqlite3"
GRACE_DAYS = 1          # one-day recovery window after closing; statutory ceiling is 30 days after closing


def run(env=None, execute=False, grace_days=GRACE_DAYS):
    e = dict(os.environ if env is None else env)
    path = Path(e.get("DATA_DB_PATH", ""))
    if not path.is_absolute() or not path.is_file():
        return {"ok": False, "code": "RETENTION_NOT_CONFIGURED"}
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=grace_days)).isoformat()
    db = sqlite3.connect(str(path), timeout=5)
    try:
        where = "closed_at IS NOT NULL AND legal_hold=0 AND closed_at<=?"
        count = db.execute("SELECT COUNT(*) FROM leads WHERE " + where, (cutoff,)).fetchone()[0]
        if not execute:
            return {"ok": True, "mode": "DRY_RUN", "candidates": count}
        if e.get("LEAD_RETENTION_LEGAL_APPROVED") != "true":
            return {"ok": False, "code": "LEGAL_APPROVAL_REQUIRED"}
        with db:
            db.execute("DELETE FROM altcha_used WHERE lead_id IN (SELECT id FROM leads WHERE " + where + ")", (cutoff,))
            deleted = db.execute("DELETE FROM leads WHERE " + where, (cutoff,)).rowcount
        return {"ok": True, "mode": "EXECUTED", "deleted": deleted}
    finally:
        db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=os.environ.get("DATA_DB_PATH", DEFAULT_DB))
    p.add_argument("--execute", action="store_true")
    a = p.parse_args()
    print(run(dict(os.environ, DATA_DB_PATH=a.db), execute=a.execute))
