#!/usr/bin/env python3
"""Render the three approved bankruptcy-trade articles as static, fully visible editorial pages, and the static cards of /blog/.

One permanent URL per article.  No accordions, no hidden text, no script is needed to read anything.  The owner-approved wording is
edited only for flow and layout; every legally significant statement keeps its verified meaning (Garant text of 127-FZ, 15.10.2026:
art. 110 p. 12, 15, 16; art. 139 p. 3, 4) and is marked as such.

  python3 scripts/generate-articles.py          write blog/<slug>/index.html and the cards in blog/index.html
  python3 scripts/generate-articles.py --check  fail if the files differ from the generator output
"""
from __future__ import annotations

import argparse
import html
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://torgatlas.ru"
PUBLISHED = "2026-10-15"
MODIFIED = "2026-10-15"   # never later than the real date of the release; checked by tests against the server clock
VERIFIED_ON = "15.10.2026"
ART110 = "https://www.consultant.ru/document/cons_doc_LAW_39331/970a8647d4bfb2868e3ca913c3f3188e6d81d092/"
ART139 = "https://www.consultant.ru/document/cons_doc_LAW_39331/daac864a9cec4a65469d6383ef1bf1fe0a5367cc/"
GARANT110 = "https://base.garant.ru/185181/61be80f84cf4d95f84aeddb3178a7797/"
GARANT139 = "https://base.garant.ru/185181/c11465d9cdd9cd41f225c2e996875142/"
EFRSB = "https://bankrot.fedresurs.ru/"

_fp_spec = importlib.util.spec_from_file_location("fingerprint_assets", ROOT / "scripts/fingerprint-assets.py")
fingerprint_assets = importlib.util.module_from_spec(_fp_spec)
_fp_spec.loader.exec_module(fingerprint_assets)


def asset(path: str) -> str:
    return f"{path}?v={fingerprint_assets.fingerprint(path)}"


_spec = importlib.util.spec_from_file_location("site_nav", ROOT / "scripts/apply-site-nav.py")
site_nav = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(site_nav)

