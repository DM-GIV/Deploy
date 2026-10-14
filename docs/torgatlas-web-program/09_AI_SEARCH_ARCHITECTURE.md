# TORGATLAS-AI-SEARCH-001 — Public Web Research Mini

## Граница продукта

Публичный поиск — выключенный по умолчанию маркетинговый инструмент. Он читает только разрешённые публичные интерфейсы без cookies, входа, документов и внешних AI-search API. Web Research V1/V2, TinyFish, OpenAI web search и Auction Analytics Cloud не являются зависимостями.

Поток: `/ai-poisk-lotov/` → `/api/ai-lot-search` → deterministic query parser → bounded source profile → normalization/deduplication → максимум 10 карточек. Обычный запрос использует 0 LLM calls и 0 tokens.

## Нормализованный лот

Общие поля: `source`, `source_lot_id`, `procedure_id`, `lot_number`, `title`, `category`, `region_code`, `price_rub`, `source_status`, `source_bidd_end_time`, `application_deadline`, `accepting_applications`, `url`, `etp_code`, `etp_url`, `checked_at`, `provenance`.

`biddEndTime` хранится только как `source_bidd_end_time`. `PUBLISHED` — статус записи источника, а не подтверждение открытого приёма. ГИС получает `CONFIRMED` только при одновременном наличии явного deadline и `applicationStatus=APPLICATIONS_SUBMISSION` в detail payload. ЕФРСБ использует отдельный честный статус `CONFIRMED_BY_PUBLICATION_DATES`, когда текущее время находится внутри явного `application.start/end`; МЭТС — `CONFIRMED_BY_SOURCE_STATUS` только при явном видимом статусе приёма. Иначе значение `UNKNOWN`.

## GIS Mini

- Listing: `GET /new/api/public/lotcards/search?page=N&size=10&sort=firstVersionPublicationDate,desc`.
- Detail: `GET /new/api/public/lotcards/{lot_id}`.
- Не более 2 listing pages, 10 результатов и 12 HTTP requests; 4 s/request, 12 s total, 750 KB/response.
- Фильтрация категории и ПФО выполняется локально; серверные фильтры не выдумываются.
- `FIRST_PAGE_ONLY`, `PARTIAL_COVERAGE` и `PARTIAL_BUDGET` не означают отсутствие лотов во всём источнике.

## ЕФРСБ Mini

- Listing: `GET /backend/biddings?limit=5&offset=0|5`.
- Detail: `GET /backend/biddings/{guid}`; первая связанная публикация: `GET /backend/bankruptcy-messages/{guid}`.
- Не более 2 страниц и 5 процедур в одном запросе; документы и вложения не скачиваются.
- Реальные лоты создаются только из видимых lot-объектов detail/message. Результат всегда сообщает ограниченный охват последних записей.

## МЭТС Mini

- Discovery: публичная серверная HTML-лента `GET /`; detail: только точный `GET /{trade}-{lot}`.
- За один поиск открывается не более 6 карточек из недавней ленты. `/search`, `/catalog`, endpoints участия и документы не вызываются.
- Из видимых HTML/microdata извлекаются identity, название, регион, категория, цена, статус и текстовые даты. Даты без timezone не преобразуются в вымышленный UTC.

## Планировщик и РАД

Режим «Все» пока выбирает один профиль по намерению запроса в пределах бюджета и возвращает `planned_sources`/`unsearched_sources`; это не полный обход площадок. РАД/Lot-online не является discovery-профилем: принятое исследование допускает только точные карточки, уже найденные в другом источнике, и запрещает каталожную пагинацию. Он остаётся будущим каналом сверки, а не фиктивным поиском.

## Security/release gate

URL строятся сервером. Allowlist содержит только точные HTTPS-маршруты ГИС, ЕФРСБ и МЭТС; пользователь не может передать URL. Перед соединением DNS должен вернуть только публичные IP; выбранный проверенный IP передаётся TLS request с исходным SNI. Redirect запрещён, размер/тип/таймаут ограничены. In-memory cache/rate/concurrency защищают отдельный процесс; до публичного включения необходим общий rate limit для фактической multi-instance topology и проверка совместимости с обязательным production egress.

Будущий профессиональный продукт сможет передавать только разрешённые к публикации и повторно проверенные по публичным источникам записи через отдельный read-only integration contract. Эта интеграция не входит в Wave 06 и не получает публичные пользовательские запросы.
