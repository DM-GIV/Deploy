#!/usr/bin/env python3
"""Build a static-only TorgAtlas restore from the verified F: site release.
Never reads databases or copies backend/config/secrets; produces a preview tree."""
from pathlib import Path
from shutil import copy2, copytree, rmtree
import re
import subprocess
import xml.etree.ElementTree as ET
import sys

ROOT = Path("/home/deploy/torgatlas-site-catalogue")
OUT = ROOT / "public"
assert (ROOT / ".git").is_dir(), "wrong checkout"
assert subprocess.check_output(["git", "-C", str(ROOT), "branch", "--show-current"], text=True).strip() == "catalogue"
assert (ROOT / "index.html").is_file() and (ROOT / "o-torgatlas" / "index.html").is_file()
assert 'RESEARCH_SHOWCASE_START' in (ROOT / 'index.html').read_text(encoding='utf8'), "unverified F: snapshot"

# This explicit allowlist deliberately omits the old lot examples, AI search,
# API/backend, SQLite, Docker, .git, private configuration, and credentials.
FILES = ["index.html", "404.html", "favicon.ico", "robots.txt", "sitemap.xml", "llms.txt"]
DIRS = ["blog", "formaty-raboty", "o-torgatlas", "oplata-uslug",
        "poisk-imushchestva", "pokupka-imushchestva", "privacy",
        "proverka-lota", "soprovozhdenie-torgov"]
if OUT.exists():
    assert OUT.is_dir() and not OUT.is_symlink()
    rmtree(OUT)
OUT.mkdir(mode=0o755)
for name in FILES:
    p = ROOT / name
    if p.is_file():
        copy2(p, OUT / name)
for name in DIRS:
    p = ROOT / name
    if p.is_dir():
        copytree(p, OUT / name, symlinks=False)
assets = ROOT / "assets"
for p in assets.rglob("*"):
    if not p.is_file() or p.is_symlink():
        continue
    rel = p.relative_to(assets)
    # No old real-lot case rotation, AI scripts or unneeded examples.
    if p.name in {"weekly-lots.js", "examples.css", "ai-search.js", "ai-search.css", "lead-submit.js", "analytics.js", "metrika.js"} or rel.parts[0] == "vendor":
        continue
    dest = OUT / "assets" / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    copy2(p, dest)

# Preserve only a single final newline for previously shipped CSS.
css=OUT/"assets"/"site.css"
if css.is_file():
    css.write_text(css.read_text(encoding="utf8").rstrip()+"\n",encoding="utf8")

blocked_anchor = re.compile(r'<a\b[^>]*href="/(?:ai-poisk-lotov|primery-lotov)/?[^"]*"[^>]*>.*?</a>', re.I | re.S)
sections_removed = {"home-status": 0, "home-evidence": 0}
count_links = 0
for p in OUT.rglob("*.html"):
    raw = p.read_text(encoding="utf8")
    if p == OUT / "index.html":
        raw, n = re.subn(r'<section\b[^>]*class="home-status"[^>]*>.*?</section>', '<section class="home-status" aria-labelledby="status-title"><div class="container"><h2 id="status-title" class="home-status-title">Каталог имущества — в разработке</h2><p>Сейчас доступны услуги поиска и проверки лотов, а также самостоятельные карты проверки и поиска. Онлайн-каталог и AI-поиск временно не открыты.</p></div></section>', raw, count=1, flags=re.S)
        sections_removed["home-status"] = n
        raw, n = re.subn(r'<section\b[^>]*class="home-evidence"[^>]*>.*?</section>', '', raw, count=1, flags=re.S)
        sections_removed["home-evidence"] = n
        raw = re.sub(r'<script[^>]*src="/assets/weekly-lots\.js[^"]*"[^>]*></script>', '', raw, flags=re.I)
    raw, n = blocked_anchor.subn('', raw)
    count_links += n
    raw = raw.replace('AI-поиск лотов, карта проверки лота, карта поиска имущества', 'Карта проверки лота, карта поиска имущества')
    raw = raw.replace('Бесплатно: AI-поиск', 'Бесплатно: карта проверки')
    # Disable analytics until the restored server actually has consent-gated
    # analytics available; no attempt to resurrect old analytics databases.
    raw = re.sub(r'<script[^>]*src="/assets/(?:analytics|metrika)\.js[^"]*"[^>]*></script>', '', raw, flags=re.I)
    p.write_text(raw, encoding="utf8")

# robots and sitemap must not advertise disabled lot samples or AI.
robots = OUT / "robots.txt"
robots.write_text(robots.read_text(encoding="utf8").rstrip() +
                  "\nDisallow: /ai-poisk-lotov/\nDisallow: /primery-lotov/\n", encoding="utf8")
