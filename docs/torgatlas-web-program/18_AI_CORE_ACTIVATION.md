# Активация Core-поиска в production (TORGATLAS-AI-CORE-PRODUCTION-ACTIVATE-004) — 2026-10-15

## Итог: CORE_LIVE (подтверждён фактическим поиском на https://torgatlas.ru, 14/14 реальных проверок)
`GET /api/ai-lot-search` → `{"mode":"CORE_SEARCH","max_results":5,"captcha":{"required":true}}`. Политика `AI_LOT_REQUIRE_CORE=true`: скрытого возврата к `PUBLIC_WEB_RESEARCH_MINI` нет.

## Что развёрнуто (и только это)
| Объект | Факт |
|---|---|
| Контейнер `torgatlas-ai-core-search` | образ `auction-data004:torgatlas-public-search-c13524f` (id `a3670a15…`), код Core-ветки `feature/torgatlas-core-public-search` @ `c13524f`; 256 МиБ, 0,5 CPU, pids 64, read-only rootfs, cap_drop ALL, порты не публикуются; сети: `aa-data004_default` и `torgatlas-ai_ta_ai_internal` (существующие, не изменены) |
| Роль БД `torgatlas_public_search` | LOGIN, не superuser/createdb/createrole/replication, connection limit 4, `default_transaction_read_only=on`, `statement_timeout=5s`, `idle_in_transaction_session_timeout=10s`; SELECT только на `lots`, `auctions`, `lot_source_records`, `price_periods` |
| Секреты | пароль роли и сервисный токен сгенерированы (`openssl rand -hex`), лежат в `/home/deploy/torgatlas-ops/core-ps-secrets/` (0600, каталог 0700); в Core хранится только SHA-256 токена (`core-public-search.env`, 0600); токен также в `ai-search.env` (0600). Значения нигде не выводились |
| `ai-search` | пересоздан один раз, новый образ `torgatlas-ai-search:local` (сайт-код `d25551c`), env: `AI_LOT_CORE_URL`, `AI_LOT_CORE_TOKEN`, `AI_LOT_REQUIRE_CORE=true`; ALTCHA/Origin/лимиты прежние |
| Статика | релиз `d25551cec6a09ef4658e04650dee95b16773cadc` (через `publish-release.sh`) |
Не затронуто: `aa-data004-api-1` (образ `auc163-fc6dbce`, StartedAt 2026-10-14T22:24:14Z, restarts 0), Compose Core (не запускался), PostgreSQL-схема и данные (создана только роль), nginx, DNS, общие секреты, соседние сервисы, парсеры/ingestion.

## Проверки до переключения (preflight и реальный Core)
- `ops.sh preflight`: fails=0. Роль: SELECT на 4 таблицы разрешён; UPDATE/DELETE/INSERT/TRUNCATE/DROP/ALTER/CREATE — отказ (read-only транзакция; даже при отключении read-only на уровне сессии — `permission denied`); чтение `assets`, `users`, `documents`, `lot_participants`, `entities`, `jobs`, `source_snapshots`, `pg_read_file`, `COPY … PROGRAM` — отказ (`evidence/wave-11/db-role-privileges.log`).
- Контейнер: `/health` 200; `/docs`, `/openapi.json`, `/admin`, `/api/v1/lots` → 404; без токена и с неверным токеном 401; GET → 405; портов наружу нет.
- Четыре запроса на реальном Core (`core-container-four-queries.log`): Москва — только «Москва» (5/5, квартиры); прицепы ПФО — 4/4 прицепа, Оренбургская область; легковые — 5, без снегохода и мотоциклов; квартиры ЮФО на публичном предложении — 5/5 только ЮФО и только «Публичное предложение».
- Нагрузка (`performance-and-limits.log`): узкие p50 33 мс / p95 81 мс; широкие p50 1,9 с / p95 2,6 с; одновременные 6 широких → 2 обслужены, 4 отклонены 503 (лимит 2); `/health` общего Core API без деградации (медиана 4 мс); пик CPU PostgreSQL 104% (на тот момент другой владелец выполнял тяжёлые запросы к `source_snapshots`), память Core API 106 МиБ, контейнера поиска 56 МиБ.
- Предпроверка нового демона отдельным preview-контейнером на реальном Core до переключения: 15/15.

