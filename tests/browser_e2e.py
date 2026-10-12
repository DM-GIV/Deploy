"""TEST_ONLY real-Chromium test of the direct-lead flow against a disposable local backend.

Run (see docs/P3_ALTCHA_SQLITE_RUNBOOK.md): inside the Playwright python image with the repo mounted read-only.
The browser opens https://torgatlas.ru, but a host-resolver rule maps that name to a local TLS server that serves
this repository's static files and the real lead_intake Handler with a disposable SQLite DB. Every request to any
other host is blocked and must not happen. This does NOT replace the production E2E.
"""
import json
import os
import re
import shutil
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "services" / "lead-intake"))
import lead_intake as lead  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css",
         ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon",
         ".txt": "text/plain", ".xml": "application/xml", ".json": "application/json"}


class Site(lead.Handler):
    def serve(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/") or path == "/health":
            return lead.Handler.serve(self)
        target = (ROOT / path.lstrip("/")).resolve()
        if target.is_dir():
            target = target / "index.html"
        if not str(target).startswith(str(ROOT)) or not target.is_file() or "services" in target.parts:
            self.send_response(404)
            self.end_headers()
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = serve
    do_POST = serve
    do_HEAD = serve


def start(tmp, enabled):
    data = Path(tmp) / ("data-on" if enabled else "data-off")
    data.mkdir(mode=0o700)
    env = {"DIRECT_LEADS_ENABLED": "true" if enabled else "false", "DIRECT_LEADS_LEGAL_APPROVED": "true",
           "LEAD_ALLOWED_ORIGIN": "https://torgatlas.ru", "LEAD_CONSENT_VERSION": "2026-10-12.2",
           "LEAD_HASH_SALT": "browser-test-salt-Qw3rTy9uIoPaSdFgHjKl0", "ALTCHA_HMAC_KEY": "browser-test-key-Zx7cVb1nMqWeRtYuIoPa0",
           "DATA_DB_PATH": str(data / "leads.sqlite3")}
    server = ThreadingHTTPServer(("127.0.0.1", 0), Site)
    server.app = lead.App(env)
    cert = Path(tmp) / "cert.pem"
    key = Path(tmp) / "key.pem"
    if not cert.exists():
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=torgatlas.ru",
                        "-addext", "subjectAltName=DNS:torgatlas.ru", "-keyout", str(key), "-out", str(cert), "-days", "1"],
                       check=True, capture_output=True)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(cert), str(key))
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, env["DATA_DB_PATH"]


def check(label, condition):
    print(("PASS " if condition else "FAIL ") + label, flush=True)
    if not condition:
        check.failed.append(label)


check.failed = []


def open_page(browser, port, external, posts=None):
    context = browser.new_context(ignore_https_errors=True, locale="ru-RU")
    page = context.new_page()
    requested = []
    page.on("console", lambda m: print("  [console]", m.type, m.text[:200], flush=True) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: print("  [pageerror]", str(e)[:300], flush=True))
    page.on("response", lambda r: print("  [http]", r.status, r.url[:120], flush=True) if r.status >= 400 else None)

    def route(r):
        host = re.match(r"https?://([^/:]+)", r.request.url).group(1)
        requested.append(r.request.url)
        if host != "torgatlas.ru":
            external.append(r.request.url)
            return r.abort()
        if posts is not None and r.request.method == "POST":
            posts.append(r.request.post_data)
        r.continue_()
    context.route("**/*", route)
    page.goto("https://torgatlas.ru/proverka-lota/", wait_until="domcontentloaded")
    return context, page, requested


def prepare_draft(page, text=None):
    page.fill("#lot-url", "https://example.invalid/lot/TEST")
    page.select_option("#asset-type", "Автомобиль")
    page.click("#generate-lot-map")
    page.click("#send-telegram")
    if text:
        page.fill("#lot-handoff-text", text)


