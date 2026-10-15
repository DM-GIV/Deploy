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