# block kinds: str (paragraph) | ("law", text) | ("callout", title, text) | ("steps", [..]) | ("checklist", [..])
#              | ("example", caption, [(label, value)], note) | ("schedule", caption, [(period, price)], note)
ARTICLES = [
    {
        "slug": "kak-uchastvovat-v-torgah-po-bankrotstvu",
        "title": "Как участвовать в торгах по банкротству — инструкция для начинающих",
        "h1": "Как участвовать в торгах по банкротству: инструкция для начинающего покупателя",
        "description": "Пошаговая инструкция для начинающего покупателя: где найти лот, что проверить до задатка, как подготовить заявку, рассчитать предельную цену и оформить результат.",
        "crumb": "Как участвовать в торгах",
        "rubric": "Инструкция · первое участие",
        "answer": "Торги по банкротству позволяют приобрести недвижимость, автомобили, оборудование и другое имущество должников. Но покупка начинается не с внесения задатка. Сначала необходимо найти публикацию, проверить предмет продажи и документы, изучить условия площадки, рассчитать допустимую цену и только затем подать заявку. Ниже — пять шагов от поиска лота до протокола и договора.",
        "sections": [
            ("1. Найдите подходящий объект", [
                "Искать имущество можно через ЕФРСБ, электронные торговые площадки и поисковые сервисы, в том числе ТоргАтлас. Но категория и цена — это ещё не всё. Сразу определите регион, тип процедуры, срок подачи заявок и состав имущества: если продаётся доля в квартире, право требования или неисправный автомобиль, это должно быть понятно до участия.",
                ("callout", "Главная ошибка", "Выбирать объект по низкой начальной цене, не выяснив, что фактически продаётся.")]),
            ("2. Проверьте лот до внесения денег", [
                "Сопоставьте сообщение о торгах, карточку электронной площадки, положение о продаже и доступные документы. Что именно проверять, зависит от имущества:",
                ("checklist", ["Недвижимость — права, обременения, фактическое пользование и возможность осмотра.",
                               "Транспорт — идентификаторы, регистрационные ограничения и техническое состояние.",
                               "Оборудование — комплектность, демонтаж и вывоз."]),
                "Недостающие документы или противоречия между источниками — основание приостановить решение до выяснения обстоятельств."]),
            ("3. Подготовьте участие", [
                "Изучите правила конкретной электронной площадки: регистрацию, необходимые документы, требования к электронной подписи, срок подачи заявки и порядок внесения задатка. Реквизиты проверяйте только по действующей публикации и официальным документам процедуры.",
                ("callout", "Платёж — это не допуск", "Внесённый задаток сам по себе ещё не означает допуск к торгам.")]),
            ("4. Установите предельную цену", [
                "Допустим, автомобиль выставлен за 600 000 рублей. Если его приведение в порядок, перевозка и оформление потребуют ещё 180 000 рублей, реальная сумма вложений уже существенно выше стартовой цены.",
                ("example", "Пример расчёта", [("Стартовая цена автомобиля", "600 000 ₽"), ("Приведение в порядок, перевозка, оформление", "180 000 ₽"), ("Итого вложений", "780 000 ₽")],
                 "Цифры иллюстративны. В вашем расчёте будут свои расходы и риски."),
                "До подачи заявки определите собственный предел ставки с учётом состояния имущества, расходов, рисков и вашей цели покупки."]),
            ("5. Проверьте результат и оформление", [
                "После торгов изучите протокол, условия заключения договора, оплаты и передачи имущества. Не путайте победу на торгах с моментом получения объекта или регистрации права."]),
            ("С чего начать", [
                "Используйте AI-поиск ТоргАтлас, найдите интересующий объект и сформируйте бесплатную карту проверки лота."]),
        ],
        "cta_title": "Нашли объект? Проверьте его до заявки",
        "cta_text": "Найдите лот в AI-поиске и сформируйте бесплатную карту проверки: сайт составит список вопросов к документам и условиям торгов.",
        "sources": [
            ("Единый федеральный реестр сведений о банкротстве (ЕФРСБ)", EFRSB),
            ("Статья 110 127-ФЗ «О несостоятельности (банкротстве)»: порядок проведения торгов, заявка, задаток, протоколы", ART110),
            ("Статья 139 127-ФЗ: продажа имущества должника", ART139)],
        "verified": "Инструкция не содержит спорных юридических утверждений сверх общего порядка (заявка, допуск, протоколы, договор). Конкретные сроки, суммы и требования всегда берутся из сообщения о торгах вашей процедуры.",
        "related": ["publichnoe-predlozhenie-bankrotstvo", "zadatok-na-torgah-po-bankrotstvu", "kak-proverit-lot-pered-torgami"],
    },
    {
        "slug": "publichnoe-predlozhenie-bankrotstvo",
        "title": "Публичное предложение при банкротстве — как купить при снижении цены",
        "h1": "Публичное предложение на торгах по банкротству: как купить имущество при снижении цены",
        "description": "Как работает публичное предложение: график снижения цены, кто получает право купить при одной, разных и равных заявках, когда подавать заявку и как не переплатить.",
        "crumb": "Публичное предложение",
        "rubric": "Разбор · снижение цены",
        "answer": "Публичное предложение — один из способов продажи имущества должника, при котором цена снижается по заранее опубликованному графику. Оно часто привлекает покупателей возможностью приобрести актив дешевле. Однако ждать минимальной цены не всегда выгодно: подходящий объект может быть продан раньше. Ниже — как устроен график, кто получает право покупки и когда подавать заявку.",
        "sections": [
            ("Как работает снижение цены", [
                "При продаже имущества в рамках конкурсного производства публичное предложение обычно следует после безрезультатных повторных торгов. Организатор публикует график: цену каждого периода, величину снижения и сроки.",
                ("schedule", "Пример графика", [("Первоначальная цена", "2 млн ₽"), ("Следующий этап", "1,8 млн ₽"), ("Затем", "1,6 млн ₽")],
                 "Это только иллюстрация. Конкретный график всегда нужно брать из действующего сообщения о продаже."),
                ("law", "п. 4 ст. 139 127-ФЗ: публичное предложение применяется, если повторные торги признаны несостоявшимися либо договор не заключён с их единственным участником или по их итогам. В сообщении указываются величина снижения начальной цены и срок, по истечении которого цена последовательно снижается; начальная цена устанавливается в размере начальной цены из сообщения о повторных торгах.")]),
            ("Кто получает право купить имущество", [
                "Распространённое заблуждение — считать, что победит тот, кто первым нажал кнопку подачи заявки. В действительности по статье 139 закона о банкротстве правила зависят от предложений в соответствующем периоде:",
                ("steps", ["При одном подходящем предложении и отсутствии конкурентов право приобретения получает подавший его участник.",
                           "При нескольких разных подходящих ценовых предложениях преимущество имеет максимальная цена.",
                           "При равных подходящих предложениях значение имеет очередность подачи заявок."]),
                "Поэтому недостаточно знать только стоимость текущего этапа. Необходимо разобраться в действующей процедуре и условиях допуска.",
                ("law", "п. 4 ст. 139 127-ФЗ: право приобретения принадлежит участнику, подавшему заявку с ценой не ниже начальной цены периода, при отсутствии предложений других участников; при нескольких разных предложениях — предложившему максимальную цену; при равных предложениях — первым представившему заявку. С даты определения победителя приём заявок прекращается.")]),
            ("Когда подавать заявку", [
                "До участия ответьте себе на три вопроса.",
                ("steps", ["Сколько объект стоит для вас? Рассчитайте реалистичную стоимость использования или перепродажи с учётом ремонта, налогов, доставки, оформления и рисков.",
                           "Что ещё неизвестно? Низкая цена не компенсирует автоматически проблемы с документами, состоянием, доступом или правами третьих лиц.",
                           "Готовы ли вы потерять возможность покупки? Ожидание очередного снижения может улучшить цену, но увеличивает вероятность, что другой участник приобретёт имущество раньше."])]),
            ("Практическое правило", [
                "Сначала установите максимальную экономически допустимую цену покупки. Затем изучите график снижения, условия заявок и правовой статус объекта. Не выбирайте момент участия только по размеру скидки."]),
        ],
        "cta_title": "Присмотрели объект? Найдите и проверьте его",
        "cta_text": "Найдите подходящее предложение через AI-поиск ТоргАтлас и сформируйте бесплатную карту проверки конкретного лота до подачи заявки.",
        "sources": [
            ("Статья 139 127-ФЗ «О несостоятельности (банкротстве)» (КонсультантПлюс)", ART139),
            ("Статья 139 127-ФЗ, текст с изменениями (Гарант)", GARANT139),
            ("Статья 110 127-ФЗ: допуск, заявки, порядок торгов, на который отсылает п. 3 ст. 139", ART110)],
        "verified": f"Положения п. 3 и 4 статьи 139 сверены {VERIFIED_ON} с текстом Федерального закона от 26.10.2002 № 127-ФЗ (Гарант, с изменениями и дополнениями). Закон меняется: перед участием сверяйте действующую редакцию и сообщение о продаже вашей процедуры; для отдельных категорий имущества и процедур действуют специальные правила.",
        "related": ["kak-uchastvovat-v-torgah-po-bankrotstvu", "zadatok-na-torgah-po-bankrotstvu", "kak-proverit-lot-pered-torgami"],
    },
    {
        "slug": "zadatok-na-torgah-po-bankrotstvu",
        "title": "Задаток на торгах по банкротству — как внести, вернуть и не потерять",
        "h1": "Задаток на торгах по банкротству: как внести, вернуть и не потерять деньги",
        "description": "Как проверить реквизиты и сроки задатка, когда его возвращают проигравшим заявителям, в каких случаях победитель его теряет и что проверить перед переводом.",
        "crumb": "Задаток",
        "rubric": "Разбор · деньги до заявки",
        "answer": "Задаток подтверждает серьёзность намерений участника торгов. Его размер, сроки и реквизиты определяются по условиям конкретной процедуры. Главные риски возникают, когда покупатель переводит деньги по непроверенным реквизитам, нарушает сроки или выигрывает торги, не будучи готовым заключить договор. Ниже — что проверить до оплаты, когда задаток возвращают и когда его теряют.",
        "sections": [
            ("Что проверить перед оплатой", [
                "Не ограничивайтесь суммой задатка в карточке агрегатора. Откройте сообщение о проведении торгов, положение о продаже и документы электронной площадки и сверьте пять сведений:",
                ("checklist", ["номер процедуры и лота;", "сумму задатка;", "получателя платежа;", "банковские реквизиты;", "крайний срок поступления средств."]),
                ("callout", "Особенно опасно", "Использовать реквизиты из старого объявления, переписки или пересланного файла без сверки с действующим первоисточником.")]),
            ("Можно ли подать заявку без задатка?", [
                "Условия определяются конкретной процедурой. Для предусмотренных законом торгов отсутствие подтверждённого поступления обязательного задатка может привести к отказу в допуске. Поэтому не откладывайте платёж до последней минуты: важен не только факт отправки денег, но и соблюдение установленного порядка. Сохраните банковское подтверждение и документы, по которым производился перевод.",
                ("law", "п. 12 ст. 110 127-ФЗ: отказ в допуске заявителя принимается, в частности, если поступление задатка на счета, указанные в сообщении о проведении торгов, не подтверждено на дату составления протокола об определении участников торгов.")]),
            ("Когда задаток возвращают", [
                "По общему правилу статьи 110 закона о банкротстве внесённые задатки возвращаются заявителям, кроме победителя, в течение пяти рабочих дней со дня подписания протокола о результатах торгов. Но конкретную ситуацию следует проверять отдельно: например, если заявка отозвана, заявителю отказали в допуске или торги отменены. Не следует предполагать, что возврат при любых обстоятельствах происходит одинаково.",
                ("law", "п. 15 ст. 110 127-ФЗ: суммы внесённых заявителями задатков возвращаются всем заявителям, за исключением победителя, в течение пяти рабочих дней со дня подписания протокола о результатах проведения торгов. К продаже имущества должника в конкурсном производстве эти правила применяются по отсылке п. 3 ст. 139 (пункты 3–19 ст. 110) с особенностями ст. 139.")]),
            ("Когда можно потерять задаток", [
                "Один из существенных рисков — победить и отказаться или уклониться от подписания договора. В предусмотренном законом случае задаток победителю не возвращается. Поэтому ещё до подачи заявки нужно оценить не только сумму задатка, но и возможность полностью оплатить имущество, оформить договор и принять объект.",
                ("law", "п. 16 ст. 110 127-ФЗ: в случае отказа или уклонения победителя от подписания договора в течение пяти дней с даты получения предложения заключить договор внесённый задаток ему не возвращается.")]),
            ("Короткий чек-лист перед переводом", [
                "Лучше обнаружить проблему до платежа, чем выяснять её после определения победителя. Перед переводом убедитесь, что:",
                ("checklist", ["номер процедуры и лота совпадает с действующим сообщением;", "получатель и банковские реквизиты сверены с первоисточником, а не с перепиской;",
                               "сумма и крайний срок поступления средств зафиксированы;", "условия возврата прочитаны в положении о продаже;",
                               "есть средства на полную оплату имущества, если вы победите;", "банковское подтверждение платежа сохранено."])]),
        ],
        "cta_title": "Прежде чем переводить деньги — проверьте лот",
        "cta_text": "Сформируйте бесплатную карту проверки ТоргАтлас и сверьте задаток, сроки и условия по документам вашей процедуры.",
        "sources": [
            ("Статья 110 127-ФЗ «О несостоятельности (банкротстве)» (КонсультантПлюс)", ART110),
            ("Статья 110 127-ФЗ, текст с изменениями (Гарант)", GARANT110),
            ("Статья 139 127-ФЗ: продажа имущества должника (п. 3 отсылает к ст. 110)", ART139),
            ("ЕФРСБ: сообщение о проведении торгов", EFRSB)],
        "verified": f"Положения пунктов 12, 15 и 16 статьи 110 и пункта 3 статьи 139 сверены {VERIFIED_ON} с текстом Федерального закона от 26.10.2002 № 127-ФЗ (Гарант, с изменениями и дополнениями). Условия вашей процедуры (размер задатка, срок, реквизиты) могут отличаться и определяются сообщением о торгах и положением о продаже.",
        "related": ["kak-uchastvovat-v-torgah-po-bankrotstvu", "publichnoe-predlozhenie-bankrotstvo", "kak-proverit-lot-pered-torgami"],
    },
]

