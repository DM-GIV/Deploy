#!/usr/bin/env python3
"""Idempotently apply the simplified main menu, the inactive «Каталог — Скоро» marker and the extra footer links to every page.

Header (inner pages): AI-поиск лотов · Проверка лота · Сопровождение · Покупка · Примеры · Материалы · Каталог (inactive, «Скоро»).
The separate «Поиск», «Форматы» and «Главная» items are not in the header (the logo goes home); /poisk-imushchestva/ and /formaty-raboty/ stay
indexable, in the sitemap and are linked from every footer, from the services pages and from the AI-search page.
The future catalogue is plain text only: no link, no sitemap entry, no Schema.org.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS = [("/ai-poisk-lotov/", "AI-поиск лотов"), ("/proverka-lota/", "Проверка лота"), ("/soprovozhdenie-torgov/", "Сопровождение"),
         ("/pokupka-imushchestva/", "Покупка"), ("/primery-lotov/", "Примеры"), ("/blog/", "Материалы")]
SOON = '<span class="nav-soon" title="Каталог имущества ТоргАтлас: в разработке">Каталог <small>Скоро</small></span>'
FOOTER_EXTRA = [("/poisk-imushchestva/", "Индивидуальный подбор"), ("/formaty-raboty/", "Форматы работы")]


def inner_nav(path: str) -> str:
    links = "".join(f'<a href="{h}"' + (' aria-current="page"' if h == path else "") + f">{t}</a>" for h, t in ITEMS)
    return f'<nav class="nav" aria-label="Основное меню">{links}{SOON}</nav>'


def home_links() -> str:
    links = "".join(f'<a href="{h}">{t}</a>' for h, t in ITEMS)
    return f'<div class="nav-links">{links}<a href="#contacts">Контакты</a>{SOON}</div>'


def main() -> None:
    files = subprocess.check_output(["git", "ls-files", "*.html"], cwd=ROOT, text=True).split()
    for name in files:
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        original = text
        page = "/" + name[: -len("index.html")] if name.endswith("index.html") else "/" + name
        if name == "privacy/consent/index.html":
            continue
        if name == "index.html":
            text = re.sub(r'<div class="nav-links">.*?</div>', home_links(), text, count=1, flags=re.S)
        else:
            text = re.sub(r'<nav class="nav" aria-label="Основное меню">.*?</nav>', inner_nav(page), text, count=1, flags=re.S)
        footer = re.search(r'<footer[^>]*>.*?</footer>', text, flags=re.S)
        if footer:
            block = footer.group(0)
            extra = "".join(f'<a href="{h}">{t}</a> ' for h, t in FOOTER_EXTRA if f'href="{h}"' not in block and page != h)
            if extra and '<a href="/privacy/">' in block:
                new = block.replace('<a href="/privacy/">', extra + '<a href="/privacy/">', 1)
                text = text.replace(block, new, 1)
        if text != original:
            path.write_text(text, encoding="utf-8")
            print("updated", name)


if __name__ == "__main__":
    main()
