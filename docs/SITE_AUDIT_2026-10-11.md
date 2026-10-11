# Аудит и улучшения ТоргАтлас — 11.10.2026

## Внедрено в ветке audit-2026-10-11 (не опубликовано)
1. assets/analytics.js — Яндекс Метрика с баннером согласия, выключена (COUNTER_ID = 0). Вебвизор выключен, уважает GPC/DNT, события воронки уходят как цели (reachGoal) только по именам.
2. Подключён на 12 страницах перед funnel-events.js.
3. sitemap.xml — добавлен lastmod.
4. Главная — JSON-LD @graph: ProfessionalService + WebSite (связь через @id), sameAs Telegram.
5. BreadcrumbList на /primery-lotov/ и /formaty-raboty/ (раньше не было).
6. /privacy/ — раздел «Технические данные и аналитика» описывает подготовленную Метрику.

## Рекомендации на сервер (nginx), не в репозитории
gzip on; gzip_types text/css application/javascript image/svg+xml application/json;
Cache-Control: public, max-age=31536000, immutable для /assets/* (при версионировании имён), no-cache для HTML;
http2 on; ssl_stapling on; HSTS поднять с 300 до 31536000 примерно через неделю; для /favicon.ico и /robots.txt короткий кэш.

## Остаётся владельцу
- Создать счётчик в Метрике, передать номер → вписать в COUNTER_ID; в Метрике настроить цели по именам событий (lot_check_complete, search_brief_complete, lead_handoff_opened, funnel_contact_open).
- Вебмастер (Яндекс) и Search Console: подтвердить сайт, отправить sitemap.
- Фон первого экрана грузится с Unsplash (внешний хост): скачать и хостить на своём сервере (WebP/AVIF, ~60–100 КБ).
- Домен в canonical/sitemap/robots: применять scripts/switch-domain.mjs --to https://torgatlas.ru.