RELATED_TITLES = {
    "kak-uchastvovat-v-torgah-po-bankrotstvu": ("Инструкция", "Как участвовать в торгах по банкротству"),
    "publichnoe-predlozhenie-bankrotstvo": ("Разбор", "Публичное предложение: как купить при снижении цены"),
    "zadatok-na-torgah-po-bankrotstvu": ("Разбор", "Задаток: как внести, вернуть и не потерять"),
    "kak-proverit-lot-pered-torgami": ("Основы проверки", "Как проверить лот перед торгами"),
}
# Static cards of /blog/ (all six): rubric, H2, a meaningful teaser and one obvious link.
CARDS = [
    ("kak-uchastvovat-v-torgah-po-bankrotstvu", "Инструкция · первое участие", "Как участвовать в торгах по банкротству",
     "Пять шагов от поиска публикации до протокола и договора: что проверить до задатка и как заранее определить свой предел цены."),
    ("publichnoe-predlozhenie-bankrotstvo", "Разбор · снижение цены", "Публичное предложение: как купить при снижении цены",
     "Как устроен график снижения, кто получает право купить при одной, разных и равных заявках и когда ожидание невыгодно."),
    ("zadatok-na-torgah-po-bankrotstvu", "Разбор · деньги до заявки", "Задаток на торгах по банкротству",
     "Как проверить реквизиты и сроки, когда задаток возвращают и в каком случае победитель его теряет."),
    ("kak-proverit-lot-pered-torgami", "Основы проверки", "Как проверить лот перед торгами по банкротству",
     "Пошаговый чек-лист: предмет продажи, документы, ограничения, задаток и полная стоимость."),
    ("kak-proverit-avtomobil-s-torgov", "Автомобили", "Как проверить автомобиль перед покупкой на торгах",
     "VIN, юридическая история, фактическое состояние, ремонт и допустимая цена участия."),
    ("kak-proverit-zemelnyi-uchastok-s-torgov", "Земельные участки", "Как проверить земельный участок перед торгами",
     "Кадастровый номер, ВРИ, границы, доступ, ограничения и расходы после покупки."),
]


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def words(text: str) -> int:
    return len(re.findall(r"[\w\-]+", text, flags=re.UNICODE))


