# TORGATLAS-AI-ENGINE-GATE-FIX-001 — evidence (2026-10-15)

Статус: **HOLD для production beta** (код и инфраструктура готовы и проверены в изолированном стенде; SECURITY/LEGAL флаги
НЕ включались; production release 078fa32 не менялся; AI-маршрут на torgatlas.ru по-прежнему 404).

## Что сделано
- **Engine gate** (`lib/torgatlas-public-web-research.mjs`): при `AI_LOT_EGRESS_GATE` движок отправляет `CONNECT hostname:443` шлюзу и сам
  проверяет TLS по исходному hostname. Сохранено: https-only, точный hostname из реестра, без портов/учётных данных/fragment, redirect = отказ,
  лимиты размера и времени. Усилено: gate-URL допускается только как односложное внутреннее имя (не IP, не FQDN, без credentials),
  `HTTPS_PROXY` в gate-режиме игнорируется, обхода и fallback на прямой выход нет, host вне реестра не доходит до шлюза.
  Исправлены дефекты Node 24: `createConnection` игнорируется при `agent:false` (теперь одноразовый Agent), `lookup(all:true)`, idle-таймер CONNECT-сокета.
- **Реестр** `config/ai-sources.registry.json` — единственный список хостов для движка и edge (`edge_enabled` + статус VERIFIED/LIVE). CANDIDATE,
  RESTRICTED, BLOCKED, wildcard и повреждённый реестр = нет доступа (fail closed). Семейство `all-torgi` (УТПЛ, УЭТП, Центр реализации) читает один парсер.
- **Edge** (`services/ai-search/edge.mjs`): CONNECT-шлюз (DNS на стороне шлюза, отказ при любом непубличном IP, подключение к проверенному IP,
  8 туннелей, 20 с жизни) и loopback-forwarder. `ai-search` — в `internal: true` сети, без маршрута наружу.
- **ГИС Торги TLS**: цепочка листа → Russian Trusted Sub CA (subca_ssl_rsa2024) → Russian Trusted Root CA проверена `openssl verify`; корень скачан с
  gu-st.ru (TLS валиден) и совпал с отпечатком из независимого отчёта SSL Labs. Доверие только для torgi.gov.ru (`ca` на запрос), пины SHA-256 в реестре,
  несовпадение пина = хост недоступен. `NODE_TLS_REJECT_UNAUTHORIZED`/`rejectUnauthorized=false` не используются. См. `config/trust/README.md`.
- **UI**: «Думаю…» держится 1,5 с (раньше сбрасывалось мгновенно), клиентский таймаут 24 с (было 58 с), список ссылок первоисточников расширен
  (УЭТП, Центр реализации — иначе карточки молча отбрасывались), BUSY/TIMEOUT больше не выдаётся за «лотов нет».
- **Таймауты согласованы**: общий дедлайн движка 20 с < UI abort 24 с < nginx `proxy_read_timeout` 25 с. Выбрано ограничение по дедлайну, а не job/polling:
  поиск короткий (измерено 1,8–6,6 с), каждый ответ гарантированно определён (`TIME_BUDGET_EXHAUSTED`), состояния на сервере нет.
- **nginx include**: JSON вместо сырых 429/502/503/504/403/413, `no-store`, security headers, `Cookie ""`, GET статуса не расходует лимит
  (POST 2/мин/IP + burst 2, 1 соединение на IP, 4 глобально).

## Результаты (все запуски 2026-10-15)
| Проверка | Результат |
|---|---|
| Node 24 (digest `sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f`, v24.22.0), изолированный контейнер без сети | 73/73 PASS |
| Python: site_static, final_release_contract, release_build, growth_program, umami_static | PASS (3+5+1+8+6) |
| accessibility-static-test (`a:focus-visible` в CSS) | 1 FAIL — **уже есть на 078fa32** (CSS не менялся: 0 файлов diff) |
| Изоляция: прямой выход из `ai-search` | заблокирован (`EAI_AGAIN`, `ENETUNREACH`) |
| Шлюз: example.com, torgi.gov.ru:80, 127.0.0.1, 169.254.169.254, CANDIDATE-хост | все 403 |
| Browser E2E (Chromium 1243, 1440/390/320) | 10/10 PASS, `browser-e2e-results.json` |
| Живые лоты через runtime-шлюз | 26 уникальных LIVE_VERIFIED (УТПЛ 15, Центр реализации 7, УЭТП 4) + 3 ГИС найдены, но НЕ подтверждены, `live-lots-runtime.json` |
| Нагрузка: 8 параллельных холодных поисков | 2 выполнены, 6 BUSY (лимит 2), память 29 МБ из 192, без рестартов/OOM |
| Отказ шлюза | чистый TIMEOUT за 4 с, без прямого обхода, самовосстановление после старта |
| nginx (одноразовый контейнер, реальный include) | `nginx -t` OK; 3 POST проходят, далее JSON 429 + Retry-After; upstream недоступен → JSON 503; тело >2 КБ → JSON 413 |
| staged `nginx -t` по реальной конфигурации proxy | OK, diff в `locations.inc` — одна строка |

Прежние «7 лотов» заменены: подтверждено заново через новый runtime, а не по старому исследованию.

## Точный инфраструктурный diff (применяется только скриптом `services/ai-search/ops/ai-beta.sh deploy`)
- `/home/deploy/torgatlas-ops/nginx/torgatlas.d/torgatlas-locations.inc`: `+include /etc/nginx/torgatlas.d/torgatlas-ai.inc;` после lead-include.
- новые: `torgatlas-ai.inc`, `30-torgatlas-ai-zone.conf`.
- Docker-проект `torgatlas-ai`: `torgatlas-ai-search` (internal-сеть), `torgatlas-ai-edge` (127.0.0.1:18082). Другие сервисы, образы и сети не затрагиваются.

## План безопасного подключения beta (после финального review)
1. Документированный security review и legal-заключение владельцем; отдельное разрешение.
2. `ai-beta.sh stage` → `deploy` (флаги OFF; авто-откат при любой ошибке/EXIT) → проверить `GET /api/ai-lot-search` = `enabled:false`.
3. Владелец записывает флаги в `ops/ai-search.env`; `ai-beta.sh enable` (откажется, если SECURITY/LEGAL не true).
4. Смоук 3 запроса, наблюдение 24 ч (CPU/RAM, доля BUSY/TIMEOUT, ошибки источников).
5. **Быстрое отключение**: `ai-beta.sh disable` (флаги false, ~5 с, nginx не трогается; UI сам скрывает поиск); полный откат `ai-beta.sh rollback <dir>`; кодовый — `git revert`.

## Оставшиеся препятствия
SECURITY/LEGAL review и отдельное решение владельца; ЕФРСБ и Алфалот — RESTRICTED (401/403/429, обход не пытался); ГИС даёт только
предварительные данные (срок приёма заявок не подтверждён); 12 кандидатов без разобранных каталогов; `limit_conn` отдельно не изолирован в тесте;
при обрыве клиента поиск на сервере доходит до своего дедлайна (≤20 с); сообщение UI на 429 общее; разрешение на pull/сборку образа на production-хосте.
