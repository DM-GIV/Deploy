#!/usr/bin/env python3
"""Owner report: measured contact CLICKS (Umami, consented visitors only) vs ENQUIRIES ACTUALLY RECEIVED (manual ledger).

A click on mailto/tel/Telegram is NOT a received enquiry. The ledger holds no personal data: only date, channel,
source and status from closed lists. No CRM, no server-side collection of contacts.

  leads_report.py add --channel telegram --source lot_check [--status received] [--date YYYY-MM-DD]
  leads_report.py report [--days 30]
"""
import argparse, csv, datetime as dt, json, os, subprocess, sys, urllib.parse, urllib.request

ROOT = os.environ.get("UMAMI_ROOT", "/home/deploy/torgatlas-ops/isolated/umami")
LEDGER = os.environ.get("TORGATLAS_LEAD_LEDGER", "/home/deploy/torgatlas-ops/ops/lead-ledger.csv")
CHANNELS = ("email", "telegram", "phone", "other")
SOURCES = ("lot_check", "search_brief", "direct_contact", "unknown")
STATUSES = ("received", "qualified", "declined")
FIELDS = ["date", "channel", "source", "status"]
EVENTS = ("funnel_contact_open", "lead_handoff_opened")
BASE = "http://127.0.0.1:19120"


def add(a):
    for v, allowed, n in ((a.channel, CHANNELS, "channel"), (a.source, SOURCES, "source"), (a.status, STATUSES, "status")):
        if v not in allowed:
            sys.exit("%s must be one of %s" % (n, ", ".join(allowed)))
    day = a.date or dt.date.today().isoformat()
    dt.date.fromisoformat(day)
    new = not os.path.exists(LEDGER)
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    with open(LEDGER, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(FIELDS)
        w.writerow([day, a.channel, a.source, a.status])
    os.chmod(LEDGER, 0o600)
    print("recorded:", day, a.channel, a.source, a.status)


def api(path, token, params):
    req = urllib.request.Request(BASE + path + "?" + urllib.parse.urlencode(params), headers={"Authorization": "Bearer " + token})
    return json.load(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=20))


def login():
    pw = open(os.path.join(ROOT, "config", "umami-admin.secret")).read().strip()
    body = json.dumps({"username": "admin", "password": pw}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=body, headers={"Content-Type": "application/json"})
    return json.load(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=20))["token"]


def clicks(days):
    site = open(os.path.join(ROOT, "config", "website-id.txt")).read().strip()
    token = login()
    end = int(dt.datetime.now().timestamp() * 1000)
    base = {"startAt": end - days * 86400000, "endAt": end}
    out = {}
    for ev in EVENTS:
        split = {}
        try:
            vals = api("/api/websites/%s/event-data/values" % site, token, dict(base, event=ev, propertyName="channel"))
            for row in vals:
                split[row.get("value") or row.get("x")] = row.get("total") or row.get("y") or 0
        except Exception as e:  # keep the report usable even if the split endpoint changes
            split = {"?": "split unavailable: %s" % e.__class__.__name__}
        total = 0
        for m in api("/api/websites/%s/metrics" % site, token, dict(base, type="event")):
            if m["x"] == ev:
                total = m["y"]
        out[ev] = (total, split)
    return out


def report(a):
    since = dt.date.today() - dt.timedelta(days=a.days)
    got = {}
    if os.path.exists(LEDGER):
        for r in csv.DictReader(open(LEDGER, encoding="utf-8")):
            if dt.date.fromisoformat(r["date"]) >= since and r["status"] in ("received", "qualified"):
                got[r["channel"]] = got.get(r["channel"], 0) + 1
    print("Период: последние %d дн. (с %s)" % (a.days, since))
    print("\nA. ПЕРЕХОДЫ (измерено в Umami, только посетители с согласием; это клики, не заявки)")
    try:
        for ev, (total, split) in clicks(a.days).items():
            print("  %-22s всего %s  по каналам: %s" % (ev, total, split))
    except Exception as e:
        print("  Umami недоступен: %s" % e.__class__.__name__)
    print("\nB. ФАКТИЧЕСКИ ПОЛУЧЕННЫЕ ОБРАЩЕНИЯ (ручной журнал %s)" % LEDGER)
    if not got:
        print("  нет записей")
    for ch in CHANNELS:
        if ch in got:
            print("  %-10s %d" % (ch, got[ch]))
    print("  итого      %d" % sum(got.values()))
    print("\nВнимание: A и B несопоставимы напрямую: часть посетителей не даёт согласие, а обращение может прийти без клика на сайте.")


p = argparse.ArgumentParser()
s = p.add_subparsers(dest="cmd", required=True)
x = s.add_parser("add"); x.add_argument("--channel", required=True); x.add_argument("--source", default="unknown"); x.add_argument("--status", default="received"); x.add_argument("--date"); x.set_defaults(f=add)
y = s.add_parser("report"); y.add_argument("--days", type=int, default=30); y.set_defaults(f=report)
a = p.parse_args(); a.f(a)
