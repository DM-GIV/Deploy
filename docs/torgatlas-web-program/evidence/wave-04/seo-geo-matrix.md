# Wave 04 — SEO/GEO маршрутная матрица

Проверено локально по исходному HTML и canonical registry. `IMPLEMENTED` означает наличие в исходниках; фактическая индексация, показы и ответы AI — `UNKNOWN` до наблюдения в инструментах владельца.

| Маршруты | Intent и состояние | Техническая основа |
| --- | --- | --- |
| `/` | коммерческий вход: поиск, проверка, сопровождение | IMPLEMENTED: unique title/description/H1, canonical, robots, OG, `ProfessionalService` + `WebSite` |
| `/proverka-lota/` | проверка найденного лота | IMPLEMENTED: Service, BreadcrumbList, бесплатная карта, внутренняя перелинковка |
| `/poisk-imushchestva/` | подбор и критерии поиска | IMPLEMENTED: Service, BreadcrumbList, бесплатная карта, внутренняя перелинковка |
| `/soprovozhdenie-torgov/`, `/pokupka-imushchestva/` | сопровождение и покупка | IMPLEMENTED: Service, BreadcrumbList, границы услуги; без Offer/price |
| `/primery-lotov/`, `/formaty-raboty/` | доказательные примеры и сравнение форматов | IMPLEMENTED: CollectionPage/WebPage, BreadcrumbList, прямые CTA |
| `/o-torgatlas/` | брендовый/методический intent | IMPLEMENTED Wave 04: WebPage, BreadcrumbList, метод и ограничения |
| `/blog/` и 3 статьи | информационные вопросы по проверке лота, авто и земле | IMPLEMENTED: CollectionPage/BlogPosting, canonical, OG, связанные материалы |
| `/privacy/`, `/privacy/consent/` | юридическая навигация | IMPLEMENTED: canonical/indexable по registry; не используются как SEO-landing pages |

## Контент-кластеры и измерение

Реализованный кластер: проверка лота → статьи о базовом чек-листе, автомобиле и земельном участке → карты проверки/поиска и услуги. Предлагаемые, но не опубликованные без source-backed PAGE_SPEC: квартира/доля, задаток и сроки, публичное предложение, оборудование, предельная цена участия.

Для owner-observation подготовлены вопросы без брендового наведения: «как проверить лот перед торгами по банкротству», «как оценить риски автомобиля с торгов», «как проверить земельный участок на аукционе», «как рассчитать предельную цену участия», «кто сопровождает торги по банкротству». Снимать можно только дату, язык/регион, инструмент, формулировку, цитируемые URL и факт упоминания; не присваивать этому рейтинг.

## Отдельный ALTCHA plan

Одноразовый локальный прогон: поднять test-only TLS lead-intake backend на loopback, задать отдельный временный SQLite path, подать только synthetic TEST_ONLY fixture, проверить challenge/pass/reject/replay и после завершения удалить временную БД. Ни production URL, ни секреты, ни реальные контакты не используются. Требуется доступный browser adapter для существующего E2E harness.
