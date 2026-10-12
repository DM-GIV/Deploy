"""Owner-only read/report CLI for the TorgAtlas lead database. Run on the server as the deploy user:

  python3 leadctl.py [--db PATH] stats            counts only, safe to paste into reports
  python3 leadctl.py [--db PATH] list [--all]     new (unreviewed) leads; shows contacts, terminal only
  python3 leadctl.py [--db PATH] show ID          one full lead, terminal only
  python3 leadctl.py [--db PATH] ack ID           mark a lead as reviewed (nothing is deleted)
  python3 leadctl.py [--db PATH] close ID         purpose reached / interaction finished: starts the 30-day destruction clock
  python3 leadctl.py [--db PATH] hold ID --reason TEXT      other lawful basis (e.g. contract) -> excluded from destruction
  python3 leadctl.py [--db PATH] release-hold ID  remove the hold
  python3 leadctl.py [--db PATH] cleanup-test ID [--execute]
                                                  delete ONE synthetic test lead (contact must be *@example.invalid
                                                  and message must start with TEST_E2E_); dry-run by default

Output of list/show contains personal data: never copy it to Linear, Git, Umami or logs.
"""
import argparse
import datetime as dt
import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = "/home/deploy/torgatlas-ops/isolated/lead-intake/data/leads.sqlite3"


def open_db(path, write=False):
    if not Path(path).is_file():
        sys.exit("DB_NOT_FOUND: " + path)
    uri = "file:%s?mode=%s" % (path, "rw" if write else "ro")
    db = sqlite3.connect(uri, uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA synchronous=FULL")
    return db


def stats(db):
    out = {}
    out["total"] = db.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    out["new_unreviewed"] = db.execute("SELECT COUNT(*) FROM leads WHERE reviewed_at IS NULL AND status='accepted'").fetchone()[0]
    out["closed"] = db.execute("SELECT COUNT(*) FROM leads WHERE closed_at IS NOT NULL").fetchone()[0]
    out["held"] = db.execute("SELECT COUNT(*) FROM leads WHERE legal_hold=1").fetchone()[0]
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat()
    out["overdue_destruction"] = db.execute("SELECT COUNT(*) FROM leads WHERE closed_at IS NOT NULL AND legal_hold=0 AND closed_at<?", (cutoff,)).fetchone()[0]
    for row in db.execute("SELECT status, COUNT(*) FROM leads GROUP BY status ORDER BY status"):
        out["status:" + row[0]] = row[1]
    for row in db.execute("SELECT notification_status, COUNT(*) FROM leads GROUP BY notification_status ORDER BY 1"):
        out["notification:" + row[0]] = row[1]
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=os.environ.get("DATA_DB_PATH", DEFAULT_DB))
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats")
    ls = sub.add_parser("list")
    ls.add_argument("--all", action="store_true")
    ls.add_argument("--limit", type=int, default=50)
    for name in ("show", "ack", "close", "release-hold"):
        sub.add_parser(name).add_argument("id")
    hd = sub.add_parser("hold")
    hd.add_argument("id")
    hd.add_argument("--reason", required=True)
    ct = sub.add_parser("cleanup-test")
    ct.add_argument("id")
    ct.add_argument("--execute", action="store_true")
    a = p.parse_args(argv)

    if a.cmd == "stats":
        db = open_db(a.db)
        for k, v in stats(db).items():
            print("%s=%s" % (k, v))
    elif a.cmd == "list":
        db = open_db(a.db)
        where = "" if a.all else "WHERE reviewed_at IS NULL"
        rows = db.execute("SELECT id,created_at,kind,status,notification_status,reviewed_at,contact FROM leads %s "
                          "ORDER BY created_at DESC LIMIT ?" % where, (max(1, min(a.limit, 500)),)).fetchall()
        print("id\tcreated_at\tkind\tstatus\tnotification\treviewed\tcontact")
        for r in rows:
            print("\t".join(str(r[k] or "-") for k in r.keys()))
        print("rows=%d" % len(rows))
    elif a.cmd == "show":
        db = open_db(a.db)
        r = db.execute("SELECT * FROM leads WHERE id=?", (a.id,)).fetchone()
        if not r:
            sys.exit("NOT_FOUND")
        for k in r.keys():
            if k not in ("ip_hash", "payload_hash"):
                print("%s: %s" % (k, r[k]))
    elif a.cmd == "ack":
        db = open_db(a.db, write=True)
        with db:
            n = db.execute("UPDATE leads SET reviewed_at=? WHERE id=? AND reviewed_at IS NULL",
                           (dt.datetime.now(dt.timezone.utc).isoformat(), a.id)).rowcount
        print("acknowledged=%d" % n)
    elif a.cmd in ("close", "hold", "release-hold"):
        db = open_db(a.db, write=True)
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        with db:
            if a.cmd == "close":
                n = db.execute("UPDATE leads SET closed_at=?, reviewed_at=COALESCE(reviewed_at,?) WHERE id=? AND closed_at IS NULL", (now, now, a.id)).rowcount
            elif a.cmd == "hold":
                n = db.execute("UPDATE leads SET legal_hold=1, hold_reason=? WHERE id=?", (a.reason[:300], a.id)).rowcount
            else:
                n = db.execute("UPDATE leads SET legal_hold=0, hold_reason=NULL WHERE id=?", (a.id,)).rowcount
        print("%s=%d" % (a.cmd, n))
    elif a.cmd == "cleanup-test":
        db = open_db(a.db, write=True)
        r = db.execute("SELECT contact,message FROM leads WHERE id=?", (a.id,)).fetchone()
        if not r:
            sys.exit("NOT_FOUND")
        if not (r["contact"].lower().endswith("@example.invalid") and r["message"].startswith("TEST_E2E_")):
            sys.exit("REFUSED: not a marked synthetic test lead; real leads are never deleted by this tool")
        if not a.execute:
            print("DRY_RUN: would delete 1 test lead and its altcha_used row")
            return
        with db:
            db.execute("DELETE FROM altcha_used WHERE lead_id=?", (a.id,))
            db.execute("DELETE FROM leads WHERE id=?", (a.id,))
        print("deleted=1")


if __name__ == "__main__":
    main()