def render_block(block) -> str:
    if isinstance(block, str):
        return f"<p>{esc(block)}</p>"
    kind = block[0]
    if kind == "law":
        return f'<aside class="callout callout--law"><p class="callout-title">Что говорит закон <span>· проверено {VERIFIED_ON}</span></p><p>{esc(block[1])}</p></aside>'
    if kind == "callout":
        return f'<aside class="callout"><p class="callout-title">{esc(block[1])}</p><p>{esc(block[2])}</p></aside>'
    if kind == "steps":
        return '<ol class="steps">' + "".join(f"<li>{esc(i)}</li>" for i in block[1]) + "</ol>"
    if kind == "checklist":
        return '<ul class="checklist">' + "".join(f"<li>{esc(i)}</li>" for i in block[1]) + "</ul>"
    if kind in ("example", "schedule"):
        rows = "".join(f'<tr><th scope="row">{esc(a)}</th><td>{esc(b)}</td></tr>' for a, b in block[2])
        return f'<figure class="example"><figcaption>{esc(block[1])}</figcaption><table><tbody>{rows}</tbody></table><p class="example-note">{esc(block[3])}</p></figure>'
    raise ValueError(kind)


def body_words(article: dict) -> int:
    total = words(article["answer"])
    for _title, blocks in article["sections"]:
        for b in blocks:
            if isinstance(b, str):
                total += words(b)
            elif b[0] in ("law", "callout"):
                total += words(b[-1])
            elif b[0] in ("steps", "checklist"):
                total += sum(words(i) for i in b[1])
    return total


RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]


def ru_date(iso: str) -> str:
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} {RU_MONTHS[m - 1]} {y}"


def footer() -> str:
    extra = "".join(f'<a href="{h}">{t}</a> ' for h, t in site_nav.FOOTER_EXTRA)
    return f'<footer class="site-footer"><div class="wrap">ТоргАтлас · Работа по всей России · <a href="/">На главную</a> {extra}<a href="/privacy/">Конфиденциальность</a></div></footer>'


def render(article: dict) -> str:
    slug = article["slug"]
    url = f"{SITE}/blog/{slug}/"
    answer_words = words(article["answer"])
    if not 40 <= answer_words <= 80:
        raise ValueError(f"{slug}: direct answer has {answer_words} words (need 40-80)")
    minutes = max(2, round(body_words(article) / 170))
    blogposting = {
        "@context": "https://schema.org", "@type": "BlogPosting", "headline": article["h1"], "description": article["description"], "url": url,
        "inLanguage": "ru-RU", "author": {"@type": "Organization", "name": "ТоргАтлас", "url": f"{SITE}/", "logo": f"{SITE}/assets/og-card.png"},
        "publisher": {"@type": "Organization", "name": "ТоргАтлас", "url": f"{SITE}/", "logo": f"{SITE}/assets/og-card.png"},
        "mainEntityOfPage": url, "datePublished": PUBLISHED, "dateModified": MODIFIED, "image": f"{SITE}/assets/torgatlas-social.png"}
    breadcrumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Главная", "item": f"{SITE}/"},
        {"@type": "ListItem", "position": 2, "name": "Материалы", "item": f"{SITE}/blog/"},
        {"@type": "ListItem", "position": 3, "name": article["crumb"], "item": url}]}
    dump = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    sections = "".join(f'<section class="post-section"><h2>{esc(title)}</h2>' + "".join(render_block(b) for b in blocks) + "</section>"
                       for title, blocks in article["sections"])
    sources = "<ul>" + "".join(f'<li><a href="{esc(u)}" rel="noopener" target="_blank">{esc(t)}</a></li>' for t, u in article["sources"]) + "</ul>"
    related = "".join(f'<a class="related-card" href="/blog/{s}/"><span>{esc(RELATED_TITLES[s][0])}</span><strong>{esc(RELATED_TITLES[s][1])}</strong></a>' for s in article["related"])
    return (
        '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{esc(article["title"])}</title><meta name="description" content="{esc(article["description"])}">'
        '<meta name="robots" content="index,follow,max-image-preview:large">'
        f'<link rel="canonical" href="{url}"><link rel="icon" type="image/x-icon" href="/favicon.ico"><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">'
        f'<link rel="stylesheet" href="{asset("/assets/seo.css")}"><meta property="og:type" content="article"><meta property="og:locale" content="ru_RU">'
        f'<meta property="og:title" content="{esc(article["title"])}"><meta property="og:description" content="{esc(article["description"])}"><meta property="og:url" content="{url}">'
        '<meta property="og:image" content="https://torgatlas.ru/assets/torgatlas-social.png"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
        '<meta property="og:image:alt" content="ТоргАтлас — Все имущественные торги России">'
        f'<script type="application/ld+json">{dump(blogposting)}</script><script type="application/ld+json">{dump(breadcrumbs)}</script></head><body>'
        f'<header class="site-header"><div class="wrap header-inner"><a class="brand" href="/">ТоргАтлас<small>Все имущественные торги России</small></a>{site_nav.inner_nav("/blog/" + slug + "/")}</div></header>'
        '<main id="main" class="post"><div class="intro post-hero"><div class="wrap">'
        f'<nav class="crumbs" aria-label="Навигационная цепочка"><a href="/">Главная</a> / <a href="/blog/">Материалы</a> / {esc(article["crumb"])}</nav>'
        f'<div class="eyebrow">{esc(article["rubric"])}</div><h1>{esc(article["h1"])}</h1>'
        f'<p class="post-meta">Обновлено {ru_date(MODIFIED)} · около {minutes} мин чтения</p></div></div>'
        f'<section class="post-bodywrap"><div class="wrap"><article class="article-copy post-body"><p class="post-lede" id="answer">{esc(article["answer"])}</p>{sections}'
        f'<section class="post-sources"><h2>Источники и проверка</h2><p>{esc(article["verified"])}</p>{sources}</section>'
        '<p class="statement">Материал носит информационный характер и не заменяет индивидуальную юридическую, техническую или финансовую проверку конкретного имущества; результат торгов и экономический эффект не гарантируются.</p></article></div></section>'
        f'<aside class="post-cta" aria-labelledby="cta-title"><div class="wrap"><h2 id="cta-title">{esc(article["cta_title"])}</h2><p>{esc(article["cta_text"])}</p>'
        '<div class="ctas"><a class="btn" href="/ai-poisk-lotov/" data-track="article_ai_search_cta_click">Найти лот в AI-поиске</a>'
        '<a class="btn outline" href="/proverka-lota/#lot-check-form" data-track="article_lot_check_cta_click">Бесплатная карта проверки</a></div>'
        '<p class="post-cta-more">Нужна помощь специалиста? <a href="/formaty-raboty/">Посмотрите форматы работы</a>.</p></div></aside>'
        f'<section class="post-related"><div class="wrap"><h2>Читайте также</h2><div class="related-grid">{related}</div></div></section>'
        f'</main>{footer()}'
        f'<script src="{asset("/assets/analytics.js")}" defer></script><script src="{asset("/assets/funnel-events.js")}" defer></script></body></html>\n'
    )


