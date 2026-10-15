"""Owner-only server console for the admin service. Run on the server as the deploy user, interactively.

  adminctl.py [--db PATH] create-user USERNAME     asks for the password (hidden, twice) and prints the TOTP setup URI to this terminal only
  adminctl.py [--db PATH] reset-mfa USERNAME       new TOTP secret (old sessions are dropped)
  adminctl.py [--db PATH] disable-user USERNAME
  adminctl.py [--db PATH] backup DEST_DIR --leads PATH   consistent copies (SQLite online backup) of admin and lead DBs + integrity check
  adminctl.py verify-backup FILE                   restore test: copies to a temp file, runs integrity_check, prints row counts
  adminctl.py telegram-test                        sends a one-line test message (needs TELEGRAM_* in the environment)

Passwords and TOTP secrets are never written to logs, Git or command-line arguments. Public registration does not exist.
"""
import argparse
import getpass
import os
import sqlite3
import sys
import tempfile
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from admin_core import AdminDB, hash_password, iso, new_totp_secret  # noqa: E402

DEFAULT_DB = "/home/deploy/torgatlas-ops/isolated/admin/data/admin.sqlite3"


def online_backup(src_path, dest):
    src = sqlite3.connect("file:%s?mode=ro" % src_path, uri=True, timeout=10)
    try:
        out = sqlite3.connect(str(dest))
        try:
            src.backup(out)
            ok = out.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            out.close()
    finally:
        src.close()
    os.chmod(dest, 0o600)
    return ok


def table_counts(path):
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {n: db.execute('SELECT COUNT(*) FROM "%s"' % n).fetchone()[0] for n in names}
    finally:
        db.close()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=os.environ.get("ADMIN_DB_PATH", DEFAULT_DB))
    sub = p.add_subparsers(dest="cmd", required=True)
    for n in ("create-user", "reset-mfa", "disable-user"):
        sub.add_parser(n).add_argument("username")
    b = sub.add_parser("backup")
    b.add_argument("dest")
    b.add_argument("--leads", required=True)
    sub.add_parser("verify-backup").add_argument("file")
    sub.add_parser("telegram-test")
    a = p.parse_args(argv)

    if a.cmd == "create-user":
        if not sys.stdin.isatty():
            sys.exit("REFUSED: run interactively in a server terminal")
        admin = AdminDB(a.db)
        name = a.username.strip().lower()
        if admin.get_user(name):
            sys.exit("USER_EXISTS")
        pw = getpass.getpass("Password (min 14 chars): ")
        if len(pw) < 14 or pw != getpass.getpass("Repeat: "):
            sys.exit("REFUSED: too short or mismatch")
        secret = new_totp_secret()
        admin.create_user(name, pw, secret)
        print("User created. Add this to your authenticator app (shown once, this terminal only):")
        print("otpauth://totp/%s?secret=%s&issuer=TorgAtlas%%20Admin&period=30&digits=6&algorithm=SHA1" % (urllib.parse.quote("TorgAtlas:" + name), secret))
        print("Manual key:", secret)
    elif a.cmd == "reset-mfa":
        if not sys.stdin.isatty():
            sys.exit("REFUSED: run interactively in a server terminal")
        admin = AdminDB(a.db)
        if not admin.get_user(a.username.lower()):
            sys.exit("NOT_FOUND")
        secret = new_totp_secret()
        db = admin.connect()
        try:
            db.execute("UPDATE users SET totp_secret=?, totp_last_step=0 WHERE username=?", (secret, a.username.lower()))
            db.execute("DELETE FROM sessions WHERE username=?", (a.username.lower(),))
        finally:
            db.close()
        admin.audit(a.username.lower(), "console", "mfa_reset")
        print("otpauth://totp/%s?secret=%s&issuer=TorgAtlas%%20Admin" % (urllib.parse.quote("TorgAtlas:" + a.username.lower()), secret))
    elif a.cmd == "disable-user":
        admin = AdminDB(a.db)
        db = admin.connect()
        try:
            n = db.execute("UPDATE users SET active=0 WHERE username=?", (a.username.lower(),)).rowcount
            db.execute("DELETE FROM sessions WHERE username=?", (a.username.lower(),))
        finally:
            db.close()
        print("disabled=%d" % n)
    elif a.cmd == "backup":
        dest = Path(a.dest)
        dest.mkdir(parents=True, mode=0o700, exist_ok=True)
        stamp = iso().replace(":", "").replace("-", "")
        for label, path in (("leads", a.leads), ("admin", a.db)):
            if Path(path).is_file():
                target = dest / ("%s-%s.sqlite3" % (label, stamp))
                print("%s: integrity=%s file=%s" % (label, online_backup(path, target), target))
    elif a.cmd == "verify-backup":
        with tempfile.TemporaryDirectory() as td:
            copy = Path(td) / "restore.sqlite3"
            copy.write_bytes(Path(a.file).read_bytes())
            db = sqlite3.connect(str(copy))
            try:
                print("integrity=%s" % db.execute("PRAGMA integrity_check").fetchone()[0])
            finally:
                db.close()
            print("rows=%s" % table_counts(copy))
    elif a.cmd == "telegram-test":
        from outbox import telegram_send
        err = telegram_send(os.environ.get("TELEGRAM_BOT_TOKEN", ""), os.environ.get("TELEGRAM_CHAT_ID", ""),
                            "ТоргАтлас: тест уведомлений админ-панели (без данных клиентов).", proxy=os.environ.get("TELEGRAM_PROXY") or None)
        print("telegram=%s" % ("OK" if err is None else "FAILED:" + err))
        sys.exit(0 if err is None else 1)


if __name__ == "__main__":
    main()
