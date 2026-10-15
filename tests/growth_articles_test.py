"""Static contract for the three approved articles, the compact /blog/ cards, the simplified menu and the (inactive) future catalogue."""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLUGS = ["kak-uchastvovat-v-torgah-po-bankrotstvu", "publichnoe-predlozhenie-bankrotstvo", "zadatok-na-torgah-po-bankrotstvu"]
H1 = {
    SLUGS[0]: "Как участвовать в торгах по банкротству: инструкция для начинающего покупателя",
    SLUGS[1]: "Публичное предложение на торгах по банкротству: как купить имущество при снижении цены",
    SLUGS[2]: "Задаток на торгах по банкротству: как внести, вернуть и не потерять деньги",
}
# distinctive sentences of the owner-approved text that must survive verbatim
APPROVED = {
    SLUGS[0]: ["Главная ошибка: выбирать объект по низкой начальной цене, не выяснив, что фактически продаётся.",
               "Недостающие документы или противоречия между источниками — основание приостановить решение до выяснения обстоятельств.",
               "Платёж сам по себе ещё не означает допуск к торгам.", "Допустим, автомобиль выставлен за 600 000 рублей.",
               "реальная сумма вложений уже существенно выше стартовой цены", "Не путайте победу на торгах с моментом получения объекта или регистрации права.",
               "С чего начать? Используйте AI-поиск ТоргАтлас, найдите интересующий объект и сформируйте бесплатную карту проверки лота."],
    SLUGS[1]: ["Это только иллюстрация. Конкретный график всегда нужно брать из действующего сообщения о продаже.",
               "Распространённое заблуждение — считать, что победит тот, кто первым нажал кнопку подачи заявки.",
               "при нескольких разных подходящих ценовых предложениях преимущество имеет максимальная цена",
               "при равных подходящих предложениях значение имеет очередность подачи заявок",
               "Ожидание очередного снижения может улучшить цену, но увеличивает вероятность, что другой участник приобретёт имущество раньше.",
               "Не выбирайте момент участия только по размеру скидки."],
    SLUGS[2]: ["Сверьте пять сведений: номер процедуры и лота, сумму, получателя, банковские реквизиты и крайний срок поступления средств.",
               "Платёж сам по себе" if False else "важен не только факт отправки денег, но и соблюдение установленного порядка",
               "в течение пяти рабочих дней со дня подписания протокола о результатах торгов",
               "Не следует предполагать, что возврат при любых обстоятельствах происходит одинаково.",
               "В предусмотренном законом случае задаток победителю не возвращается.",
               "Лучше обнаружить проблему до платежа, чем выяснять её после определения победителя."],
}


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def article(slug):
    return read(f"blog/{slug}/index.html")


def all_html():
    names = [n for n in subprocess.check_output(["git", "ls-files", "*.html"], cwd=ROOT, text=True).split() if not n.startswith("tests/")]
    return {n: read(n) for n in names}


def jsonld(html):
    return [json.loads(m) for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.S)]


