# AI-assisted editorial pipeline

## Обязательная последовательность

1. Выбор темы из плана.
2. Проверка подтверждённого спроса и intent; при отсутствии данных это явно фиксируется.
3. Исследование точных официальных первоисточников и сохранение URL/даты.
4. AI-черновик без выдуманных законов, цифр, кейсов, отзывов, рейтингов и дисконтов.
5. Редакционная и отдельная юридическая проверка фактических утверждений.
6. Проверка оригинальности и отсутствия дубля внутри сайта.
7. Metadata, авторство, BlogPosting/BreadcrumbList, canonical, внутренние ссылки на услуги и бесплатные карты.
8. Сборка и тесты.
9. Владелец явно одобряет именно финальный SHA-256 файла.
10. Только после этого scheduler может выбрать материал в открывшееся трёхдневное окно.

## Fail-closed contract

`content/editorial/queue.json` жёстко содержит `OWNER_APPROVED_ONLY`, `Europe/Moscow`, cadence 3 days. `scripts/editorial_scheduler.py` возвращает:

- `READY` — только для `OWNER_APPROVED`, всех восьми gates, approval evidence и совпавшего content hash;
- `SKIP/no_owner_approved_article` — штатный безопасный пропуск;
- `SKIP/cadence_window_not_open` — ещё не прошло три календарных дня;
- `BLOCKED` — очередь или approval повреждены.

Пример безопасной проверки:

```text
python3 scripts/editorial_scheduler.py --at 2026-10-18T09:00:00+03:00 --log /var/log/torgatlas/editorial.jsonl
```

`scripts/materialize-approved-article.py` по умолчанию dry-run. `--apply` только меняет Git-файлы: снимает `noindex`, добавляет URL в registry с правдивым `lastmod`, регенерирует sitemap и переводит item в `STAGED_FOR_RELEASE`. Он не commit/push/deploy и не отправляет URL поисковикам.

## Активация после отдельного решения

Timer/CI должен запускаться ежедневно, но решение принимает московская дата и `last_published_at`. После `STAGED_FOR_RELEASE` нужны: полный test suite, clean commit, `build-static-release.py`, проверка manifest, атомарный release directory + смена `www/current`, HTTP smoke и rollback на предыдущий symlink. Автоматическое production-развёртывание в этом пакете не активировано.

Ручное отключение: остановить timer/CI либо перевести очередь в maintenance вне production; изменение режима публикации с `OWNER_APPROVED_ONLY` валидатор запрещает.

