"""TorgAtlas admin HTTP service (stdlib). Listens inside its container; published only on 127.0.0.1 and reached via Nginx/HTTPS.

Every route except /login (+ POST), /healthz and /static/* requires a valid session. APIs answer 401 JSON, pages redirect to /login.
All state-changing requests need POST + CSRF token + same-origin. No JavaScript is used (CSP script-src 'none').
Add a module by calling register_module(); only registered modules appear in the navigation.
"""
import hmac
import html
import http.server
import json
import os
import urllib.parse
from pathlib import Path

from admin_core import (UUID_RE, AdminDB, Leads, KIND_LABELS, STATUSES, STATUS_LABELS, lot_links, msk, trusted_peer)
from outbox import Outbox

MAX_BODY = 8192
COOKIE = "__Host-ta_admin"
STATIC = Path(__file__).with_name("static")
NOTIFY_LABELS = {"sent": ("Отправлено", "ok"), "pending": ("Ожидает", "wait"), "sending": ("Ожидает", "wait"),
                 "error": ("Ошибка", "bad"), "skipped": ("Не отправлялось", "mute"), "none": ("Не в очереди", "mute")}
MODULES = []  # (key, title, path)


def register_module(key, title, path):
    MODULES.append((key, title, path))


register_module("leads", "Заявки", "/")
register_module("audit", "Журнал входов", "/audit")

E = html.escape


def page(title, body, nav_active="", user=None, csrf="", counters=None):
    nav = ""
    if user:
        items = []
        for key, label, path in MODULES:
            badge = ""
            if key == "leads" and counters and counters.get("unread"):
                badge = '<b class="badge" aria-label="новых заявок">%d</b>' % counters["unread"]
            items.append('<a href="%s"%s>%s%s</a>' % (path, ' aria-current="page"' if key == nav_active else "", E(label), badge))
        nav = ('<header class="top"><a class="brand" href="/">ТоргАтлас <span>админ</span></a><nav>%s</nav>'
               '<form method="post" action="/logout"><input type="hidden" name="csrf" value="%s"><button class="link">Выйти</button></form></header>'
               % ("".join(items), E(csrf)))
    return ('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="same-origin">'
            '<title>%s — ТоргАтлас админ</title><link rel="stylesheet" href="/static/admin.css?v=1"></head><body>%s<main>%s</main></body></html>'
            % (E(title), nav, body))


def login_page(error=""):
    err = '<p class="err" role="alert">%s</p>' % E(error) if error else ""
    return page("Вход", '<section class="card narrow"><h1>Вход</h1>%s<form method="post" action="/login" autocomplete="off">'
                '<label>Логин<input name="username" required maxlength="64" autocomplete="username" autocapitalize="none"></label>'
                '<label>Пароль<input name="password" type="password" required maxlength="256" autocomplete="current-password"></label>'
                '<label>Код из приложения (6 цифр)<input name="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label>'
                '<button class="btn">Войти</button></form></section>' % err)


def badge_status(st):
    return '<span class="pill s-%s">%s</span>' % (st, E(STATUS_LABELS[st]))


def badge_notify(st):
    label, cls = NOTIFY_LABELS.get(st, NOTIFY_LABELS["none"])
    return '<span class="pill n-%s">%s</span>' % (cls, E(label))