sitemap = OUT / "sitemap.xml"
ET.register_namespace("", "http://www.sitemaps.org/schemas/sitemap/0.9")
tree = ET.parse(sitemap)
root = tree.getroot()
removed_sitemap = 0
for node in list(root):
    loc = next((child.text or "" for child in node if child.tag.endswith("loc")), "")
    if "/ai-poisk-lotov/" in loc or "/primery-lotov/" in loc:
        root.remove(node)
        removed_sitemap += 1
tree.write(sitemap, encoding="utf-8", xml_declaration=True)
llms = OUT / "llms.txt"
if llms.exists():
    llms.write_text("\n".join(line for line in llms.read_text(encoding="utf8").splitlines()
                              if "/ai-poisk-lotov/" not in line and "/primery-lotov/" not in line) + "\n", encoding="utf8")

# UX improvement based on the approved site research: make verification steps
# understandable without claiming live aggregator coverage or publishing old lots.
method = """<section class="home-steps" id="method" aria-labelledby="method-title">
  <div class="container">
    <div class="section-title"><div class="section-label">Как мы проверяем информацию</div><h2 id="method-title">От найденного лота до обоснованного решения</h2><p class="v2-lead">Агрегатор помогает обнаружить предложение. Прежде чем участвовать, важно сверить сведения с официальной публикацией и документами. Ссылка на лот — начало проверки, а не гарантия достоверности данных.</p></div>
    <div class="home-steps-grid">
      <div class="home-step"><span class="home-step-number">01</span><h3>Первоисточник и идентификаторы</h3><p>Сопоставляем номер торгов, должника, площадку, предмет продажи и даты публикаций. Отмечаем расхождения.</p></div>
      <div class="home-step"><span class="home-step-number">02</span><h3>Цена, задаток, периоды</h3><p>Разбираем начальную и действующую на конкретную дату цену, сроки приёма заявок и условия оплаты, если они подтверждены.</p></div>
      <div class="home-step"><span class="home-step-number">03</span><h3>Документы и права</h3><p>Отдельно проверяем объект, продаваемое право, состав лота, ограничения, возможность осмотра и доступность оригиналов документов.</p></div>
      <div class="home-step"><span class="home-step-number">04</span><h3>Решение и действия</h3><p>Фиксируем известное, неподтверждённое и риски. При необходимости согласуем проверку, участие и действия после торгов.</p></div>
    </div>
    <p class="home-steps-foot">Если информация отсутствует или противоречит источнику, так и указываем: «не подтверждено». Не обещаем прибыль, победу или определённый результат торгов. <a href="/proverka-lota/">Подробнее о проверке лота</a>.</p>
  </div>
</section>
"""
homepage=OUT/"index.html"
h=homepage.read_text(encoding="utf8")
assert '<section class="home-paths"' in h
h=h.replace('<section class="home-paths"',method+'<section class="home-paths"',1)
homepage.write_text(h,encoding="utf8")

# Existing public copy refers to /cookie/, but the verified release does not
# ship that separate page. Provide a transparent, static information landing.
cookie=OUT/"cookie"
cookie.mkdir(exist_ok=True)
(cookie/"index.html").write_text("""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cookie и аналитика | ТоргАтлас</title><meta name="description" content="Информация о настройках аналитики и обработке данных посетителей ТоргАтлас.">
<meta name="robots" content="index,follow"><link rel="canonical" href="https://torgatlas.ru/cookie/">
<link rel="stylesheet" href="/assets/seo.css"><link rel="icon" href="/favicon.ico"></head>
<body><header class="site-header"><div class="wrap header-inner"><a class="brand" href="/">ТоргАтлас</a></div></header>
<main><section class="intro"><div class="wrap"><h1>Cookie и аналитика</h1><p class="lead">Сведения о cookie, аналитических сервисах, выборе согласия и отзыве решения находятся в действующей политике обработки персональных данных.</p></div></section>
<section><div class="wrap"><p>В этой восстановленной статической версии сайта аналитические скрипты не загружаются. До отдельной проверки и запуска аналитики данные посещений через них не собираются.</p>
<p><a href="/privacy/#analytics">Открыть раздел об аналитике и cookie в политике</a></p><p><a href="/">Вернуться на главную</a></p></div></section></main></body></html>
""",encoding="utf8")