## Проверки после переключения (публичный домен, реальный браузер)
`live-public-core-e2e.log` 14/14: Москва (5 квартир, регион только «Москва»); прицепы ПФО (4, Оренбургская область); легковые — через Enter (5, без снегоходов); квартиры ЮФО на публичном предложении (5, без аукционов и чужих регионов); повторные поиски без перезагрузки, каждый POST с новым ALTCHA-токеном, все 200; мобильный Android-UA 412 px (касания, без горизонтальной прокрутки, CTA «Скоро»); в карточках категория, процедура, цена со смыслом, срок, дата проверки, статус и ссылка вида `https://fedresurs.ru/biddings/<guid>`; аналитики до согласия нет.
Fail-closed (`live-failclosed.log`): при остановленном контейнере Core реальный поиск → HTTP 503, «Поиск временно недоступен. Мы не подставляем неточные результаты…», 0 карточек, текст запроса сохранён, кнопка доступна. Контейнер запущен обратно, healthy через ≈40 с. Примечание: `GET mode` отражает конфигурацию (Core подключён), а не живое состояние Core.
Прочее после переключения: сайт-smoke 32/32; хеши `/`, `/privacy/`, `/api/lead-config`, `/ta/s.js`, default-vhost идентичны baseline до (`baseline-before.txt` / `baseline-after.txt`); ALTCHA форм заявок 200; healthcheck rc=0.

## Правдивость статуса и provenance
- «Подтверждённо актуален» — только если каталог проверял лот ≤3 суток назад (`CONFIRM_DAYS=3`) и срок в будущем. Сейчас у всех отобранных лотов проверка 01–04.10 → карточка говорит: «Срок по данным каталога не истёк, но данные давно не перепроверялись: актуальность не подтверждена. Проверьте статус в первоисточнике». Будущий срок сам по себе открытость не доказывает.
- Четыре прицепа ПФО — разные лоты (идентификаторы источника `…:4`, `:7`, `:9`, `:11`; названия «Лот №4/7/9/11») ОДНОЙ публикации ЕФРСБ с одной ссылкой; карточки помечены: «Ссылка ведёт на общую публикацию… Это один источник, а не несколько независимых».
- Провенанс: хост первоисточника, дата последней проверки каталога, ссылка на публикацию; документы, фото, участники, ИНН, внутренние id наружу не передаются; названия проходят скрытие ПДн. Решение владельца по ЕФРСБ/ГИС Торги записано в `13_AI_LEGAL_CHECKLIST.md` (не юридическое заключение; юридическая проверка оферт остаётся открытой).
- Дефект классификатора Core: лот **21352** «Снегоход РЫСЬ-500+» имеет `asset_subtype=PASSENGER_CAR` (раньше ошибочно указывался 51825 — это седан ГАЗ-3102 с «цветом кузова: буран»). Защита в поисковом сервисе работает (скрывает и ещё 8 открытых лотов «легковых» с мотоциклами/скутером в названии, в т. ч. 2 смешанных лота). Исправление классификатора — отдельная задача владельцу Core; production Core не менялся.

## Откат (готов)
Папка `/home/deploy/torgatlas-ops/rollback-core-activate-latest/` (копия `ai-search.env`, id образа, прежний релиз статики), образ `torgatlas-ai-search:pre-core-activate`.
1. Мгновенно «без Core, но без старого движка»: остановить только `torgatlas-ai-core-search` (`services/core-public-search/ops.sh down`) — поиск честно «временно недоступен».
2. Полный возврат демона: `cp rollback-core-activate-latest/ai-search.env /home/deploy/torgatlas-ops/ai-search.env; docker tag torgatlas-ai-search:pre-core-activate torgatlas-ai-search:local; AI_SEARCH_ENV_FILE=/home/deploy/torgatlas-ops/ai-search.env docker compose -p torgatlas-ai -f services/ai-search/compose.yml up -d --force-recreate --no-deps ai-search` (вернётся прежний старый режим — только по явному решению).
3. Статика: `scripts/publish-release.sh e25c7ce3b7c0fddd38419e901378fc6112f13a7e`.
4. Роль: `DROP OWNED BY torgatlas_public_search; DROP ROLE torgatlas_public_search;` (Core DB owner).
Аварийное отключение всего AI-поиска: `services/ai-search/ops/ai-beta.sh disable` (сохраняет ALTCHA и Core-переменные).

## Зарегистрированные следующие задачи (запуск не блокируют)
1. **Оптимизация индексов для широких запросов** (ops-пакет): частичный индекс по `lots((catalogue_data->>'asset_subtype'), id) WHERE canonical_status='APPLICATION_OPEN'` и/или по `auctions(application_end)`; сегодня широкие запросы p50 1,9 / p95 2,6 с.
2. **Причина отсутствия новых записей ingestion после 12.10.2026**: на 15.10 до переключения последний `lots.updated_at` = 12.10 12:19Z; при пост-проверке появилась запись `lots` 15.10 13:16Z и `lot_source_records.last_seen_at` 15.10 01:14Z, параллельно другой владелец гонял тяжёлые запросы к `source_snapshots` — возобновление нестабильно/нужно выяснить у владельца ingestion (worker `auction-worker` Up 2 weeks).
3. Исправление классификатора Core (лот 21352, при необходимости смешанные лоты с мотоциклами).
4. Мониторинг: добавить `torgatlas-ai-core-search` в `ai-healthcheck.sh` (статус без автоотключения) и отражать живое состояние Core в `GET mode`; ротация секретов Core-поиска.
5. Свежесть: пока каталог не перепроверяется, все карточки «актуальность не подтверждена» (по дизайну).