class App:
    def __init__(self, env=None):
        self.env = dict(os.environ if env is None else env)
        self.admin = AdminDB(self.env.get("ADMIN_DB_PATH", "/data/admin.sqlite3"))
        self.leads = Leads(self.env.get("LEADS_DB_PATH", "/leads/leads.sqlite3"), self.admin)
        self.outbox = Outbox(self.admin, self.leads, self.env)
        self.origin = self.env.get("ADMIN_BASE_URL", "").rstrip("/")
        self.require_https = self.env.get("ADMIN_REQUIRE_HTTPS", "1") == "1"
        self.proxies = self.env.get("ADMIN_TRUSTED_PROXIES", "127.0.0.1,::1,172.16.0.0/12")

    # ---- request processing: returns (status, headers dict, bytes)
    def handle(self, method, raw_path, headers, body, peer):
        url = urllib.parse.urlsplit(raw_path)
        path, query = url.path, urllib.parse.parse_qs(url.query[:1000], max_num_fields=20)
        ip = headers.get("x-real-ip", peer) if trusted_peer(peer, self.proxies) else peer
        if path == "/healthz":
            return self.text(200, "ok")
        if self.require_https and headers.get("x-forwarded-proto", "") != "https":
            return self.text(421, "HTTPS required")
        if path.startswith("/static/") and method in ("GET", "HEAD"):
            return self.static(path[8:])
        cookies = self.parse_cookies(headers.get("cookie", ""))
        session = self.admin.get_session(cookies.get(COOKIE))
        api = path.startswith("/api/")
        if method == "POST" and not self.same_origin(headers):
            self.admin.audit(session and session["username"], ip, "csrf_origin_rejected", "%s %s" % (path, self.origin_reason(headers)), ok=False)
            return self.text(403, "forbidden")
        form = self.parse_form(headers, body) if method == "POST" else {}

        if path == "/login":
            if method == "GET":
                return self.html(200, login_page())
            if method == "POST":
                token, reason = self.admin.login(form.get("username", ""), form.get("password", ""), form.get("code", ""), ip)
                if token:
                    return 303, {"Location": "/", "Set-Cookie": self.cookie(token, 8 * 3600)}, b""
                msg = "Слишком много попыток. Подождите 15 минут." if reason == "locked" else "Неверный логин, пароль или код."
                return self.html(429 if reason == "locked" else 401, login_page(msg))
            return self.text(405, "method not allowed")

        if not session:
            if api:
                return self.json(401, {"ok": False, "code": "UNAUTHENTICATED"})
            return 303, {"Location": "/login"}, b""
        user, csrf = session["username"], session["csrf"]

        if method == "POST":
            supplied = form.get("csrf") or headers.get("x-csrf-token", "")
            if not hmac.compare_digest(supplied.encode(), csrf.encode()):
                self.admin.audit(user, ip, "csrf_rejected", path, ok=False)
                return self.json(403, {"ok": False, "code": "CSRF"}) if api else self.text(403, "forbidden")
            if path == "/logout":
                self.admin.audit(user, ip, "logout")
                self.admin.destroy_session(cookies.get(COOKIE))
                return 303, {"Location": "/login", "Set-Cookie": self.cookie("", 0)}, b""

        counters = self.leads.stats()
        parts = [p for p in path.split("/") if p]

        # ---------------- API
        if api:
            if path == "/api/stats" and method == "GET":
                return self.json(200, {"ok": True, **counters, "outbox": self.outbox.summary()})
            if path == "/api/leads" and method == "GET":
                res = self.leads.list(query.get("q", [""])[0], query.get("status", [""])[0], query.get("kind", [""])[0],
                                      self.intval(query.get("page", ["1"])[0]))
                for it in res["items"]:
                    it["summary"] = it["summary"][:140]
                return self.json(200, {"ok": True, **res})
            if len(parts) == 3 and parts[:2] == ["api", "leads"] and method == "GET":
                lead = self.leads.get(parts[2])
                if not lead:
                    return self.json(404, {"ok": False, "code": "NOT_FOUND"})
                self.admin.audit(user, ip, "view_lead_api", parts[2])
                return self.json(200, {"ok": True, "lead": lead})
            if len(parts) == 4 and parts[:2] == ["api", "leads"] and method == "POST":
                return self.mutate(parts[2], parts[3], form, user, ip, api=True)
            return self.json(404, {"ok": False, "code": "NOT_FOUND"})

        # ---------------- pages
        if path == "/" and method == "GET":
            return self.html(200, self.leads_page(query, user, csrf, counters))
        if path == "/audit" and method == "GET":
            return self.html(200, self.audit_page(user, csrf, counters))
        if len(parts) == 2 and parts[0] == "leads" and method == "GET":
            lead = self.leads.get(parts[1])
            if not lead:
                return self.html(404, page("Не найдено", '<section class="card"><h1>Заявка не найдена</h1><p><a href="/">К списку</a></p></section>',
                                           "leads", user, csrf, counters))
            self.admin.audit(user, ip, "view_lead", parts[1])
            return self.html(200, self.lead_page(lead, user, csrf, counters, query.get("m", [""])[0]))
        if len(parts) == 3 and parts[0] == "leads" and method == "POST":
            return self.mutate(parts[1], parts[2], form, user, ip, api=False)
        return self.html(404, page("Не найдено", '<section class="card"><h1>Страница не найдена</h1></section>', "", user, csrf, counters))

    def mutate(self, lead_id, action, form, user, ip, api):
        ok = False
        if not UUID_RE.match(lead_id):
            return self.json(404, {"ok": False, "code": "NOT_FOUND"}) if api else self.text(404, "not found")
        if action == "status":
            ok, _ = self.leads.set_status(lead_id, form.get("status", ""), user)
        elif action == "read":
            ok = self.leads.mark_read(lead_id, user)
        elif action == "note":
            ok = self.leads.add_note(lead_id, form.get("note", ""), user)
        else:
            return self.json(404, {"ok": False, "code": "NOT_FOUND"}) if api else self.text(404, "not found")
        self.admin.audit(user, ip, "lead_" + action, lead_id, ok=ok)
        if api:
            return self.json(200 if ok else 400, {"ok": ok})
        return 303, {"Location": "/leads/%s?m=%s" % (lead_id, "ok" if ok else "err")}, b""

    # ---------------- page bodies
    def leads_page(self, query, user, csrf, counters):
        q, status, kind = (query.get(k, [""])[0] for k in ("q", "status", "kind"))
        pg = self.intval(query.get("page", ["1"])[0])
        res = self.leads.list(q, status, kind, pg)
        tabs = '<a class="tab%s" href="/">Все <b>%d</b></a>' % ("" if status not in STATUSES else "", counters["total"])
        tabs += "".join('<a class="tab%s" href="/?status=%s">%s <b>%d</b></a>' % (" on" if status == s else "", s, E(STATUS_LABELS[s]), counters[s])
                        for s in STATUSES)
        kinds = "".join('<option value="%s"%s>%s</option>' % (k, " selected" if kind == k else "", E(v)) for k, v in KIND_LABELS.items())
        rows = ""
        for it in res["items"]:
            summ = it["summary"][:140] + ("…" if len(it["summary"]) > 140 else "")
            rows += ('<tr class="%s"><td data-l="№"><a href="/leads/%s">№%s</a>%s</td><td data-l="Дата">%s</td><td data-l="Вид">%s</td>'
                     '<td data-l="Описание" class="sum">%s</td><td data-l="Статус">%s</td><td data-l="Уведомление">%s</td></tr>'
                     % ("unread" if it["unread"] else "", E(it["id"]), E(str(it["num"])), ' <i class="dot" title="Не прочитана"></i>' if it["unread"] else "",
                        E(msk(it["created_at"])), E(KIND_LABELS.get(it["kind"], it["kind"])), E(summ), badge_status(it["status"]),
                        badge_notify(it["notify"])))
        if not rows:
            rows = '<tr><td colspan="6" class="empty">Заявок по этим условиям нет.</td></tr>'
        pages = (res["total"] + res["per_page"] - 1) // res["per_page"]
        base = urllib.parse.urlencode({k: v for k, v in (("q", q), ("status", status), ("kind", kind)) if v})
        pager = ""
        if pages > 1:
            pager = '<p class="pager">'
            if res["page"] > 1:
                pager += '<a href="/?%s&page=%d">← Назад</a> ' % (E(base), res["page"] - 1)
            pager += "Стр. %d из %d" % (res["page"], pages)
            if res["page"] < pages:
                pager += ' <a href="/?%s&page=%d">Вперёд →</a>' % (E(base), res["page"] + 1)
            pager += "</p>"
        body = ('<h1>Заявки <span class="muted">новых: %d</span></h1><div class="tabs">%s</div>'
                '<form class="filters" method="get" action="/"><input name="q" value="%s" placeholder="Поиск: №, текст, контакт" maxlength="100">'
                '<select name="kind"><option value="">Все виды</option>%s</select><input type="hidden" name="status" value="%s"><button class="btn">Найти</button></form>'
                '<table class="list"><thead><tr><th>№</th><th>Дата</th><th>Вид</th><th>Описание</th><th>Статус</th><th>Уведомление</th></tr></thead><tbody>%s</tbody></table>%s'
                % (counters["new"], tabs, E(q), kinds, E(status if status in STATUSES else ""), rows, pager))
        return page("Заявки", body, "leads", user, csrf, counters)

    def lead_page(self, lead, user, csrf, counters, msg):
        links = "".join('<li><a href="%s" rel="noopener noreferrer nofollow" target="_blank">%s</a></li>' % (E(u, True), E(u)) for u in lot_links(lead["message"]))
        links = '<h2>Ссылка на лот</h2><ul>%s</ul>' % links if links else '<h2>Ссылка на лот</h2><p class="muted">В тексте обращения ссылки нет.</p>'
        fields = [("Номер", "№%s" % lead["num"]), ("Получена", msk(lead["created_at"])), ("Вид обращения", KIND_LABELS.get(lead["kind"], lead["kind"])),
                  ("Контакт", lead["contact"]), ("Версия политики", lead["privacy_version"]), ("Согласие получено", msk(lead["consent_at"])),
                  ("Приём (служебный статус)", lead["status"]), ("Просмотрена (leadctl)", msk(lead["reviewed_at"]) if lead["reviewed_at"] else "—"),
                  ("Закрыта (leadctl)", msk(lead["closed_at"]) if lead["closed_at"] else "—"),
                  ("Юридическое удержание", "да: " + (lead["hold_reason"] or "") if lead["legal_hold"] else "нет")]
        dl = "".join("<dt>%s</dt><dd>%s</dd>" % (E(k), E(str(v))) for k, v in fields)
        nt = lead["notify"]
        nstate = nt["state"] if nt else "none"
        nline = badge_notify(nstate) + (' <span class="muted">попыток: %d%s</span>' % (nt["attempts"], ", " + E(nt["error_class"]) if nt and nt["error_class"] else "") if nt else "")
        nlog = "".join("<li>%s — %s%s</li>" % (E(msk(x["ts"])), E(x["outcome"]), " (%s)" % E(x["error_class"]) if x["error_class"] else "") for x in lead["notify_log"])
        statusbtns = "".join('<button name="status" value="%s" class="btn%s"%s>%s</button>' % (s, " on" if lead["state"] == s else " alt", " disabled" if lead["state"] == s else "", E(STATUS_LABELS[s]))
                             for s in STATUSES)
        readbtn = ""
        if lead["state"] == "new" and not lead["read_at"]:
            readbtn = ('<form method="post" action="/leads/%s/read"><input type="hidden" name="csrf" value="%s"><button class="btn alt">Отметить прочитанной</button></form>'
                       % (E(lead["id"]), E(csrf)))
        log = "".join('<li><b>%s</b> · %s · %s</li>' % (E(msk(x["ts"])), E(x["actor"]),
                      E({"status": "статус: %s → %s" % (STATUS_LABELS.get(x["old_state"], x["old_state"]), STATUS_LABELS.get(x["new_state"], x["new_state"])),
                         "read": "отмечена прочитанной"}.get(x["action"], "заметка: " + (x["note"] or ""))) if x["action"] != "note" else "заметка: %s" % E(x["note"] or ""))
                      for x in lead["log"]) or '<li class="muted">Записей пока нет.</li>'
        flash = {"ok": '<p class="ok" role="status">Сохранено.</p>', "err": '<p class="err" role="alert">Не удалось сохранить.</p>'}.get(msg, "")
        body = ('<p><a href="/">← Все заявки</a></p><h1>Заявка №%s %s</h1>%s<section class="card"><h2>Обращение</h2><p class="msg">%s</p>%s</section>'
                '<section class="card"><h2>Данные</h2><dl>%s</dl></section>'
                '<section class="card"><h2>Обработка</h2><form method="post" action="/leads/%s/status" class="row"><input type="hidden" name="csrf" value="%s">%s</form>%s</section>'
                '<section class="card"><h2>Уведомление владельцу</h2><p>%s</p><ul class="log">%s</ul></section>'
                '<section class="card"><h2>Журнал обработки</h2><form method="post" action="/leads/%s/note"><input type="hidden" name="csrf" value="%s">'
                '<textarea name="note" maxlength="2000" rows="3" placeholder="Заметка (видна только в админке)"></textarea><button class="btn alt">Добавить заметку</button></form><ul class="log">%s</ul></section>'
                % (E(str(lead["num"])), badge_status(lead["state"]), flash, E(lead["message"]), links, dl, E(lead["id"]), E(csrf), statusbtns, readbtn,
                   nline, nlog or '<li class="muted">Попыток отправки не было.</li>', E(lead["id"]), E(csrf), log))
        return page("Заявка №%s" % lead["num"], body, "leads", user, csrf, counters)

    def audit_page(self, user, csrf, counters):
        rows = "".join('<tr><td data-l="Время">%s</td><td data-l="Кто">%s</td><td data-l="IP">%s</td><td data-l="Действие">%s</td><td data-l="Объект">%s</td><td data-l="Итог">%s</td></tr>'
                       % (E(msk(r["ts"])), E(r["actor"] or "—"), E(r["ip"] or "—"), E(r["action"]), E(r["target"] or ""), "ок" if r["ok"] else "отказ")
                       for r in self.admin.audit_rows())
        return page("Журнал входов", '<h1>Журнал входов и действий</h1><table class="list"><thead><tr><th>Время</th><th>Кто</th><th>IP</th><th>Действие</th><th>Объект</th><th>Итог</th></tr></thead><tbody>%s</tbody></table>' % rows,
                    "audit", user, csrf, counters)

    # ---------------- helpers
    @staticmethod
    def intval(v):
        return int(v) if str(v).isdigit() and len(str(v)) < 6 else 1

    @staticmethod
    def parse_cookies(header):
        out = {}
        for part in header.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                out.setdefault(k, v)
        return out

    @staticmethod
    def parse_form(headers, body):
        ctype = headers.get("content-type", "").split(";")[0].strip()
        if not body:
            return {}
        try:
            if ctype == "application/json":
                data = json.loads(body.decode("utf-8"))
                return {k: v for k, v in data.items() if isinstance(v, str)} if isinstance(data, dict) else {}
            if ctype == "application/x-www-form-urlencoded":
                return {k: v[0] for k, v in urllib.parse.parse_qs(body.decode("utf-8"), max_num_fields=20).items()}
        except (ValueError, UnicodeDecodeError):
            pass
        return {}

    def same_origin(self, headers):
        origin = headers.get("origin")
        if origin is not None and origin != self.origin:
            return False
        site = headers.get("sec-fetch-site")
        return site in (None, "same-origin")

    def origin_reason(self, headers):
        """Safe diagnostic for the audit log: classifies Origin / Sec-Fetch-Site, never stores raw header values."""
        origin = headers.get("origin")
        kind = "absent" if origin is None else "match" if origin == self.origin else "null" if origin == "null" else "other"
        site = headers.get("sec-fetch-site")
        site = "absent" if site is None else site if site in ("same-origin", "same-site", "cross-site", "none") else "other"
        return "origin=%s sfs=%s" % (kind, site)

    def cookie(self, token, max_age):
        return "%s=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Strict" % (COOKIE, token, max_age)

    SEC = {"Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
           "Referrer-Policy": "same-origin", "X-Robots-Tag": "noindex, nofollow, noarchive", "Cross-Origin-Opener-Policy": "same-origin",
           "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
           "Strict-Transport-Security": "max-age=31536000"}

    def html(self, code, doc):
        return code, {"Content-Type": "text/html; charset=utf-8", **self.SEC}, doc.encode()

    def text(self, code, msg):
        return code, {"Content-Type": "text/plain; charset=utf-8", **self.SEC}, msg.encode()

    def json(self, code, obj):
        return code, {"Content-Type": "application/json; charset=utf-8", **self.SEC}, json.dumps(obj, ensure_ascii=False).encode()

    def static(self, name):
        f = (STATIC / name).resolve()
        if STATIC.resolve() not in f.parents or not f.is_file() or f.suffix != ".css":
            return self.text(404, "not found")
        hdr = {**self.SEC, "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600"}
        return 200, hdr, f.read_bytes()


