#!/usr/bin/env python3
"""Idempotently apply the final main menu and the footer links to every page.

Header: AI-поиск · Услуги (hub: /formaty-raboty/) · Примеры · Материалы · О проекте, plus the visible action «Проверить лот».
«Проверка лота» is NOT a separate text item (the action button is that entry), the logo goes home, «Поиск» (individual selection),
«Сопровождение», «Покупка» and «Форматы» stay indexable landings reachable through the «Услуги» hub and every footer.
The future catalogue is not in the menu; it is a compact plain-text announcement on the home page and after the AI search.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS = [("/ai-poisk-lotov/", "AI-поиск"), ("/formaty-raboty/", "Услуги"), ("/primery-lotov/", "Примеры"), ("/blog/", "Материалы"), ("/o-torgatlas/", "О проекте")]
CTA = '<a class="nav-cta" href="/proverka-lota/#lot-check-form" data-track="nav_lot_check_cta_click">Проверить лот</a>'
FOOTER_EXTRA = [("/proverka-lota/", "Проверка лота"), ("/soprovozhdenie-torgov/", "Сопровождение"), ("/pokupka-imushchestva/", "Покупка"),
                ("/poisk-imushchestva/", "Индивидуальный подбор"), ("/formaty-raboty/", "Форматы работы")]


def inner_nav(path: str) -> str:
    links = "".join(f'<a href="{h}"' + (' aria-current="page"' if h == path else "") + f">{t}</a>" for h, t in ITEMS)
    return f'<nav class="nav" aria-label="Основное меню">{links}{CTA}</nav>'


def home_links() -> str:
    links = "".join(f'<a href="{h}">{t}</a>' for h, t in ITEMS)
    return f'<div class="nav-links">{links}<a href="#contacts">Контакты</a>{CTA}</div>'


def main() -> None:
    files = subprocess.check_output(["git", "ls-files", "*.html"], cwd=ROOT, text=True).split()
    for name in files:
        if name.startswith("tests/") or name == "privacy/consent/index.html":
            continue
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        original = text
        page = "/" + name[: -len("index.html")] if name.endswith("index.html") else "/" + name
        if name == "index.html":
            text = re.sub(r'<div class="nav-links">.*?</div>', home_links(), text, count=1, flags=re.S)
        elif '<nav class="nav" aria-label="Основное меню">' in text:
            text = re.sub(r'<nav class="nav" aria-label="Основное меню">.*?</nav>', inner_nav(page), text, count=1, flags=re.S)
        footer = re.search(r'<footer[^>]*>.*?</footer>', text, flags=re.S)
        if footer and '<a href="/privacy/">' in footer.group(0):
            block = footer.group(0)
            extra = "".join(f'<a href="{h}">{t}</a> ' for h, t in FOOTER_EXTRA if f'href="{h}"' not in block and page != h)
            if extra:
                text = text.replace(block, block.replace('<a href="/privacy/">', extra + '<a href="/privacy/">', 1), 1)
        if text != original:
            path.write_text(text, encoding="utf-8")
            print("updated", name)


if __name__ == "__main__":
    main()
