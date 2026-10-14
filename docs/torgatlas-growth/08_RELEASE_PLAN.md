# Release plan — TORGATLAS-SEO-GEO-GROWTH-001

Статус: RELEASE_HOLD. Production не изменён.

## Manifest

- Observed production baseline supplied and matched at start: `9d2c3e48269ba56ed29ce401d88ca9fe222fe818`.
- Verified code candidate before evidence-only commit: `1f496351144fa6909c9a277e26f01c9eb1731f8e`.
- Static payload builder: `scripts/build-static-release.py`; проверенный candidate содержал 49 файлов и исключал docs/tests/services/api/content/ops.
- Затрагивается только публичный статический сайт. Lead intake, ALTCHA, Umami, privacy/consent и AI SEARCH OFF сохраняются. Auction Analytics Cloud и V1/V2 не интегрируются.
- Scheduler/timer templates не установлены и не включены.

## Предлагаемый порядок после отдельного разрешения

1. Подтвердить финальный release SHA и чистый worktree.
2. Сгенерировать fallback ротации на дату выпуска: `python3 scripts/generate-research-showcase.py --at YYYY-MM-DD`; закоммитить результат и повторить проверки.
3. Запустить Python 61/61, Node 48/48, static validator, sitemap check, performance budget и browser showcase audit.
4. Собрать новый уникальный каталог `www/releases/<sha>` через builder; проверить manifest и права файлов.
5. До смены symlink проверить доступное место, I/O и текущую цель `www/current`.
6. Атомарно переключить `www/current` на новый release по действующему site-owned runbook. Не выполнять Docker/restart/nginx change для статической смены без отдельной необходимости.
7. Проверить HTTPS, три redirect-варианта, 14 public URL, настоящий 404, robots/sitemap/llms, security/cache headers, assets, формы, consent/Umami и AI OFF.
8. Проверить главную на 1440/768/390: 8 карточек, 4/2/1 колонки, источники, отсутствие overflow.
9. Через GSC проверить live canonical/schema после crawl; не требовать немедленного ранжирования.

## STOP

- release SHA или manifest не совпадает;
- worktree грязный, изменён lead/Umami/privacy/AI gate;
- нет места, высокая I/O нагрузка или второй писатель;
- URL даёт 5xx/soft-404, redirect chain больше одного шага, canonical уходит с `torgatlas.ru`;
- owner не утвердил release, расписание и первый финальный content package;
- нет предыдущей цели symlink для rollback.

## Откат

- Runtime: атомарно вернуть `www/current` на записанную предыдущую release directory, затем повторить HTTP smoke.
- Git: `git revert <release-commit-sha>`; не применять reset/force.
- Editorial item: не удалять evidence; вернуть URL в `noindex`/исключить из registry только отдельным review-коммитом и регенерировать sitemap.

