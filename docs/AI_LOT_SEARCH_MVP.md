# AI-поиск лотов: Public Web Research Mini (14.10.2026)

## Реализованный контур

`/ai-poisk-lotov/` → `/api/ai-lot-search` → детерминированный planner → единый безопасный HTTP/JSON/HTML transport → компактный профиль источника → нормализация и дедупликация → до 10 карточек.

Публичный поиск не вызывает OpenAI web_search, Web Research V1/V2, TinyFish, авторизованные профили или Auction Analytics Cloud. Обычный запрос расходует 0 LLM calls и 0 tokens. Документы, PDF/DOCX и закрытые API не загружаются.

## Источники

- ГИС Торги: ограниченный `lotcards/search` (до 2 страниц) и точная публичная карточка.
- ЕФРСБ: до 2 страниц `/backend/biddings`, detail по GUID и первая связанная bankruptcy-message; максимум 5 процедур.
- МЭТС: публичная серверная лента недавних событий и максимум 6 точных HTML-карточек. Полный каталог не заявлен.
- РАД/Lot-online: только будущая сверка точной карточки, уже обнаруженной в другом источнике. Принятое исследование не разрешает использовать каталог как discovery.

Все три активных профиля `MOCK_TESTED`; текущий egress не дал подтвердить live-доступ. `PUBLIC_SOURCE_VERIFIED=0`, актуальных live-лотов не подтверждено.

## Контракт

- `GET /api/ai-lot-search` возвращает `enabled`, `max_results`, mode и статусы профилей.
- `POST` принимает `{query, source: all|bankruptcy|government|commercial, limit: 5|10}`.
- Ответ содержит `lots`, `status`, `coverage`, `coverage_note`, `retrieved_at`, `cost`; каждое критичное поле лота имеет provenance или `UNKNOWN`.
- `biddEndTime` не считается сроком заявки; `PUBLISHED` не считается открытым приёмом. Частичный просмотр не считается доказательством отсутствия лотов во всём источнике.

## Защита и стоимость

URL полностью строятся на сервере. Разрешены только фиксированные HTTPS host/path contracts. Перед соединением проверяются все DNS/IP; private/local адреса и redirects запрещены. Ограничены тип и размер ответа, число страниц/запросов, общий срок, concurrency, cache TTL и число результатов.

Для Selectel подготовлен отдельный минимальный сервис `services/ai-search/`: loopback `127.0.0.1:18082`, read-only container, CPU/RAM/PID limits и nginx shared rate/connection zones. Он не развёрнут и по умолчанию отвечает fail-closed.

## Release gate

Функция остаётся OFF, пока одновременно не выполнены:

1. хотя бы один профиль не прошёл датированную live E2E-проверку в production egress;
2. nginx/service config не проверены на release host без доступа к Cloud/Core;
3. security и legal gates отдельно не приняты владельцем;
4. rate limit, timeout, cache, SOURCE_BLOCKED и rollback не проверены в фактической single-instance topology;
5. владелец отдельно не разрешил включение трёх флагов `AI_LOT_*`.

До этого страница остаётся `noindex,follow`, UI не отправляет query и предлагает прямые ссылки на первоисточники. Основной статический сайт может выпускаться независимо.