class Handler(http.server.BaseHTTPRequestHandler):
    timeout = 10

    def serve(self):
        headers = {k.lower(): v for k, v in self.headers.items()}
        body = b""
        if self.command == "POST":
            length = headers.get("content-length", "")
            if "transfer-encoding" in headers or not (length.isascii() and length.isdigit()) or int(length) > MAX_BODY:
                code, hdr, data = self.server.app.text(413, "bad body")
                return self.reply(code, hdr, data)
            body = self.rfile.read(int(length))
        try:
            code, hdr, data = self.server.app.handle(self.command, self.path, headers, body, self.client_address[0])
        except Exception:
            code, hdr, data = self.server.app.text(500, "error")
        self.reply(code, hdr, data)

    def reply(self, code, hdr, data):
        self.send_response(code)
        for k, v in hdr.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)
        self.close_connection = True

    do_GET = serve
    do_POST = serve
    do_HEAD = serve

    def do_OPTIONS(self):
        self.reply(405, {"Allow": "GET, POST", **App.SEC}, b"")

    def log_message(self, *_):
        return  # never log URLs, IPs, cookies or lead content


def main():
    app = App()
    app.outbox.start()
    server = http.server.ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("ADMIN_PORT", "8082"))), Handler)
    server.app = app
    print("TorgAtlas admin started; telegram_configured=%s" % app.outbox.configured(), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
