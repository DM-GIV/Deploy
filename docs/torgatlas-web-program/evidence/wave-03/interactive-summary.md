# Wave 03B — интерактивная browser-приёмка

Среда: локальный Chromium, отдельный local HTTP server, test-only строки и Playwright intercept. Внешние запросы, production, реальные контакты и заявки не использовались.

| Итог | Количество |
| --- | ---: |
| PASS | 11 |
| FAIL | 0 |
| BLOCKED | 2 |

PASS: мобильная keyboard-навигация, CTA, карты проверки и поиска (валидация, генерация, изменение, повторная генерация, копирование), AI disabled/success/empty/server/network states, consent accept/decline/persistence и отсутствие Umami до согласия.

BLOCKED: mobile menu open/close неприменим — на мобильном экране реализован всегда видимый список ссылок без toggle; ALTCHA challenge/pass/reject/replay требует отдельного TLS disposable lead-intake E2E, поэтому не имитировался. Полные машинные результаты: `interactive-matrix.json`.
