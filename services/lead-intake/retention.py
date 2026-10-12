"""Manual bounded retention tool: dry-run by default, no cron or automatic deletion."""
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
    cutoff = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=limit)).isoformat()
    db = sqlite3.connect(str(path), timeout=3)
    try:
        count = db.execute("SELECT COUNT(*) FROM leads WHERE status='accepted' AND created_at<?", (cutoff,)).fetchone()[0]
        if not execute:
            return {"ok": True, "mode": "DRY_RUN", "candidates": count}
        if e.get("LEAD_RETENTION_LEGAL_APPROVED") != "true":
            return {"ok": False, "code": "LEGAL_APPROVAL_REQUIRED"}
        with db:
            deleted = db.execute("DELETE FROM leads WHERE status='accepted' AND created_at<?", (cutoff,)).rowcount
        return {"ok": True, "mode": "EXECUTED", "deleted": deleted}
    finally:
        db.close()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--execute", action="store_true")
    print(run(execute=p.parse_args().execute))
