"""TEST_ONLY real-Chromium test of the unified analytics banner and the Yandex.Metrika loader (counter 113657048).

Run like tests/browser_e2e.py (Playwright python image, repo mounted read-only, no real network):
the browser opens https://torgatlas.ru mapped to a local TLS server that serves this repository and the real lead_intake handler
with a disposable SQLite DB. mc.yandex.ru is SIMULATED by a recorder stub (TEST_ONLY): this proves WHEN the tag is requested and
WHAT would be sent, not that Yandex received it. Every other external host is blocked and must not be contacted.
"""
import json
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_e2e as e2e  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

check = e2e.check
PAGE = "https://torgatlas.ru/proverka-lota/?lot=https%3A%2F%2Fsecret.example%2Flot%2F1&phone=79990000000#frag"
SECRETS = ["secret.example", "79990000000", "test-metrika@example.invalid", "TEST_METRIKA_SECRET_TEXT", "frag"]
TAG_STUB = """(function(){var q=(window.ym&&window.ym.a)||[];window.__tagLoads=(window.__tagLoads||0)+1;
window.__ymCalls=q.map(function(a){return Array.prototype.slice.call(a);});
window.ym=function(){window.__ymCalls.push(Array.prototype.slice.call(arguments));};})();"""
GPC = "Object.defineProperty(navigator,'globalPrivacyControl',{value:true});"


class Ctx:
    def __init__(self, browser, **kw):
        self.mc = []          # every request to mc.yandex.*
        self.tag = []         # tag.js requests
        self.foreign = []     # any other external host
        self.posts = []
        self.attempts = []
        self.mode = None      # None | 'tamper' | 'drop_first'
        self.context = browser.new_context(ignore_https_errors=True, locale="ru-RU", **kw)
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda e: print("  [pageerror]", str(e)[:300], flush=True))

    def route(self, r):
        url = r.request.url
        host = re.match(r"https?://([^/:]+)", url).group(1)
        if host.endswith("yandex.ru") or host.endswith("yandex.com"):
            self.mc.append(url)
            if url.startswith("https://mc.yandex.ru/metrika/tag.js"):
                self.tag.append(url)
                return r.fulfill(status=200, content_type="application/javascript", body=TAG_STUB)
            return r.fulfill(status=200, body="")
        if host != "torgatlas.ru":
            self.foreign.append(url)
            return r.abort()
        if r.request.method == "POST" and url.endswith("/api/lead"):
            body = json.loads(r.request.post_data)
            self.attempts.append(body)
            self.posts.append(r.request.post_data)
            if self.mode == "tamper":
                raw = body["altcha"]
                body["altcha"] = raw[:-6] + ("AAAAAA" if not raw.endswith("AAAAAA") else "BBBBBB")
                return r.continue_(post_data=json.dumps(body))
            if self.mode == "drop_first":
                self.mode = None
                return r.abort("failed")
        r.continue_()

    def goto(self, url=PAGE):
        self.page.goto(url, wait_until="domcontentloaded")
        self.page.wait_for_timeout(500)

    def calls(self):
        return self.page.evaluate("window.__ymCalls || []")

    def goals(self):
        return [c[2] for c in self.calls() if len(c) >= 3 and c[1] == "reachGoal"]

    def stored(self):
        return self.page.evaluate("[localStorage.getItem('ta_analytics_consent'), localStorage.getItem('ta_metrika_consent')]")

    def close(self):
        self.context.close()


def banner_visible(page):
    return page.locator("[role=dialog][aria-label='Настройки аналитики']").is_visible()


def choose(page, umami, metrika):
    box = page.locator("[role=dialog][aria-label='Настройки аналитики']")
    box.locator("[data-consent-umami]").set_checked(umami)
    box.locator("[data-consent-metrika]").set_checked(metrika)
    box.locator("[data-analytics-save]").click()


def serialized(c):
    return json.dumps(c.calls(), ensure_ascii=False) + " ".join(c.mc)


