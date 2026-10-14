# Dashboard и reporting-контур

`scripts/growth-report.py` принимает только экспортированные CSV и создаёт атомарный JSON-отчёт. Отсутствующие источники остаются пустыми. Контур не подключает Google Analytics, новые cookies и не меняет Umami.

Еженедельно:

- GSC: clicks, impressions, CTR, position, pages, queries, index inspections;
- Яндекс Вебмастер после подключения: pages in search/excluded, queries и позиции;
- Umami: consented visits и согласованные funnel events;
- leads: только агрегат принятых заявок; контактный клик не считается заявкой;
- GEO/AEO: реальные наблюдения по engine;
- editorial: READY/SKIP/BLOCKED, выпущенные URL, причина пропуска.

Ежемесячно: пересмотр clusters, каннибализации, страниц с показами без кликов, decay, редакционного backlog и доказанных конверсий. В каждом отчёте отдельные разделы `observed` и `hypotheses`.