def render_cards() -> str:
    out = []
    for slug, rubric, title, teaser in CARDS:
        out.append(f'<article class="guide-card" id="card-{slug}"><div class="guide-category">{esc(rubric)}</div><h2>{esc(title)}</h2><p>{esc(teaser)}</p>'
                   f'<a class="card-read" href="/blog/{slug}/" data-track="blog_card_read_click">Читать статью →</a></article>')
    return "<!-- cards:start -->" + "".join(out) + "<!-- cards:end -->"


def patched_blog_index() -> str:
    path = ROOT / "blog/index.html"
    text = path.read_text(encoding="utf-8")
    if "<!-- cards:start -->" in text:
        return re.sub(r"<!-- cards:start -->.*?<!-- cards:end -->", lambda _m: render_cards(), text, count=1, flags=re.S)
    return re.sub(r'(<div class="guide-grid">).*?(</div><div class="statement">)', lambda m: m.group(1) + "\n" + render_cards() + "\n" + m.group(2), text, count=1, flags=re.S)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = {ROOT / "blog" / a["slug"] / "index.html": render(a) for a in ARTICLES}
    outputs[ROOT / "blog/index.html"] = patched_blog_index()
    bad = []
    for path, content in outputs.items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                bad.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    if bad:
        print("generator output differs:", ", ".join(bad), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
