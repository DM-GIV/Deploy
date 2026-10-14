#!/usr/bin/env python3
"""Generate the 3-day Moscow-time research-case fallback and browser asset."""
from __future__ import annotations

import argparse
import html
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POOL = ROOT / "content/research-cases.json"
START = "<!-- RESEARCH_SHOWCASE_START -->"
END = "<!-- RESEARCH_SHOWCASE_END -->"


def period_number(day: date) -> int:
    return (day - date(1970, 1, 1)).days // 3


def selection(cases: list[dict], day: date, count: int = 8) -> list[dict]:
    start = (period_number(day) * 3) % len(cases)
    return [cases[(start + offset) % len(cases)] for offset in range(count)]


def card(item: dict) -> str:
    esc = lambda value: html.escape(str(value), quote=True)
    return (
        '<article class="rotation-case-card">'
        f'<div class="rotation-case-top"><span>{esc(item["kind"])}</span><span>{esc(item["procedure"])}</span></div>'
        f'<div class="rotation-case-body"><h3>{esc(item["title"])}</h3>'
        '<div class="rotation-case-label">Цена на дату исследования</div>'
        f'<div class="rotation-case-price">{esc(item["price"])}</div>'
        f'<p>{esc(item["summary"])}</p><p><strong>Проверить:</strong> {esc(item["check"])}</p>'
        f'<a href="{esc(item["url"])}" target="_blank" rel="noopener noreferrer">Первоисточник ↗</a></div></article>'
    )


def browser_asset(pool: dict) -> str:
    encoded = json.dumps(pool["cases"], ensure_ascii=False, separators=(",", ":"))
    return f'''/* Generated from content/research-cases.json. Do not edit by hand. */
(function(){{'use strict';
const cases={encoded};
const visible=8;
function moscowSerial(d){{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));return Math.floor(Date.UTC(parts.year,parts.month-1,parts.day)/86400000);}}
function rotationSelection(d){{const period=Math.floor(moscowSerial(d)/3);const start=((period*3)%cases.length+cases.length)%cases.length;return Array.from({{length:visible}},(_,i)=>cases[(start+i)%cases.length]);}}
function el(tag,cls,text){{const out=document.createElement(tag);if(cls)out.className=cls;if(text!==undefined)out.textContent=text;return out;}}
function render(){{const host=document.getElementById('research-lot-showcase');if(!host)return;const grid=el('div','rotation-case-grid');rotationSelection(new Date()).forEach(item=>{{const article=el('article','rotation-case-card');const top=el('div','rotation-case-top');top.append(el('span','',item.kind),el('span','',item.procedure));const body=el('div','rotation-case-body');body.append(el('h3','',item.title),el('div','rotation-case-label','Цена на дату исследования'),el('div','rotation-case-price',item.price),el('p','',item.summary));const check=el('p');const strong=el('strong','','Проверить: ');check.append(strong,document.createTextNode(item.check));const link=el('a','','Первоисточник ↗');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';body.append(check,link);article.append(top,body);grid.append(article);}});host.replaceChildren(grid);}}
if(typeof module!=='undefined'&&module.exports)module.exports={{cases,rotationSelection,moscowSerial}};
if(typeof document!=='undefined'){{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{{once:true}});else render();}}
}})();
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--at", default=date.today().isoformat(), help="Moscow calendar date YYYY-MM-DD")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    day = date.fromisoformat(args.at)
    pool = json.loads(POOL.read_text(encoding="utf-8"))
    cases = pool["cases"]
    if pool.get("rotation_days") != 3 or pool.get("visible_cards") != 8:
        raise SystemExit("pool rotation contract must be 3 days / 8 cards")
    if len(cases) < 8 or len({item["id"] for item in cases}) != len(cases) or len({item["url"] for item in cases}) != len(cases):
        raise SystemExit("pool needs at least eight unique ids and URLs")
    for item in cases:
        if item.get("image") is not None or item.get("image_rights") != "not_used":
            raise SystemExit(f"{item['id']}: unreviewed images are forbidden")
    chosen = selection(cases, day, pool["visible_cards"])
    period_start = date.fromordinal(date(1970, 1, 1).toordinal() + period_number(day) * 3)
    period_end = date.fromordinal(period_start.toordinal() + 2)
    markup = (
        START + '\n<div class="examples-notice"><strong>Подборка на три дня:</strong> восемь карточек автоматически выбираются из десяти проверенных исследований. Это не рейтинг выгоды и не перечень актуальных торгов.</div>'
        '<div id="research-lot-showcase" aria-label="Восемь примеров из проверенной подборки">'
        '<div class="rotation-case-grid">' + ''.join(card(item) for item in chosen) + '</div></div>'
        f'<p id="research-lots-note" class="home-evidence-note">Единая подборка периода {period_start.isoformat()}—{period_end.isoformat()} по московскому времени. '
        'Это исторические исследования публичных карточек, не подтверждение текущей доступности, сделки клиента или рыночного дисконта.</p>'
        '<a class="home-evidence-more" href="/primery-lotov/">Открыть полный архив исследований →</a>\n' + END
    )
    index_path = ROOT / "index.html"
    current = index_path.read_text(encoding="utf-8")
    if START not in current or END not in current:
        raise SystemExit("showcase markers are missing from index.html")
    expected_index = current[: current.index(START)] + markup + current[current.index(END) + len(END):]
    asset_path = ROOT / "assets/weekly-lots.js"
    expected_asset = browser_asset(pool)
    if args.check:
        if current != expected_index or asset_path.read_text(encoding="utf-8") != expected_asset:
            raise SystemExit("generated research showcase is stale")
        print(f"PASS: {len(cases)} verified cases; 8 visible; period {period_start}..{period_end}")
        return 0
    index_path.write_text(expected_index, encoding="utf-8")
    asset_path.write_text(expected_asset, encoding="utf-8")
    print(f"WROTE: {len(cases)} verified cases; 8 visible; period {period_start}..{period_end}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

