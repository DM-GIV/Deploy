"""TEST_ONLY real-Chromium test of the calm consent banner (issue #16): viewports, keyboard, consent modes, XSS, event uniqueness, anchors.

Same harness as tests/browser_metrika.py (local TLS server for torgatlas.ru, simulated mc.yandex.ru). It never submits a lead.
Run: playwright python image, repo mounted read-only (see tests/browser_e2e.py).
"""
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_e2e as e2e  # noqa: E402
import browser_metrika as bm  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

check = e2e.check
DIALOG = "[role=dialog][aria-label='Настройки аналитики']"
VIEWPORTS = [(320, 640), (375, 667), (390, 844), (768, 1024), (1440, 900)]
PAGES = ["/", "/proverka-lota/", "/ai-poisk-lotov/", "/privacy/", "/blog/"]


def dialog(page):
    return page.locator(DIALOG)


def main():
    tmp = tempfile.mkdtemp()
    on, _ = e2e.start(tmp, True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--host-resolver-rules=MAP torgatlas.ru 127.0.0.1:%d" % on.server_address[1], "--ignore-certificate-errors"])

        # 1. viewports: banner fits, readable, no horizontal scroll, 44px targets, no third-party request before consent
        for w, h in VIEWPORTS:
            c = bm.Ctx(browser, viewport={"width": w, "height": h})
            c.goto("https://torgatlas.ru/proverka-lota/")
            box = dialog(c.page)
            bb = box.bounding_box()
            tag = "%dx%d" % (w, h)
            check(tag + ": banner inside the viewport", bb is not None and bb["x"] >= 0 and bb["y"] >= 0 and bb["x"] + bb["width"] <= w + 0.5 and bb["y"] + bb["height"] <= h + 0.5)
            check(tag + ": no horizontal page scroll", c.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
            check(tag + ": banner content not clipped sideways", c.page.evaluate("(() => { const b = document.querySelector(\"[role=dialog]\"); return b.scrollWidth <= b.clientWidth + 1; })()"))
            sizes = c.page.evaluate("[...document.querySelectorAll('.ta-consent button')].map(b => b.getBoundingClientRect().height)")
            check(tag + ": three buttons, each at least 44px tall", len(sizes) == 3 and min(sizes) >= 44)
            bg = c.page.evaluate("getComputedStyle(document.querySelector('.ta-consent')).backgroundColor")
            check(tag + ": light neutral background", bg == "rgb(246, 247, 249)")
            box.locator("[data-analytics-all]").scroll_into_view_if_needed()
            check(tag + ": all actions reachable (scrollable inside the banner)", box.locator("[data-analytics-none]").is_visible() and box.locator("[data-analytics-save]").is_visible())
            c.close()

        # 2. no third-party request, no storage, no cookies before consent - on every kind of page, at the narrowest width
        for path in PAGES:
            c = bm.Ctx(browser, viewport={"width": 320, "height": 640})
            c.goto("https://torgatlas.ru" + path)
            check("pre-consent %s: no Yandex and no foreign request, no storage, no cookies" % path,
                  c.mc == [] and c.foreign == [] and c.stored() == [None, None] and c.context.cookies() == [])
            check("pre-consent %s: Metrika preselected visually, no tracking without consent" % path, dialog(c.page).is_visible() and dialog(c.page).locator("[data-consent-metrika]").is_checked() and not dialog(c.page).locator("[data-consent-umami]").is_checked())
            c.close()

        # 3. keyboard: Tab order, Space toggles, focus ring visible, Enter saves; settings button opens focused dialog, Escape returns focus
        c = bm.Ctx(browser, viewport={"width": 375, "height": 667})
        c.goto("https://torgatlas.ru/proverka-lota/")
        c.page.locator(DIALOG + " a").first.focus()
        names = []
        for _ in range(6):
            c.page.keyboard.press("Tab")
            names.append(c.page.evaluate("document.activeElement.getAttribute('data-consent-umami') !== null ? 'umami' : document.activeElement.getAttribute('data-consent-metrika') !== null ? 'metrika' : (document.activeElement.textContent || '').trim()"))
            if names[-1] == "Отказаться от всего":
                break
        check("keyboard: Tab reaches both switches and all three buttons in order", names[:5] == ["umami", "metrika", "Принять выбранное", "Принять всё", "Отказаться от всего"])
        c.page.locator(DIALOG + " [data-consent-metrika]").focus()
        check("keyboard: visible focus ring on the switch", c.page.evaluate("getComputedStyle(document.activeElement).outlineStyle !== 'none' && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2"))
        c.page.keyboard.press("Space")
        check("keyboard: Space unticks preselected Metrika", not dialog(c.page).locator("[data-consent-metrika]").is_checked())
        c.page.keyboard.press("Space")
        check("keyboard: second Space ticks Metrika again, Umami stays off", dialog(c.page).locator("[data-consent-metrika]").is_checked() and not dialog(c.page).locator("[data-consent-umami]").is_checked())
        c.page.locator(DIALOG + " [data-analytics-save]").focus()
        c.page.keyboard.press("Enter")
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        check("keyboard: Enter on 'Принять выбранное' stores Metrika-only choice", c.stored() == ["declined", "accepted"] and not dialog(c.page).is_visible())
        c.page.locator("[data-analytics-settings]").first.focus()
        c.page.keyboard.press("Enter")
        check("keyboard: settings opens the dialog and moves focus into it", dialog(c.page).is_visible() and c.page.evaluate("document.activeElement.getAttribute('role') === 'dialog'"))
        check("keyboard: current choice is shown, not reset", dialog(c.page).locator("[data-consent-metrika]").is_checked() and not dialog(c.page).locator("[data-consent-umami]").is_checked())
        c.page.keyboard.press("Escape")
        check("keyboard: Escape closes without changing the choice, focus returns to the opener", not dialog(c.page).is_visible() and c.stored() == ["declined", "accepted"] and c.page.evaluate("document.activeElement.hasAttribute('data-analytics-settings')"))
        c.close()

        # 4. every mode + reload + valid saved decision does not reopen the banner
        modes = {"only-Umami": (True, False, ["accepted", "declined"], 0), "only-Metrika": (False, True, ["declined", "accepted"], 1),
                 "both": (True, True, ["accepted", "accepted"], 1), "refuse": (False, False, ["declined", "declined"], 0)}
        for name, (u, m, expect, tags) in modes.items():
            c = bm.Ctx(browser, viewport={"width": 390, "height": 844})
            c.goto("https://torgatlas.ru/")
            if name == "both":
                dialog(c.page).locator("[data-analytics-all]").click()
            elif name == "refuse":
                dialog(c.page).locator("[data-analytics-none]").click()
            else:
                bm.choose(c.page, u, m)
            c.page.wait_for_timeout(700)
            check("mode %s: stored %s" % (name, expect), c.stored() == expect)
            check("mode %s: Metrika tag requests = %d" % (name, tags), len(c.tag) == tags)
            c.page.reload(wait_until="domcontentloaded")
            c.page.wait_for_timeout(600)
            check("mode %s: banner not shown again after reload" % name, not dialog(c.page).is_visible())
            c.page.goto("https://torgatlas.ru/blog/", wait_until="domcontentloaded")
            c.page.wait_for_timeout(300)
            check("mode %s: decision applies on another page, banner stays closed" % name, not dialog(c.page).is_visible() and c.stored() == expect)
            c.close()
        c = bm.Ctx(browser)
        c.goto("https://torgatlas.ru/")
        dialog(c.page).locator("[data-analytics-all]").click()
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        c.page.locator("[data-analytics-settings]").first.click()
        bm.choose(c.page, True, False)
        c.page.wait_for_load_state("domcontentloaded")
        c.page.wait_for_timeout(800)
        check("withdrawal of Metrika keeps Umami choice, tag not loaded after reload", c.stored() == ["accepted", "declined"] and c.page.evaluate("window.ym") is None)
        c.close()

        # 5. XSS: hostile query/hash never executes or renders; address is cleaned after consent; debug switch survives alone
        c = bm.Ctx(browser)
        c.goto("https://torgatlas.ru/proverka-lota/?q=%3Cscript%3Ewindow.__xss%3D1%3C%2Fscript%3E&x=%22%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E#%22%3E%3Csvg%20onload%3Dwindow.__xss%3D1%3E")
        dialog(c.page).locator("[data-analytics-all]").click()
        c.page.wait_for_function("window.__tagLoads === 1", timeout=5000)
        check("XSS: nothing executed", c.page.evaluate("window.__xss") is None)
        check("XSS: banner HTML holds no reflected payload", "onerror" not in dialog(c.page).evaluate("n => n.outerHTML") if dialog(c.page).count() else True)
        check("XSS: address bar cleaned (no query, no fragment)", c.page.evaluate("location.search === '' && location.hash === ''"))
        c.close()
        c = bm.Ctx(browser)
        c.page.add_init_script("localStorage.setItem('ta_analytics_consent','declined');localStorage.setItem('ta_metrika_consent','accepted')")
        c.goto("https://torgatlas.ru/ai-poisk-lotov/?_ym_debug=2")
        check("debug switch ?_ym_debug=2 kept alone (stored consent, AI page)", c.page.evaluate("location.search") == "?_ym_debug=2" and c.page.locator("#ai-lot-form").count() == 1)
        c.close()

        # 6. anchors, internal links and AI page after URL cleaning
        c = bm.Ctx(browser)
        c.page.add_init_script("localStorage.setItem('ta_analytics_consent','declined');localStorage.setItem('ta_metrika_consent','accepted')")
        c.goto("https://torgatlas.ru/proverka-lota/?utm_source=x#lot-check-form")
        check("anchor #lot-check-form kept, query dropped, form present", c.page.evaluate("location.hash") == "#lot-check-form" and c.page.evaluate("location.search") == "" and c.page.locator("#lot-check-form").count() >= 1)
        c.page.locator("a[href='/poisk-imushchestva/']").first.click()
        c.page.wait_for_function("location.pathname === '/poisk-imushchestva/'", timeout=10000)
        c.page.go_back()
        c.page.wait_for_function("location.pathname === '/proverka-lota/'", timeout=10000)
        check("internal link and Back work after cleaning", c.page.evaluate("location.pathname") == "/proverka-lota/")
        c.goto("https://torgatlas.ru/ai-poisk-lotov/?session=abc")
        check("AI search page works after cleaning: form, query field, submit", c.page.locator("#ai-lot-form").count() == 1 and c.page.locator("#ai-query").count() == 1 and c.page.locator("#ai-submit").count() == 1 and c.page.evaluate("location.search") == "")
        c.close()

        # 7. one click, one event (bus = what Umami and Metrika both listen to) and one goal
        c = bm.Ctx(browser)
        c.page.add_init_script("localStorage.setItem('ta_analytics_consent','accepted');localStorage.setItem('ta_metrika_consent','accepted')")
        c.goto("https://torgatlas.ru/")
        c.page.evaluate("window.__bus = []; window.addEventListener('auction:funnel', e => { if (e.detail.event === 'funnel_contact_open') window.__bus.push(e.detail.channel || ''); }); document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a')) e.preventDefault(); });")
        targets = [("a[href^='tel:']", "phone"), ("a[href^='mailto:']", "email"), ("button[data-copy]", "max")]
        for sel, channel in targets:
            c.page.evaluate("window.__bus = []")
            before = c.goals().count("contact_click")
            c.page.locator(sel).first.click()
            c.page.wait_for_timeout(1200)
            check("one click on %s -> one bus event (%s)" % (sel, channel), c.page.evaluate("window.__bus") == [channel])
            check("one click on %s -> one contact_click goal" % sel, c.goals().count("contact_click") == before + 1)
        tg = c.page.locator("a[href^='https://t.me/']")
        if tg.count():
            c.page.evaluate("window.__bus = []")
            tg.first.click()
            c.page.wait_for_timeout(1200)
            check("one click on a Telegram link -> one bus event", c.page.evaluate("window.__bus") == ["telegram"])
        check("no foreign host contacted during the whole session", c.foreign == [])
        c.close()
        browser.close()

    print("FAILED: %s" % e2e.check.failed if e2e.check.failed else "ALL PASS")
    return 1 if e2e.check.failed else 0


if __name__ == "__main__":
    sys.exit(main())