class Articles(unittest.TestCase):
    def test_generated_pages_match_the_generator(self):
        result = subprocess.run([sys.executable, "scripts/generate-articles.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_each_article_is_indexable_with_unique_metadata(self):
        titles, descriptions = set(), set()
        for slug in SLUGS:
            html = article(slug)
            self.assertIn('name="robots" content="index,follow,max-image-preview:large"', html, slug)
            self.assertNotIn("noindex", html, slug)
            self.assertIn(f'<link rel="canonical" href="https://torgatlas.ru/blog/{slug}/">', html)
            self.assertEqual(len(re.findall(r"<h1>", html)), 1)
            self.assertIn(f"<h1>{H1[slug]}</h1>", html)
            titles.add(re.search(r"<title>(.*?)</title>", html).group(1))
            descriptions.add(re.search(r'name="description" content="(.*?)"', html).group(1))
            self.assertIn('property="og:url"', html)
        self.assertEqual((len(titles), len(descriptions)), (3, 3))

    def test_direct_answer_is_visible_and_40_to_80_words(self):
        for slug in SLUGS:
            html = article(slug)
            answer = re.search(r'<p class="lead art-answer" id="answer">(.*?)</p>', html).group(1)
            self.assertTrue(40 <= len(re.findall(r"[\w\-]+", answer)) <= 80, slug)
            self.assertLess(html.index('id="answer"'), html.index("<details"))     # answer comes before any collapsible section

    def test_sections_are_native_details_with_all_text_in_raw_html(self):
        for slug in SLUGS:
            html = article(slug)
            self.assertGreaterEqual(html.count('<details class="art-sec"'), 4, slug)
            self.assertEqual(html.count("<details"), html.count("</details>"))
            self.assertNotRegex(html, r"display:\s*none", slug)
            # nothing but the optional JS-only toolbar carries the hidden attribute
            self.assertEqual(len(re.findall(r"\shidden[\s>=]", html)), 1)
            self.assertIn("data-art-tools", html)
            for needle in APPROVED[slug]:
                self.assertIn(needle, html, f"{slug}: approved text lost: {needle[:50]}")
            for i in range(1, html.count('<details class="art-sec"') + 1):
                self.assertIn(f'href="#s{i}"', html)
                self.assertIn(f'id="s{i}"', html)
            # the plan, the practical result, the sources and the CTA are outside the collapsible sections
            outside = re.sub(r"<details.*?</details>", "", html, flags=re.S)
            for marker in ("План статьи", "Практический итог", "Источники и проверка", 'href="/ai-poisk-lotov/"', 'href="/proverka-lota/#lot-check-form"'):
                self.assertIn(marker, outside, f"{slug}: {marker}")

    def test_cta_links_and_tracking(self):
        for slug in SLUGS:
            html = article(slug)
            self.assertGreaterEqual(html.count('href="/ai-poisk-lotov/"'), 2)
            self.assertGreaterEqual(html.count('href="/proverka-lota/#lot-check-form"'), 2)
            self.assertIn('data-track="article_ai_search_cta_click"', html)
            self.assertIn('data-track="article_lot_check_cta_click"', html)
            self.assertNotRegex(html, r"data-track=\"[^\"]*[:/\d@?]")        # funnel-events refuses such values

    def test_schema_is_truthful(self):
        for slug in SLUGS:
            html = article(slug)
            blocks = jsonld(html)
            post = next(b for b in blocks if b["@type"] == "BlogPosting")
            crumbs = next(b for b in blocks if b["@type"] == "BreadcrumbList")
            self.assertEqual(post["url"], f"https://torgatlas.ru/blog/{slug}/")
            self.assertEqual(post["author"]["@type"], "Organization")
            self.assertRegex(post["datePublished"], r"^2026-10-15$")
            self.assertRegex(post["dateModified"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertEqual(post["headline"], H1[slug])
            for forbidden in ("aggregateRating", "review", "reviewRating", "Person", "interactionStatistic", "wordCount"):
                self.assertNotIn(forbidden, json.dumps(post), forbidden)
            self.assertEqual([i["position"] for i in crumbs["itemListElement"]], [1, 2, 3])
            self.assertEqual(crumbs["itemListElement"][-1]["item"], post["url"])

    def test_legal_sources_and_verification_note(self):
        zad, pub = article(SLUGS[2]), article(SLUGS[1])
        for html in (zad, pub):
            self.assertIn("https://www.consultant.ru/document/cons_doc_LAW_39331/", html)
            self.assertIn("сверены 15.10.2026", html)
            self.assertIn("для отдельных категорий" if html is pub else "могут отличаться", html)
        self.assertIn("п. 15 ст. 110", zad); self.assertIn("п. 16 ст. 110", zad); self.assertIn("п. 12 ст. 110", zad); self.assertIn("п. 3 ст. 139", zad)
        self.assertIn("п. 4 ст. 139", pub)
        self.assertNotRegex(article(SLUGS[0]) + pub + zad, r"гарантир[а-я]+ (?:победу|прибыль|результат)")

    def test_no_invented_credentials_or_claims(self):
        for slug in SLUGS:
            text = re.sub(r"<[^>]+>", " ", article(slug))
            for bad in ("кейс", "наши клиенты", "успешно купили", "лет опыта", "опыт работы", "отзыв", "рейтинг", "гарантируем"):
                self.assertNotIn(bad, text.lower(), f"{slug}: {bad}")


class BlogIndex(unittest.TestCase):
    def test_three_compact_cards_without_duplicated_articles(self):
        html = read("blog/index.html")
        self.assertLess(len(html), 30_000)
        for slug in SLUGS:
            card = re.search(rf'<article class="guide-card" id="card-{slug}">.*?</article>', html, flags=re.S).group(0)
            self.assertEqual(card.count("<h2>"), 1)
            self.assertIn('<details class="card-more"><summary><span class="when-closed">Развернуть</span><span class="when-open">Свернуть</span></summary>', card)
            self.assertIn(f'<a class="card-read" href="/blog/{slug}/">Читать полную статью →</a>', card)
            self.assertLess(len(re.sub(r"<[^>]+>", " ", card).split()), 90)          # short overview, not the article
            for needle in APPROVED[slug]:
                self.assertNotIn(needle, html, "full article text must not be duplicated in /blog/")
        self.assertEqual(html.count("<details"), 3)

    def test_blog_lists_the_older_guides_too(self):
        html = read("blog/index.html")
        for slug in ("kak-proverit-lot-pered-torgami", "kak-proverit-avtomobil-s-torgov", "kak-proverit-zemelnyi-uchastok-s-torgov"):
            self.assertIn(f'href="/blog/{slug}/"', html)


class SitemapAndDrafts(unittest.TestCase):
    def test_sitemap_has_the_articles_with_real_dates_and_nothing_noindex(self):
        sitemap = read("sitemap.xml")
        for slug in SLUGS:
            self.assertIn(f"<loc>https://torgatlas.ru/blog/{slug}/</loc><lastmod>2026-10-15</lastmod>", sitemap)
        for path, html in all_html().items():
            url = "https://torgatlas.ru/" + path[: -len("index.html")] if path.endswith("index.html") else None
            if url and f"<loc>{url}</loc>" in sitemap:
                self.assertNotIn("noindex", html, f"{path} is in the sitemap but noindex")
        for slug in ("gosudarstvennye-i-municipalnye-torgi", "o-chem-budem-pisat-v-torgatlas"):
            self.assertNotIn(slug, sitemap)
        self.assertEqual(len(re.findall("<loc>", sitemap)), len(set(re.findall("<loc>(.*?)</loc>", sitemap))))

    def test_individual_selection_page_is_preserved(self):
        html = read("poisk-imushchestva/index.html")
        self.assertIn('id="search-brief-form"', html)
        self.assertIn('name="robots" content="index', html)
        self.assertIn("<loc>https://torgatlas.ru/poisk-imushchestva/</loc>", read("sitemap.xml"))


class MenuAndCatalogue(unittest.TestCase):
    def test_header_is_simplified_and_catalogue_marker_is_inactive(self):
        for path, html in all_html().items():
            if path == "privacy/consent/index.html":
                continue
            nav = re.search(r'<nav class="nav" aria-label="Основное меню">.*?</nav>', html, flags=re.S)
            if path == "index.html":
                nav = re.search(r'<div class="nav-links">.*?</div>', html, flags=re.S)
            if nav is None and 'noindex' in html:
                continue                                                           # minimal noindex draft without site chrome
            self.assertIsNotNone(nav, path)
            nav = nav.group(0)
            self.assertNotIn('href="/poisk-imushchestva/"', nav, path)             # no duplicating «Поиск» item
            self.assertNotIn(">Поиск<", nav)
            self.assertEqual(nav.count('<span class="nav-soon"'), 1, path)
            self.assertIn("Каталог <small>Скоро</small>", nav)
            self.assertLessEqual(len(re.findall(r"<a ", nav)), 7, path)
            self.assertIn('href="/ai-poisk-lotov/"', nav)
            self.assertIn('href="/proverka-lota/"', nav)
            footer = re.search(r"<footer.*?</footer>", html, flags=re.S)
            if footer and path not in ("poisk-imushchestva/index.html", "404.html"):
                self.assertIn('href="/poisk-imushchestva/"', footer.group(0), path)

    def test_future_catalogue_is_never_a_link_nor_launched_product(self):
        sitemap, llms = read("sitemap.xml"), read("llms.txt")
        for path, html in all_html().items():
            self.assertNotRegex(html, r'href="[^"]*(?:app\.torgatlas|torgatos)', path)
            self.assertNotRegex(html, r"torgatos", path)
            for block in jsonld(html):
                self.assertNotIn("app.torgatlas", json.dumps(block), path)
            for match in re.finditer(r"app\.torgatlas\.ru", html):
                before = html[max(0, match.start() - 160): match.start()]
                self.assertNotIn("<a ", before.split("</a>")[-1], f"{path}: address inside a link")
        for text in (sitemap, llms):
            self.assertNotIn("app.torgatlas", text)
        self.assertFalse((ROOT / "app").exists())

    def test_home_explains_the_difference_and_keeps_the_working_actions(self):
        html = read("index.html")
        self.assertIn("AI-поиск — уже работает", html)
        self.assertIn("Полный каталог — в разработке", html)
        self.assertIn('<span class="home-status-addr">app.torgatlas.ru</span>', html)
        for keep in ('href="/proverka-lota/#lot-check-form" data-track="lot_check_cta_click"', 'href="/poisk-imushchestva/#search-brief-form" data-track="lot_search_cta_click"'):
            self.assertIn(keep, html)
        self.assertLess(html.index("home-status"), html.index('id="start"'))     # explanation sits next to the AI-search entry, before the scenarios
        self.assertRegex(html, r"home-bundle\.css\?v=[a-f0-9]{12}")

    def test_ai_page_cta_is_unified_and_inactive(self):
        html = read("ai-poisk-lotov/index.html")
        cta = re.search(r'<p class="ai-catalog-cta".*?</p>', html, flags=re.S).group(0)
        self.assertIn("Посмотреть больше лотов в каталоге ТоргАтлас", cta)
        self.assertIn(">В разработке<", cta)
        self.assertIn("app.torgatlas.ru", cta)
        self.assertNotRegex(cta, r"<a\b|href=")
        self.assertIn('aria-disabled="true"', cta)
        self.assertIn("hidden", cta)


if __name__ == "__main__":
    unittest.main()
