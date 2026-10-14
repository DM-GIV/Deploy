# Технический defect register

| ID | Приоритет | Наблюдение | Решение / gate |
| --- | --- | --- | --- |
| SEO-001 | P1 | GSC on-page audit сообщил `Organization is missing required field logo` в Service и BlogPosting | Исправлено в Git: организация получает абсолютный `logo` и `url`; повторно проверить live после release |
| SEO-002 | P1 | `/o-torgatlas/` неизвестна Google по URL Inspection 2026-10-14 | Не дефект HTML: live `200`, canonical/indexable. Добавить в owner-approved indexing tracker или запросить индексирование вручную; наблюдать |
| SEO-003 | P1 | 0 impressions/clicks через 2026-10-11 | Baseline, не ошибка. Накопить минимум 4–8 недель и анализировать запросы/CTR без обещаний роста |
| SEO-004 | P2 | Description `/privacy/` — 183 символа, `/primery-lotov/` — 165 | Косметический риск сниппета; privacy не переписывать ради длины. Description примеров сократить при контентном обновлении |
| SEO-005 | P2 | `/blog/` 191 слово, `/o-torgatlas/` 299 слов | Автоматический low-severity сигнал, сам по себе не доказывает thin content. Расширять только полезными source-backed разделами |
| PERF-001 | P1 | CrUX API key не настроен | OWNER action; до подключения LCP/INP/CLS остаются UNKNOWN |
| PERF-002 | P1 | Lighthouse mobile/desktop в этой среде недоступен | Запустить в разрешённом CI/рабочем браузере; не подменять статическим budget |
| SEARCH-001 | P1 | Yandex Webmaster не подключён | OWNER action; подключить read-only официальный доступ |
| DEMAND-001 | P1 | Wordstat/Wordstat API и подтверждённые частотности отсутствуют | OWNER action; официальный export/API. До этого частотность не заполнять |
| GEO-001 | P1 | AI answer engines не подключены как измерительные поверхности | Выполнять утверждённый ручной/официальный аудит по фиксированной матрице; отмечать NOT_CONNECTED |
| CRAWL-001 | P2 | Firecrawl credits исчерпаны | Не блокирует Git-работу; пополнить только по решению владельца |

Не считаются дефектами: отсутствие JSON-LD на privacy/consent; отсутствие `hreflang` для одноязычного сайта; отсутствие изображений в текстовых статьях; контролируемый `404`; `noindex` у AI Search и редакционных черновиков.

