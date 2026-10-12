"""Manual bounded retention tool: dry-run by default, no cron or automatic deletion.

Deletion needs an approved retention period AND LEAD_RETENTION_LEGAL_APPROVED=true AND --execute.
No retention period is approved today (LEGAL_PENDING); this tool must not be scheduled.
"""
import argparse
import datetime as dt
import os
import sqlite3
from pathlib import Path


def run(env=None, execute=False):
    e = dict(os.environ if env is None else env)
    path = Path(e.get("DATA_DB_PATH", ""))
    days = e.get("LEAD_RETENTION_DAYS", "")
    if not path.is_absolute() or not path.is_file() or not days.isdigit():
        return {"ok": False, "code": "RETENTION_NOT_CONFIGURED"}
    limit = int(days)
    if not 30 <= limit <= 3650:
        return {"ok": False, "code": "RETENTION_INVALID"}
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=limit)).isoformat()
    db = sqlite3.connect(str(path), timeout=5)
    try:
        # only reviewed, accepted leads are ever candidates; unreviewed ones are never auto-deleted
        where = "status='accepted' AND reviewed_at IS NOT NULL AND created_at<?"
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
    p.add_argument("--execute", action="store_true")
    print(run(execute=p.parse_args().execute))