# Do not publish individual historical example prices even within educational
# articles: substitute a generic verification principle with no made-up case.
for rel in ["blog/kak-proverit-avtomobil-s-torgov/index.html",
            "proverka-lota/index.html"]:
    f=OUT/rel
    if not f.is_file(): continue
    val=f.read_text(encoding="utf8")
    val,_=re.subn(r'<div class="guide-tip"><strong>Пример из публичных торгов:</strong>.*?</div>',
                  '<div class="guide-tip"><strong>Практический принцип:</strong> снижение цены не заменяет техническую проверку, изучение ограничений и первичных документов. Сроки и цену следует подтверждать на дату обращения.</div>',
                  val,count=1,flags=re.S)
    f.write_text(val,encoding="utf8")

# Recover the static content but never pretend absent dynamic lead-intake
# and analytics services have been restored. Manual contact links remain.
for f in OUT.rglob("*.html"):
    val=f.read_text(encoding="utf8")
    val=re.sub(r'<script[^>]*src="/assets/lead-submit\.js[^"]*"[^>]*></script>','',val,flags=re.I)
    if f==OUT/"privacy"/"index.html":
        val=val.replace("Прямой приём заявок на сайте включён",
                        "Прямой приём заявок через сайт временно отключён до восстановления сервера")
        val=val.replace("На сайте активна только собственная система веб-аналитики Umami",
                        "В восстановленной статической версии сайта загрузка систем аналитики временно отключена. При последующем включении собственного сервиса Umami")
    f.write_text(val,encoding="utf8")


# The previous published method page contains a concrete historical lot and
# initial price from old research. Keep the method, not the deprecated case.
example=OUT/"proverka-lota"/"index.html"
v=example.read_text(encoding="utf8")
v,n=re.subn(r'<section class="method-example" id="primer-razbora"[^>]*>.*?</section>',
"""<section class="method-example" id="primer-razbora" aria-labelledby="example-title"><div class="wrap">
  <div class="subhead"><div class="eyebrow method-eyebrow">Методика проверки составного лота</div>
  <h2 id="example-title">Один лот может включать несколько объектов или прав</h2>
  <p>Дом и земельный участок, оборудование и принадлежности, доля и право требования требуют отдельных проверок. Не переносите сведения об одном объекте на весь лот.</p></div>
  <div class="example-grid">
    <div class="example-row"><span class="example-state state-verified">Уточняем</span><div><h3>Состав продажи</h3><p>Что именно продаётся: имущество, имущественное право, совокупность объектов; сколько идентификаторов и какие документы относятся к каждому.</p></div></div>
    <div class="example-row"><span class="example-state state-question">Вопросы</span><div><h3>Юридические и фактические ограничения</h3><p>Проверяем объём продаваемого права, обременения, состояние, доступ, осмотр и документы.</p></div></div>
    <div class="example-row"><span class="example-state state-check">Стоимость</span><div><h3>Цена с датой и условиями</h3><p>Уточняем цену конкретного периода, задаток, комиссии, обязательные расходы и дедлайны по официальному источнику.</p></div></div>
    <div class="example-row"><span class="example-state state-next">Результат</span><div><h3>Решение после проверки</h3><p>Отделяем подтверждённые сведения от неопределённости; оцениваем необходимость дальнейшей проверки или отказа.</p></div></div>
  </div></div></section>""",v,count=1,flags=re.S)
assert n==1, "historical method-example not replaced"
example.write_text(v,encoding="utf8")

# robots group scoping: previous append after Sitemap accidentally applied
# to the last user-agent. Give the wildcard group the two disallows.
rr=robots.read_text(encoding="utf8")
rr=rr.replace("\nDisallow: /ai-poisk-lotov/\nDisallow: /primery-lotov/\n","")
assert "User-agent: *\nAllow: /" in rr
rr=rr.replace("User-agent: *\nAllow: /", "User-agent: *\nAllow: /\nDisallow: /ai-poisk-lotov/\nDisallow: /primery-lotov/",1)
robots.write_text(rr,encoding="utf8")
assert "atctrade.ru" not in example.read_text(encoding="utf8")

assert sections_removed == {"home-status": 1, "home-evidence": 1}, sections_removed
assert not (OUT / "ai-poisk-lotov").exists()
assert not (OUT / "primery-lotov").exists()
assert not (OUT / "assets" / "weekly-lots.js").exists()
home = (OUT / "index.html").read_text(encoding="utf8")
assert 'RESEARCH_SHOWCASE_START' not in home and 'AI-поиск — уже работает' not in home
assert '/ai-poisk-lotov/' not in home and '/primery-lotov/' not in home
assert 'assets/weekly-lots.js' not in home
print("RESTORE_PREVIEW_PASS source=F_server_snapshot_0ebb, branch=catalogue")
print("HTML_PAGES", len(list(OUT.rglob("*.html"))))
print("FILES", sum(1 for q in OUT.rglob("*") if q.is_file()))
print("REMOVED_LINKS", count_links, "REMOVED_SITEMAP_ITEMS", removed_sitemap)
