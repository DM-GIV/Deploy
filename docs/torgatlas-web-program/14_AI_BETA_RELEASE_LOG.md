# AI Web Search — журнал релиза ограниченной публичной beta (2026-10-15)

| Время (UTC) | Действие | Результат |
|---|---|---|
| 07:0x | Решение владельца записано в 13_AI_LEGAL_CHECKLIST.md (7a4b67b) | не юридическое заключение |
| 07:08 | Статический релиз `releases/7a4b67b…`, symlink `www/current` (было `078fa32…`) | 3 файла отличаются; корень был 0700 ⇒ ~4 мин HTTP 403 до `chmod 755` (инцидент, исправлен, билдер починен в 775b250) |
| 07:09 | `ai-beta.sh route` (staged nginx -t, reload) | OK; rollback-каталог `/home/deploy/torgatlas-ops/rollback-ai-20261015T070944Z` |
| 07:1x | Production-route security checks (12_AI_SECURITY_REVIEW.md §3b) | REVIEW_RESULT: PASS |
| 07:16 | `ai-beta.sh enable` | enabled:true, 3 источника |
| 07:17–07:22 | Публичный smoke 1440+390 | 43 PASS / 0 FAIL (evidence/wave-08/public-smoke-live-7a4b67b.log) |
| 07:22 | Проверка kill switch на production: disable → enable | OK, главная 200 всё время |
| 07:23 | cron healthcheck каждые 5 мин (`ai-healthcheck.sh --guard`) | установлен; журнал `/home/deploy/torgatlas-ops/ai-health.log` |

## Аварийные команды (запускать как пользователь deploy)
- Мгновенное отключение поиска (~11 с, nginx не трогается): `/home/deploy/torgatlas-site-master-20261014/services/ai-search/ops/ai-beta.sh disable`
- Убрать маршрут и остановить AI-контейнеры (сайт остаётся): `.../ai-beta.sh rollback` (использует `rollback-ai-latest`)
- Вернуть прежний статический релиз: `cd /home/deploy/torgatlas-ops/www && ln -sfn releases/078fa32dd66649ca262d80dac4877c5fb41d874f current.new && mv -T current.new current`
- Выключить автопроверку: `crontab -e` и удалить строку с `ai-healthcheck.sh`
- Состояние: `.../ai-beta.sh status`; `.../ai-beta.sh verify`; `tail /home/deploy/torgatlas-ops/ai-health.log`
- Откат кода: `git revert <sha>` в репозитории.

## Не выполнено / ограничения
- Контрольный нагрузочный тест после запуска на production не повторялся (источники — живые площадки); использован нагрузочный прогон финального кода в изолированном контуре и 6-запросный burst на публичном маршруте.
- Юридическая проверка оферт площадок не проводилась; ПДн скрываются эвристически.
- Наблюдение 24 ч выполняет cron-проверка; результаты смотреть в ai-health.log.

## Post-release hardening (2026-10-15, HARDENING-001)
| Что | Результат |
|---|---|
| Публикация `c4538af` через новый `scripts/publish-release.sh` | baseline 200 (local+external) → preflight от пользователя nginx в реальном контейнере → атомарная смена → проверка хешей; 0 × 403 (evidence/wave-08/publish-release-c4538af.log) |
| Негативные тесты скрипта | корень 0700 → отказ до смены (rc 11); подкаталог 0700 → отказ (rc 11); релиз без страницы → после смены ~3 с 403 на одной странице `/primery-lotov/`, автоматический откат, 200 восстановлены (rc 12) |
| Копирайт AI-страницы | ГИС Торги убрана из активных источников; источники = реестр = API (УТПЛ, УЭТП, Центр реализации); абзац об AI-поиске в `/privacy/`; тест согласованности |
| Healthcheck | grace 150 с, подтверждение сбоя 2 перепроверками, сбои сайта не отключают AI; 3 подтверждённых подряд → `disable`. Реальный `docker restart` → `grace`, ложного отключения нет; лог 0600, без текстов запросов |
| «1 shell still running» | мой зависший `docker exec … tail /var/log/nginx/error.log` (лог — symlink на /dev/stderr, tail ждал вечно, 1 ч 14 мин, 0 CPU) + его дочерний `tail` в контейнере nginx; остановлены оба по PID. Чужие процессы (playwright других владельцев, relay, certbot, nginx reload-loop) не тронуты |
| Исправление review | «Origin не проверяется» было ошибкой; демон требует `Origin === https://torgatlas.ru` (403 ORIGIN_DENIED для чужого, `null`, пустого) |
| Smoke (SMOKE_LITE=1) | 40 PASS / 0 FAIL, 1440+390; 3 реальных запроса; сверка 2 лотов с площадкой: цена, срок 11.11.2026 18:00, статус «Прием заявок» совпали; ПДн в полном JSON (5 лотов): 0 совпадений |
| Kill switch без простоя | disable→enable: 60 из 60 проб главной = 200 |
Откат релиза: `ln -sfn releases/7a4b67b0e3117e7ebdcc624fdbc13ad3d5b686cd current.new && mv -T current.new current` (в `/home/deploy/torgatlas-ops/www`) либо `scripts/publish-release.sh 7a4b67b0e3117e7ebdcc624fdbc13ad3d5b686cd` (с проверками).

## UX hotfix: USER_INPUT_DISABLED_ROOT_CAUSE (2026-10-15, релиз 0f8af5c)
**Причина:** опубликованный HTML отдавал `<textarea id="ai-query" … disabled>` и `<button id="ai-submit" disabled>`; `assets/ai-search.js` снимал блокировку только после успешного предварительного `GET /api/ai-lot-search` (`checkAvailability()` → `setSearchReady`). Любой сбой/задержка GET, блокировка или кэш старого скрипта (`max-age=86400`) оставляли форму мёртвой. Тесты раньше проверяли именно это поведение как «fail-closed» и программно ставили значение поля, поэтому дефект не ловился.
**Изменено:** `ai-poisk-lotov/index.html`, `assets/ai-search.js`, `privacy/index.html` (без изменений в этом хотфиксе, см. прошлый релиз), `tests/ai-search.test.mjs`, `scripts/ai-ux-smoke.mjs` (новый), evidence. Бэкенд, nginx, реестр, контейнеры не менялись.
**Что сделано:** поле и кнопка не блокируются; GET только информационный; Enter отправляет (Shift+Enter — перенос); защита от двойной отправки; отмена; сообщения для 429/403/400/413/5xx/сети/24-секундного таймаута/некорректного ответа, текст запроса сохраняется; `<noscript>` и резервный inline-сценарий при незагрузившемся скрипте; версия `?v=2` у JS/CSS (HTML — `no-cache`, поэтому старый кэш скрипта обходится); на странице нет названий площадок, числа источников и списка отключённых (утверждённая владельцем формулировка), `coverage_note` API не выводится — показывается нейтральная оговорка. В карточках остаются источник, дата проверки и прямая ссылка на первоисточник.
**Проверка на публичном домене:** `ai-ux-smoke-live-0f8af5c.log` — 29 PASS / 0 FAIL (реальные мышь/касание, клавиатура, вставка Ctrl+V, кнопка, Enter, 4 реальных поиска; сбои сети/GET/таймаут/JS — SIMULATED и помечены); `public-smoke-site-live-0f8af5c.log` — 32 PASS / 0 FAIL. Публикация через `scripts/publish-release.sh` (preflight от nginx-пользователя, эталон, проверка хешей): 0 × 403.
**Откат:** `scripts/publish-release.sh c4538af495f631c0043487d8af2b35e552cf0857` (или ручной symlink на этот релиз).
