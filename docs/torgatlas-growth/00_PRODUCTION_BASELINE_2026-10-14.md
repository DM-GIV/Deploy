# TORGATLAS-SEO-GEO-GROWTH-001 — production baseline

Дата наблюдения: 2026-10-14, часовой пояс отчёта — Europe/Moscow. Production release, переданный владельцем и совпавший с начальным HEAD: `9d2c3e48269ba56ed29ce401d88ca9fe222fe818`.

## Что наблюдалось напрямую

- GSC property `sc-domain:torgatlas.ru` подключено с read-only scope, доступно для чтения.
- Live on-page audit GSC Wizard: 14/14 URL из `sitemap.xml` ответили `200`, indexable, с одним H1 и self-canonical; обход не был усечён.
- `http://torgatlas.ru/`, `http://www.torgatlas.ru/` и `https://www.torgatlas.ru/` дают ровно один `301` на `https://torgatlas.ru/`, затем `200`.
- Контрольный несуществующий URL `/this-url-must-not-exist-seo-audit-001` ответил настоящим `404`; soft-404 не наблюдался.
- Ответы 14 страниц были с `content-encoding: gzip`; время ответа в измерении — 53–377 мс. Это единичный лабораторный снимок, не SLA.
- Все 14 страниц имеют viewport, `lang=ru`, title, description и canonical. Дубли title/canonical в этом наборе не обнаружены.
- GSC Search Analytics за 2026-09-14—2026-10-11 (settled through 2026-10-11): 0 показов, 0 кликов, строк запросов и страниц нет. Нулевые данные не доказывают отсутствие индексации.
- Sitemap получен внешним инструментом, содержит 14 URL; ни один пока не получил показов в выбранном окне.
- Последние сохранённые URL Inspection: главная, `/blog/`, три опубликованные статьи и основные страницы услуг имеют `PASS / Submitted and indexed`; `/o-torgatlas/` на 2026-10-14 20:31 UTC — `URL is unknown to Google`; `/privacy/` в последнем снимке — `Discovered - currently not indexed`.
- HTML доступен crawler без обязательного JavaScript. Интерактивные карты используют progressive enhancement; индексируемый текст находится в исходном HTML.

## Недоступные или неполные наблюдения

- Firecrawl подключён, но crawl/map не выполнены: `Insufficient credits`; повторные платные вызовы не делались.
- Встроенный web fetch не смог открыть `torgatlas.ru`; прямой `curl` из sandbox упёрся в недоступный локальный proxy. Live-данные выше получены через официальный подключённый GSC Wizard crawler.
- Yandex Webmaster: `not_connected`. Wordstat/Wordstat API: NOT_CONNECTED. Яндекс Метрика не подключалась и не должна подключаться без решения о privacy.
- CrUX: `notConfigured`, API key отсутствует. Реальные полевые LCP/INP/CLS — UNKNOWN.
- Lighthouse mobile/desktop не запущен: Lighthouse binary отсутствует, а внешний PageSpeed API недоступен из разрешённого сетевого контура. Локальные performance budgets и browser checks не называются Lighthouse.
- ChatGPT consumer search, Perplexity, Gemini, Claude и Алиса AI как измерительные аккаунты/интерфейсы не подключены. GEO-упоминания — UNKNOWN до разрешённого прогона.
- Материалы «Обучение Асхат» и отдельные SEO/GEO домашние задания в данном репозитории не найдены. Из курса ничего не приписывается без источника.

## Интерпретация

Техническая доставка indexable HTML исправна. Главный текущий риск — не технический запрет индексации, а очень молодой домен/релиз без накопленных показов и без подключённого Яндекс-контура. `llms.txt` и Schema.org рассматриваются только как машиночитаемые подсказки, не как гарантия выдачи или упоминания в AI-ответах.

