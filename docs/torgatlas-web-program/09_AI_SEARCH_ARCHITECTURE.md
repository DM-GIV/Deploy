# TORGATLAS-AI-SEARCH-001 — Public Web Research Mini

## Граница продукта

Публичный поиск — выключенный по умолчанию маркетинговый инструмент. Он читает только разрешённые публичные интерфейсы без cookies, входа, документов и внешних AI-search API. Web Research V1/V2, TinyFish, OpenAI web search и Auction Analytics Cloud не являются зависимостями.

Поток: `/ai-poisk-lotov/` → `/api/ai-lot-search` → deterministic query parser → bounded source profile → normalization/deduplication → максимум 10 карточек. Обычный запрос использует 0 LLM calls и 0 tokens.

## Нормализованный лот

Общие поля: `source`, `source_lot_id`, `procedure_id`, `lot_number`, `title`, `category`, `region_code`, `price_rub`, `source_status`, `source_bidd_end_time`, `application_deadline`, `accepting_applications`, `url`, `etp_code`, `etp_url`, `checked_at`, `provenance`.

`biddEndTime` хранится только как `source_bidd_end_time`. `PUBLISHED` — статус записи источника, а не подтверждение открытого приёма. `application_deadline` и `accepting_applications=CONFIRMED` появляются только при одновременном наличии явного deadline и явного application status в detail payload; иначе `UNKNOWN`.

## GIS Mini

- Listing: `GET /new/api/public/lotcards/search?page=N&size=10&sort=firstVersionPublicationDate,desc`.
- Detail: `GET /new/api/public/lotcards/{lot_id}`.
- Не более 2 listing pages, 10 результатов и 12 HTTP requests; 4 s/request, 12 s total, 750 KB/response.
- Фильтрация категории и ПФО выполняется локально; серверные фильтры не выдумываются.
- `FIRST_PAGE_ONLY`, `PARTIAL_COVERAGE` и `PARTIAL_BUDGET` не означают отсутствие лотов во всём источнике.

## Security/release gate

URL строятся сервером, разрешён только HTTPS host `torgi.gov.ru` и два фиксированных path contract. Перед соединением DNS должен вернуть только публичные IP; выбранный проверенный IP передаётся непосредственно TLS request с исходным SNI. Redirect запрещён, размер/тип/таймаут ограничены. In-memory cache/rate/concurrency защищают отдельный процесс; до публичного включения необходим общий rate limit для фактической multi-instance topology.

Будущий профессиональный продукт сможет передавать только разрешённые к публикации и повторно проверенные по публичным источникам записи через отдельный read-only integration contract. Эта интеграция не входит в Wave 06 и не получает публичные пользовательские запросы.