def main():
    tmp = tempfile.mkdtemp()
    external = []
    try:
        off, off_db = start(tmp, False)
        on, on_db = start(tmp, True)
        with sync_playwright() as p:
            def launch(port):
                return p.chromium.launch(args=["--host-resolver-rules=MAP torgatlas.ru 127.0.0.1:%d" % port,
                                               "--ignore-certificate-errors"])
            # 1. disabled: no form, no widget, manual channels remain
            browser = launch(off.server_address[1])
            context, page, requested = open_page(browser, off.server_address[1], external)
            prepare_draft(page)
            page.wait_for_timeout(700)
            check("disabled: no direct form", page.locator(".direct-lead").count() == 0)
            check("disabled: widget never requested", not any("altcha" in u for u in requested))
            check("disabled: manual email/telegram buttons present", page.locator("#lot-handoff-email").count() == 1 and page.locator("#lot-handoff-telegram").count() == 1)
            check("disabled: no database file created", not Path(off_db).exists())
            browser.close()

            # 2. enabled flow
            browser = launch(on.server_address[1])
            posts = []
            context, page, requested = open_page(browser, on.server_address[1], external, posts)
            prepare_draft(page, "TEST_E2E_AUC204 синтетическая заявка из автоматического браузерного теста, без реальных данных.")
            page.wait_for_selector(".direct-lead form", timeout=10000)
            page.fill(".direct-lead input[name=contact]", "test-e2e@example.invalid")
            submit = page.locator(".direct-lead button[type=submit]")
            check("form shown, submit disabled initially", submit.is_disabled())
            page.wait_for_selector("altcha-widget", timeout=10000)
            page.locator(".direct-lead input[name=consent]").check()
            check("submit still disabled without CAPTCHA", submit.is_disabled())
            check("widget loaded from torgatlas.ru only", any("/assets/vendor/altcha/altcha.js" in u for u in requested))
            # solve CAPTCHA via the real widget (click its checkbox)
            page.locator("altcha-widget input[type=checkbox]").click()
            page.wait_for_function("document.querySelector('altcha-widget') && document.querySelector('altcha-widget').getState && document.querySelector('altcha-widget').getState()==='verified'", timeout=60000)
            check("real widget solved a server challenge", True)
            check("submit enabled after CAPTCHA+consent", submit.is_enabled())
            # corrupt the CAPTCHA for one attempt: rejected, nothing stored
            context.unroute("**/*")

            def tamper(r):
                host = re.match(r"https?://([^/:]+)", r.request.url).group(1)
                if host != "torgatlas.ru":
                    external.append(r.request.url)
                    return r.abort()
                if r.request.method == "POST" and r.request.url.endswith("/api/lead"):
                    body = json.loads(r.request.post_data)
                    posts.append(r.request.post_data)
                    raw = body["altcha"]
                    body["altcha"] = raw[:-6] + ("AAAAAA" if not raw.endswith("AAAAAA") else "BBBBBB")
                    return r.continue_(post_data=json.dumps(body))
                r.continue_()
            context.route("**/*", tamper)
            submit.click()
            page.wait_for_function("document.querySelector('.direct-lead-status').textContent.length>10", timeout=10000)
            check("corrupted CAPTCHA rejected with message", "Проверка от спама" in page.locator(".direct-lead-status").inner_text())
            check("corrupted CAPTCHA: no success UI", page.locator(".direct-lead-done").count() == 0)
            check("corrupted CAPTCHA: nothing stored", not Path(on_db).exists() or sqlite3.connect(on_db).execute("SELECT COUNT(*) FROM leads").fetchone()[0] == 0)
            context.unroute("**/*")

            # network failure after the click: UI says unconfirmed; retry reuses the same UUID
            attempts = []

            def drop_first(r):
                host = re.match(r"https?://([^/:]+)", r.request.url).group(1)
                if host != "torgatlas.ru":
                    external.append(r.request.url)
                    return r.abort()
                if r.request.method == "POST" and r.request.url.endswith("/api/lead"):
                    attempts.append(json.loads(r.request.post_data))
                    if len(attempts) == 1:
                        return r.abort("failed")
                r.continue_()
            context.route("**/*", drop_first)
            # solve again (tampered attempt reset the widget)
            page.locator("altcha-widget input[type=checkbox]").click()
            page.wait_for_function("document.querySelector('altcha-widget').getState()==='verified'", timeout=60000)
            submit.click()
            page.wait_for_function("document.querySelector('.direct-lead-status').textContent.includes('не подтверждён')", timeout=10000)
            check("lost response: unconfirmed message, no fake success", page.locator(".direct-lead-done").count() == 0)
            submit.click()
            page.wait_for_selector(".direct-lead-done", timeout=15000)
            receipt = page.locator(".direct-lead-receipt").inner_text()
            check("retry reused same UUID", len(attempts) == 2 and attempts[0]["id"] == attempts[1]["id"] == receipt)
            check("success UI shows receipt", re.fullmatch(r"[0-9a-f-]{36}", receipt) is not None)
            db = sqlite3.connect(on_db)
            rows = db.execute("SELECT id,status,contact,notification_status FROM leads").fetchall()
            check("exactly one physical SQLite row with that receipt", rows == [(receipt, "accepted", "test-e2e@example.invalid", "not_configured")])
            check("one CAPTCHA challenge consumed", db.execute("SELECT COUNT(*) FROM altcha_used").fetchone()[0] == 1)
            db.close()
            # same UUID/payload again through the API from the page: same receipt, no new row
            again = page.evaluate("""async (body) => { const r = await fetch('/api/lead', {method:'POST', headers:{'Content-Type':'application/json'}, body}); return [r.status, await r.json()]; }""",
                                  json.dumps(attempts[1]))
            check("same UUID same payload returns same receipt", again[0] == 200 and again[1]["receipt"] == receipt)
            changed = dict(attempts[1], message=attempts[1]["message"] + " изменено")
            res = page.evaluate("""async (body) => { const r = await fetch('/api/lead', {method:'POST', headers:{'Content-Type':'application/json'}, body}); return r.status; }""", json.dumps(changed))
            check("same UUID different payload -> 409", res == 409)
            other = dict(attempts[1], id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
            res = page.evaluate("""async (body) => { const r = await fetch('/api/lead', {method:'POST', headers:{'Content-Type':'application/json'}, body}); return [r.status, (await r.json()).code]; }""", json.dumps(other))
            check("CAPTCHA reuse for another UUID rejected", res == [403, "CAPTCHA_REPLAY"])
            db = sqlite3.connect(on_db)
            check("still exactly one row", db.execute("SELECT COUNT(*) FROM leads").fetchone()[0] == 1)
            db.close()
            check("no external requests at all", external == [])
            check("no contact/message in any URL", not any("example.invalid" in u or "TEST_E2E" in u for u in requested))
            browser.close()
        check("zero external hosts contacted (overall)", external == [])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if check.failed:
        print("FAILED:", check.failed)
        sys.exit(1)
    print("ALL BROWSER CHECKS PASSED")


if __name__ == "__main__":
    main()
