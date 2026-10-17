"""Static contract: three fully visible editorial articles, static blog cards, final menu, inactive future catalogue, indexable AI page."""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLUGS = ["kak-uchastvovat-v-torgah-po-bankrotstvu", "publichnoe-predlozhenie-bankrotstvo", "zadatok-na-torgah-po-bankrotstvu"]
OLD_GUIDES = ["kak-proverit-lot-pered-torgami", "kak-proverit-avtomobil-s-torgov", "kak-proverit-zemelnyi-uchastok-s-torgov"]
H1 = {
    SLUGS[0]: "Как участвовать в торгах по банкротству: инструкция для начинающего покупателя",
    SLUGS[1]: "Публичное предложение на торгах по банкротству: как купить имущество при снижении цены",
    SLUGS[2]: "Задаток на торгах по банкротству: как внести, вернуть и не потерять деньги",
}
# sentences whose (verified) meaning must survive the editorial rework verbatim
MEANING = {
    SLUGS[0]: ["Выбирать объект по низкой начальной цене, не выяснив, что фактически продаётся.",
               "Недостающие документы или противоречия между источниками — основание приостановить решение до выяснения обстоятельств.",
               "Допустим, автомобиль выставлен за 600 000 рублей.", "реальная сумма вложений уже существенно выше стартовой цены",
               "Не путайте победу на торгах с моментом получения объекта или регистрации права.",
               "Используйте AI-поиск ТоргАтлас, найдите интересующий объект и сформируйте бесплатную карту проверки лота."],
    SLUGS[1]: ["Это только иллюстрация. Конкретный график всегда нужно брать из действующего сообщения о продаже.",
               "Распространённое заблуждение — считать, что победит тот, кто первым нажал кнопку подачи заявки.",
               "При нескольких разных подходящих ценовых предложениях преимущество имеет максимальная цена.",
               "При равных подходящих предложениях значение имеет очередность подачи заявок.",
               "Ожидание очередного снижения может улучшить цену, но увеличивает вероятность, что другой участник приобретёт имущество раньше.",
               "Не выбирайте момент участия только по размеру скидки."],
    SLUGS[2]: ["важен не только факт отправки денег, но и соблюдение установленного порядка",
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

    def test_articles_are_fully_visible_no_accordions_no_controls(self):
        for slug in SLUGS:
            html = article(slug)
            for banned in ("<details", "<summary", "data-expand-all", "data-collapse-all", "Развернуть все", "Свернуть все", "art-sec", "art-toc", "План статьи", "article.js", "Практический итог"):
                self.assertNotIn(banned, html, f"{slug}: {banned}")
            self.assertNotRegex(html, r"\shidden[\s>=]", slug)
            self.assertNotRegex(html, r"display:\s*none", slug)
            self.assertNotIn("<button", html, slug)
            scripts = re.findall(r'<script src="([^"]+)"', html)
            self.assertEqual([re.sub(r"\?.*", "", s) for s in scripts], ["/assets/metrika.js", "/assets/analytics.js", "/assets/funnel-events.js"], slug)   # nothing is needed to read
            self.assertFalse(ROOT.joinpath("assets/article.js").exists())

    def test_editorial_template_elements(self):
        for slug in SLUGS:
            html = article(slug)
            self.assertIn('<main id="main" class="post">', html)
            self.assertIn('class="post-lede" id="answer"', html)
            self.assertGreaterEqual(html.count('<section class="post-section"><h2>'), 4, slug)
            self.assertRegex(html, r'<p class="post-meta">Обновлено 15 октября 2026 · около \d+ мин чтения</p>')
            self.assertIn('class="post-sources"', html); self.assertIn('class="post-cta"', html); self.assertIn('class="post-related"', html)
            self.assertEqual(len(re.findall(r"<h1>", html)), 1)
            self.assertIn(f"<h1>{H1[slug]}</h1>", html)
        self.assertIn('<figure class="example">', article(SLUGS[0])); self.assertIn("780 000", article(SLUGS[0]))
        self.assertIn('<figure class="example">', article(SLUGS[1]))
        self.assertIn('class="checklist"', article(SLUGS[2])); self.assertIn('class="callout callout--law"', article(SLUGS[2]))
        self.assertIn('class="steps"', article(SLUGS[1]))

    def test_each_article_is_indexable_with_unique_metadata(self):
        titles, descriptions = set(), set()
        for slug in SLUGS:
            html = article(slug)
            self.assertIn('name="robots" content="index,follow,max-image-preview:large"', html)
            self.assertIn(f'<link rel="canonical" href="https://torgatlas.ru/blog/{slug}/">', html)
            titles.add(re.search(r"<title>(.*?)</title>", html).group(1))
            descriptions.add(re.search(r'name="description" content="(.*?)"', html).group(1))
            self.assertIn('property="og:url"', html)
        self.assertEqual((len(titles), len(descriptions)), (3, 3))

    def test_direct_answer_40_to_80_words_and_meaning_preserved(self):
        for slug in SLUGS:
            html = article(slug)
            answer = re.search(r'<p class="post-lede" id="answer">(.*?)</p>', html).group(1)
            self.assertTrue(40 <= len(re.findall(r"[\w\-]+", answer)) <= 80, slug)
            text = re.sub(r"<[^>]+>", " ", html)
            text = re.sub(r"\s+", " ", text).replace("&nbsp;", " ")
            for needle in MEANING[slug]:
                self.assertIn(needle, text, f"{slug}: {needle[:60]}")

    def test_cta_links_and_tracking(self):
        for slug in SLUGS:
            html = article(slug)
            self.assertIn('href="/ai-poisk-lotov/" data-track="article_ai_search_cta_click"', html)
            self.assertIn('href="/proverka-lota/#lot-check-form" data-track="article_lot_check_cta_click"', html)
            self.assertIn('href="/formaty-raboty/"', html)
            self.assertNotRegex(html, r"data-track=\"[^\"]*[:/\d@?]")

    def test_schema_is_truthful(self):
        for slug in SLUGS:
            blocks = jsonld(article(slug))
            post = next(b for b in blocks if b["@type"] == "BlogPosting")
            crumbs = next(b for b in blocks if b["@type"] == "BreadcrumbList")
            self.assertEqual(post["url"], f"https://torgatlas.ru/blog/{slug}/")
            self.assertEqual(post["author"]["@type"], "Organization")
            self.assertEqual(post["datePublished"], "2026-10-15"); self.assertEqual(post["dateModified"], "2026-10-15")
            self.assertEqual(post["headline"], H1[slug])
            for forbidden in ("aggregateRating", "review", "reviewRating", "Person", "interactionStatistic"):
                self.assertNotIn(forbidden, json.dumps(post), forbidden)
            self.assertEqual([i["position"] for i in crumbs["itemListElement"]], [1, 2, 3])

    def test_legal_sources_and_verification_note(self):
        zad, pub = article(SLUGS[2]), article(SLUGS[1])
        for html in (zad, pub):
            self.assertIn("https://www.consultant.ru/document/cons_doc_LAW_39331/", html)
            self.assertIn("сверены 15.10.2026", html)
        for ref in ("п. 15 ст. 110", "п. 16 ст. 110", "п. 12 ст. 110", "п. 3 ст. 139"):
            self.assertIn(ref, zad)
        self.assertIn("п. 4 ст. 139", pub)

    def test_no_invented_credentials_or_claims(self):
        for slug in SLUGS:
            text = re.sub(r"<[^>]+>", " ", article(slug)).lower()
            for bad in ("кейс", "наши клиенты", "успешно купили", "лет опыта", "опыт работы", "отзыв", "рейтинг", "гарантируем"):
                self.assertNotIn(bad, text, f"{slug}: {bad}")


class BlogIndex(unittest.TestCase):
    def test_six_static_cards_one_obvious_link_no_full_text(self):
        html = read("blog/index.html")
        self.assertLess(len(html), 30_000)
        self.assertNotIn("<details", html); self.assertNotIn("Развернуть", html); self.assertNotIn("<button", html)
        for slug in SLUGS + OLD_GUIDES:
            card = re.search(rf'<article class="guide-card" id="card-{slug}">.*?</article>', html, flags=re.S).group(0)
            self.assertEqual(card.count("<h2>"), 1)
            self.assertEqual(card.count("<a "), 1)
            self.assertIn(f'<a class="card-read" href="/blog/{slug}/" data-track="blog_card_read_click">Читать статью →</a>', card)
            self.assertIn('class="guide-category"', card)
            self.assertLess(len(re.sub(r"<[^>]+>", " ", card).split()), 60)
        for slug in SLUGS:
            for needle in MEANING[slug]:
                self.assertNotIn(needle, html, "full article text must not be duplicated in /blog/")
        self.assertEqual(html.count('class="guide-card"'), 6)

    def test_old_guides_share_the_template_without_content_changes(self):
        seo, guide = read("assets/seo.css"), read("assets/guide.css")
        self.assertIn(".article-copy h2::before", seo)
        self.assertIn(".guide-body h2::before", guide)
        self.assertIn("max-width:760px", guide.split(".guide-body{", 1)[1].split("}", 1)[0])
        for slug in OLD_GUIDES:
            html = article(slug)
            self.assertRegex(html, r'class="(?:guide-body|wrap article-copy)"')
            self.assertNotIn("<details", html)


class SitemapAndDrafts(unittest.TestCase):
    def test_sitemap_has_the_articles_and_the_ai_page_and_nothing_noindex(self):
        sitemap = read("sitemap.xml")
        for slug in SLUGS:
            self.assertIn(f"<loc>https://torgatlas.ru/blog/{slug}/</loc><lastmod>2026-10-15</lastmod>", sitemap)
        self.assertIn("<loc>https://torgatlas.ru/ai-poisk-lotov/</loc>", sitemap)
        for path, html in all_html().items():
            url = "https://torgatlas.ru/" + path[: -len("index.html")] if path.endswith("index.html") else None
            if url and f"<loc>{url}</loc>" in sitemap:
                self.assertNotIn("noindex", html, f"{path} is in the sitemap but noindex")
        for slug in ("gosudarstvennye-i-municipalnye-torgi", "o-chem-budem-pisat-v-torgatlas"):
            self.assertNotIn(slug, sitemap)
        self.assertNotRegex(re.sub(r"<\?xml[^>]*\?>", "", sitemap), r"[?#]")                                  # no dynamic/query URLs
        self.assertEqual(len(re.findall("<loc>", sitemap)), len(set(re.findall("<loc>(.*?)</loc>", sitemap))))

    def test_individual_selection_page_is_preserved(self):
        html = read("poisk-imushchestva/index.html")
        self.assertIn('id="search-brief-form"', html)
        self.assertIn('name="robots" content="index', html)
        self.assertIn("<loc>https://torgatlas.ru/poisk-imushchestva/</loc>", read("sitemap.xml"))


class MenuAndCatalogue(unittest.TestCase):
    def test_final_header_on_every_page(self):
        for path, html in all_html().items():
            if path == "privacy/consent/index.html" or path.startswith("yandex_"):
                continue
            nav = re.search(r'<nav class="nav" aria-label="Основное меню">.*?</nav>', html, flags=re.S)
            if path == "index.html":
                nav = re.search(r'<div class="nav-links">.*?</div>', html, flags=re.S)
            if nav is None and "noindex" in html:
                continue
            self.assertIsNotNone(nav, path)
            nav = nav.group(0)
            labels = re.findall(r"<a [^>]*>([^<]+)</a>", nav)
            expected = ["AI-поиск", "Услуги", "Примеры", "Материалы", "О проекте"] + (["Контакты"] if path == "index.html" else []) + ["Проверить лот"]
            self.assertEqual(labels, expected, path)
            self.assertIn('class="nav-cta" href="/proverka-lota/#lot-check-form"', nav)
            self.assertRegex(nav, r'href="/formaty-raboty/"(?: aria-current="page")?>Услуги')
            for banned in ("nav-soon", 'href="/poisk-imushchestva/"', ">Поиск<", ">Каталог", ">Главная<", "Форматы<", "Сопровождение<", "Покупка<"):
                self.assertNotIn(banned, nav, f"{path}: {banned}")
            footer = re.search(r"<footer.*?</footer>", html, flags=re.S)
            if footer and path not in ("404.html",):
                for href in ("/poisk-imushchestva/", "/formaty-raboty/", "/soprovozhdenie-torgov/", "/pokupka-imushchestva/"):
                    if path != href.strip("/") + "/index.html":
                        self.assertIn(f'href="{href}"', footer.group(0), f"{path} footer lacks {href}")

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

    def test_home_explains_the_difference_and_keeps_the_working_actions(self):
        html = read("index.html")
        self.assertIn("AI-поиск — уже работает", html)
        self.assertIn("Полный каталог — в разработке", html)
        self.assertIn('<span class="home-status-addr">app.torgatlas.ru</span>', html)
        for keep in ('href="/proverka-lota/#lot-check-form" data-track="lot_check_cta_click"', 'href="/poisk-imushchestva/#search-brief-form" data-track="lot_search_cta_click"'):
            self.assertIn(keep, html)
        self.assertRegex(html, r"home-bundle\.css\?v=[a-f0-9]{12}")

    def test_ai_page_cta_is_unified_and_inactive(self):
        html = read("ai-poisk-lotov/index.html")
        cta = re.search(r'<p class="ai-catalog-cta".*?</p>', html, flags=re.S).group(0)
        self.assertIn("Посмотреть больше лотов в каталоге ТоргАтлас", cta)
        self.assertIn(">В разработке<", cta)
        self.assertNotRegex(cta, r"<a\b|href=")
        self.assertIn('aria-disabled="true"', cta)


if __name__ == "__main__":
    unittest.main()
