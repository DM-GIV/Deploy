# AI Web Search — security review (технический, выполнен исполнителем)

Дата: 2026-10-15. Объект: git `2b7ae4a` (+ этот документ). Это инженерный review по результатам запусков, **не независимый аудит**.

REVIEW_RESULT: PENDING — не PASS, пока не выполнены пункты «Не проверено в production» (раздел 3).

## 1. Проверено (с доказательствами в evidence/wave-07 и 11_AI_ENGINE_GATE_EVIDENCE.md)
| Область | Мера | Доказательство |
|---|---|---|
| SSRF | Только https, точный hostname из реестра, запрет портов/credentials/fragment/query, фиксированные пути; URL строятся из ID, а не из ввода | ai-engine-gate.test (негативные кейсы), public-web-research.test |
| Private/metadata IP | Шлюз резолвит DNS и отказывает при любом непубличном адресе в ответе; подключение к проверенному IP | ai-edge.test; live: 127.0.0.1, 169.254.169.254 → 403 |
| DNS rebinding | Проверка всех A/AAAA и connect к уже проверенному IP в одном месте (шлюз) | ai-edge.test |
| Redirects | Любой 3xx → REDIRECT_DENIED | public-web-research.test |
| TLS / CA pinning | Проверка по исходному hostname; для torgi.gov.ru — только pinned Root+Sub CA (SHA-256), mismatch ⇒ хост выключен; TLS-проверка нигде не отключается | config/trust/README.md, ai-engine-gate.test, live GIS |
| Egress isolation | `ai-search` в internal-сети, прямой выход невозможен (EAI_AGAIN/ENETUNREACH); наружу только через edge-gate; HTTPS_PROXY игнорируется; host-proxy/Claude relay не используется | live в изолированном стенде |
| Allowlist | Реестр = единственный источник; CANDIDATE/RESTRICTED/BLOCKED/wildcard/битый реестр ⇒ нет доступа | ai-engine-gate.test, ai-edge.test |
| Ресурсы | ai-search 192 МБ/0.5 CPU/64 pids, edge 64 МБ/0.25 CPU/32 pids, read_only, cap_drop ALL, no-new-privileges; ≤2 одновременных поиска; 16 запросов/поиск; 750 КБ JSON/1,5 МБ HTML | compose.yml; нагрузка: 8 параллельных → 2 выполнены, 6 BUSY, 29 МБ |
| Rate limits | nginx: POST 2/мин/IP + burst 2, 1 соединение на IP, 4 глобально; поиск: кэш 5 мин, пейсинг по хосту (robots Crawl-delay) | тест в одноразовом nginx |
| Время | Дедлайн 20 с < UI abort 24 с < nginx 25 с | ai-engine-gate.test, E2E |
| Утечка ошибок | nginx отдаёт JSON-коды без внутренних деталей; UI не показывает сырые 5xx; движок возвращает только коды | E2E error-503/429/502 |
| Секреты | Секретов в контейнерах нет (env содержит три булевых флага); `Cookie` не пробрасывается; CA — публичные сертификаты | ревью compose/env.example |
| Логирование | Демон не пишет текст запросов (stdout: только старт); nginx access_log не включается этим include | server.mjs, edge.mjs |
| Отключение | Kill switch: все флаги false + пересоздание ai-search; полный откат: убрать include + reload + `compose down` | ops/ai-beta.sh |
| XSS/ссылки | UI строит DOM через textContent; ссылки только https и только из списка хостов (иначе карточка отбрасывается) | E2E partial-result-and-link-guard |

## 2. Выявлено и исправлено в ходе подготовки
Node 24: `createConnection` игнорируется при `agent:false` (туннель не работал); lookup(all); idle-таймер CONNECT; forwarder обрывал >3 с;
UI отбрасывал карточки новых площадок; «Думаю…» не отображалось; BUSY/TIMEOUT выдавались за «лотов нет»; GET расходовал лимит поиска;
**robots.txt**: m-ets.ru запрещает всё (`Disallow: /*`) ⇒ отключён; Crawl-delay УТПЛ 3 с и ГИС 60 с ⇒ пейсинг в движке.

## 3. Не проверено в production на момент написания (блокирует PASS)
- достижимость edge из реального контейнера `aa-data004-https-proxy` (host network ⇒ 127.0.0.1:18082) и закрытость порта на публичном адресе;
- staged `nginx -t` уже выполнялся для предыдущей версии include (OK) — повторить перед reload;
- неизменность остальных поверхностей (главная, lead, Umami, default-vhost) до/после reload;
- внешний браузерный smoke после включения.

## 4. Остаточные риски
Движок парсит HTML сторонних площадок (изменение вёрстки ⇒ пустая выдача, не ложная); источники могут начать блокировать (⇒ SOURCE_BLOCKED, честный пустой ответ);
название лота может содержать ФИО из публичной публикации торгов (см. правовой чек-лист); `limit_conn` отдельно не изолировался в тесте; исходящие запросы
идут с IP сервера напрямую (по решению владельца).