def main():
    tmp = tempfile.mkdtemp()
    off, _ = e2e.start(tmp, False)
    on, on_db = e2e.start(tmp, True)
    with sync_playwright() as p:
        def launch(port):
            return p.chromium.launch(args=["--host-resolver-rules=MAP torgatlas.ru 127.0.0.1:%d" % port, "--ignore-certificate-errors"])
        browser = launch(on.server_address[1])

        # A. first visit: Metrika preselected visually, but zero requests before an explicit positive action
        c = Ctx(browser)
        c.goto()
        check("A: banner shown on first visit", banner_visible(c.page))
        box = c.page.locator("[role=dialog][aria-label='Настройки аналитики']")
        check("A: Metrika preselected, Umami off; no stored consent yet", not box.locator("[data-consent-umami]").is_checked() and box.locator("[data-consent-metrika]").is_checked())
        check("A: banner offers accept-all, save and refuse-all", box.locator("[data-analytics-all]").count() == 1 and box.locator("[data-analytics-save]").count() == 1 and box.locator("[data-analytics-none]").count() == 1)
        check("A: zero requests to Yandex before consent", c.mc == [])
        check("A: no storage or _ym cookies before consent", c.stored() == [None, None] and "_ym" not in c.page.evaluate("document.cookie"))
        check("A: no inline Yandex code / noscript pixel in DOM", "mc.yandex" not in c.page.content())

        # B. refuse all -> still nothing; choice persists; settings link reopens banner
        box.locator("[data-analytics-none]").click()
        c.page.wait_for_timeout(300)
        check("B: refuse-all stores declined/declined", c.stored() == ["declined", "declined"])
        c.goto()
        check("B: no banner after decision, zero Yandex requests after reload", not banner_visible(c.page) and c.mc == [])
        c.page.locator("[data-analytics-settings]").first.click()
        check("B: footer 'Настройки аналитики' reopens the banner", banner_visible(c.page))
        c.close()

        # C. independent choice: Umami only
        c = Ctx(browser)
        c.goto()
        choose(c.page, True, False)
        c.page.wait_for_timeout(500)
        check("C: Umami-only choice stored independently", c.stored() == ["accepted", "declined"])
        check("C: Metrika not requested when only Umami accepted", c.mc == [] and c.page.evaluate("window.ym") is None)
        c.close()

        # D. Metrika accepted: tag requested once, sanitised init, no webvisor, survives navigation
        c = Ctx(browser)
        c.goto()
        c.page.evaluate("document.cookie='_ym_uid=123; path=/'; localStorage.setItem('_ym_uid','1'); localStorage.setItem('_ym113657048_lsid','1'); localStorage.setItem('zz','1'); localStorage.setItem('keep_me','1')")
        choose(c.page, False, True)
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        init = c.calls()[0]
        check("D: tag.js requested exactly once for counter 113657048", len(c.tag) == 1 and c.tag[0].endswith("tag.js?id=113657048"))
        check("D: init for 113657048 with page URL without query/hash", init[0] == 113657048 and init[1] == "init" and init[2]["url"] == "https://torgatlas.ru/proverka-lota/")
        check("D: address bar sanitised (no query, no non-anchor fragment) once the counter starts", c.page.evaluate("location.search === '' && location.hash === ''"))
        check("D: no webvisor / ecommerce / trackLinks", "webvisor" not in init[2] and "ecommerce" not in init[2] and init[2].get("trackLinks") is False)
        c.page.locator("a[href='/poisk-imushchestva/']").first.click()
        c.page.wait_for_function("location.pathname === '/poisk-imushchestva/'", timeout=10000)
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        check("D: consent persists across pages: one tag per page, URL sanitised", len(c.tag) == 2 and c.calls()[0][2]["url"] == "https://torgatlas.ru/poisk-imushchestva/")
        check("D: banner not shown again", not banner_visible(c.page))

        # F. withdrawal: cookie removed, tag not loaded after reload
        before = len(c.tag)
        c.page.locator("[data-analytics-settings]").first.click()
        choose(c.page, False, False)
        c.page.wait_for_load_state("domcontentloaded")
        c.page.wait_for_timeout(800)
        check("F: withdrawal stores declined and removes _ym cookies", c.stored() == ["declined", "declined"] and "_ym" not in c.page.evaluate("document.cookie"))
        check("F: Metrika local identifiers removed, unrelated key kept", c.page.evaluate("[localStorage.getItem('_ym_uid'), localStorage.getItem('_ym113657048_lsid'), localStorage.getItem('zz'), localStorage.getItem('keep_me')]") == [None, None, None, "1"])
        rec = json.loads(c.page.evaluate("localStorage.getItem('ta_analytics_consent_record')"))
        check("F: local consent record has banner version and time only", set(rec) == {"banner", "at", "umami", "metrika"} and rec["metrika"] is False)
        check("F: no tag load after withdrawal reload", len(c.tag) == before and c.page.evaluate("window.ym") is None)
        c.close()

        # E. goals through the real lead flow + contact click + simulated AI/source events
        c = Ctx(browser)
        c.goto()
        choose(c.page, False, True)
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        text = "TEST_METRIKA_SECRET_TEXT синтетическая заявка из автоматического браузерного теста, без реальных данных."
        e2e.prepare_draft(c.page, text)
        c.page.wait_for_selector(".direct-lead form", timeout=10000)
        check("E: no goal merely from rendering the form", c.goals() == [])
        c.page.fill(".direct-lead input[name=contact]", "test-metrika@example.invalid")
        check("E: lead_form_start sent once on first focus/typing", c.goals() == ["lead_form_start"])
        c.page.locator(".direct-lead input[name=contact]").click()
        c.page.locator(".direct-lead input[name=consent]").check()
        check("E: lead_form_start not repeated", c.goals() == ["lead_form_start"])
        c.page.wait_for_selector("altcha-widget", timeout=10000)
        submit = c.page.locator(".direct-lead button[type=submit]")
        c.page.locator("altcha-widget input[type=checkbox]").click()
        c.page.wait_for_function("document.querySelector('altcha-widget').getState()==='verified'", timeout=60000)
        c.mode = "tamper"
        submit.click()
        c.page.wait_for_function("document.querySelector('.direct-lead-status').textContent.includes('Проверка от спама')", timeout=10000)
        check("E: ALTCHA failure is not a successful lead", "lead_submit_success" not in c.goals())
        c.mode = "drop_first"
        c.page.locator("altcha-widget input[type=checkbox]").click()
        c.page.wait_for_function("document.querySelector('altcha-widget').getState()==='verified'", timeout=60000)
        submit.click()
        c.page.wait_for_function("document.querySelector('.direct-lead-status').textContent.includes('не подтверждён')", timeout=10000)
        check("E: network failure is not a successful lead", "lead_submit_success" not in c.goals())
        submit.click()
        c.page.wait_for_selector(".direct-lead-done", timeout=15000)
        c.page.wait_for_timeout(300)
        check("E: lead_submit_success sent exactly once, only after server confirmation", c.goals().count("lead_submit_success") == 1)
        db = sqlite3.connect(on_db)
        check("E: one saved lead row matches one success goal", db.execute("SELECT COUNT(*) FROM leads").fetchone()[0] == 1)
        db.close()
        c.page.evaluate("document.addEventListener('click', e => e.preventDefault())")
        c.page.locator("a[href^='mailto:']").first.evaluate("el => el.click()")
        check("E: contact_click sent exactly once for one click on a contact link", c.goals().count("contact_click") == 1)
        c.page.evaluate("""() => { const a = document.createElement('a'); a.href = '#x'; a.dataset.track = 'ai_source_click'; a.textContent = 'x'; document.body.appendChild(a); a.click(); }""")
        c.page.evaluate("() => { window.auctionCROTrack('ai_search_start'); window.auctionCROTrack('ai_search_results'); }")
        check("E: source click and AI events map to their goals (simulated UI events)", {"lot_source_click", "ai_search_submit", "ai_search_results"} <= set(c.goals()))
        check("E: every reachGoal call has exactly 3 args and an allowed identifier",
              all(len(x) == 3 for x in c.calls() if x[1] == "reachGoal")
              and set(c.goals()) <= {"ai_search_submit", "ai_search_results", "lot_source_click", "lead_form_start", "lead_submit_success", "contact_click"})
        blob = serialized(c)
        check("E: no contact, lot URL, phone, form text or fragment in anything sent to Yandex", not any(s in blob for s in SECRETS))
        check("E: no non-torgatlas/non-simulated external host contacted", c.foreign == [])
        c.close()

        # G. mobile viewport
        c = Ctx(browser, viewport={"width": 390, "height": 844}, is_mobile=True)
        c.goto()
        b = c.page.locator("[role=dialog][aria-label='Настройки аналитики']").bounding_box()
        check("G: mobile banner fully inside the viewport", b is not None and b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["width"] <= 390 and b["y"] + b["height"] <= 844)
        check("G: no horizontal page scroll on mobile", c.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        c.page.locator("[data-analytics-all]").click()
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        check("G: accept-all works on mobile", len(c.tag) == 1)
        c.close()

        # H. GPC: nothing, even with a stored acceptance
        c = Ctx(browser)
        c.context.add_init_script(GPC + "try{localStorage.setItem('ta_metrika_consent','accepted');localStorage.setItem('ta_analytics_consent','accepted')}catch(e){}")
        c.goto()
        check("H: GPC -> no banner, no Yandex requests", not banner_visible(c.page) and c.mc == [])
        c.close()

        # I. AI search page now carries the banner and the loader, SEO tags intact
        c = Ctx(browser)
        c.goto("https://torgatlas.ru/ai-poisk-lotov/")
        check("I: AI search page shows the banner", banner_visible(c.page))
        check("I: AI search form and canonical intact", c.page.locator("#ai-lot-form").count() == 1 and "https://torgatlas.ru/ai-poisk-lotov/" in c.page.content())
        c.close()
        browser.close()

        # J. lead disabled server: no regression without direct leads
        browser = launch(off.server_address[1])
        c = Ctx(browser)
        c.goto()
        e2e.prepare_draft(c.page)
        c.page.wait_for_timeout(600)
        check("J: direct form still hidden when leads are disabled; no Yandex traffic without consent", c.page.locator(".direct-lead").count() == 0 and c.mc == [])
        c.close()
        browser.close()

    print("FAILED: %s" % e2e.check.failed if e2e.check.failed else "ALL PASS")
    return 1 if e2e.check.failed else 0


if __name__ == "__main__":
    sys.exit(main())
