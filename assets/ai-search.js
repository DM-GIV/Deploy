(() => {
  'use strict';
  const form = document.getElementById('ai-lot-form');
  if (!form) return;
  const q = document.getElementById('ai-query');
  const status = document.getElementById('ai-status');
  const button = document.getElementById('ai-submit');
  const cancel = document.getElementById('ai-cancel');
  const results = document.getElementById('ai-results');
  const resultTitle = document.getElementById('ai-results-title');
  const resultCaption = document.getElementById('ai-results-caption');
  const resultCoverage = document.getElementById('ai-results-coverage');
  const cards = document.getElementById('ai-cards');
  const allowedHosts = ['fedresurs.ru', 'bankrot.fedresurs.ru', 'torgi.gov.ru', 'lot-online.ru', 'm-ets.ru', 'meetings.m-ets.ru', 'bankrupt.utpl.ru', 'bankrupt.etpu.ru', 'bankrupt.centerr.ru'];
  const sourceNames = { utpl: 'Объединённая торговая площадка', etpu: 'Уральская ЭТП (УЭТП)', 'centerr-bankrupt': 'Центр реализации', 'gis-torgi': 'ГИС Торги', efrsb: 'ЕФРСБ', mets: 'МЭТС', rad: 'РАД / Lot-online' };
  let activeController = null;
  let elapsedTimer = null;
  let phase = '';
  let startedAt = 0;
  let timedOut = false;
  const DEFAULT_COVERAGE = 'Показаны не все возможные предложения: поиск ограничен открытыми сведениями и временем ответа. Отсутствие карточки не означает, что лота нет.';
  const INCOMPLETE = ['BUSY', 'RATE_LIMITED', 'TIME_BUDGET_EXHAUSTED', 'TIMEOUT', 'SOURCE_PACING_BUSY'];
  // The form never depends on a preliminary availability check: stale cached HTML may still carry `disabled`.
  q.disabled = false;
  button.disabled = false;
  window.__aiSearchReady = true;

  function safeUrl(raw) {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
    } catch { return null; }
  }
  function el(type, value, className) {
    const node = document.createElement(type);
    if (value != null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  }
  function notice(message, error = false) {
    status.textContent = message;
    status.dataset.error = error ? 'true' : 'false';
  }
  function updateElapsed() {
    if (phase && startedAt) notice(`${phase} · ${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))} с`);
  }
  function setPhase(value) { phase = value; updateElapsed(); }
  function setBusy(busy) {
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.disabled = busy;
    cancel.hidden = !busy;
    button.textContent = busy ? 'Поиск выполняется…' : 'Найти лоты';
  }
  function checkedTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'время не подтверждено';
  }
  function applicationState(value) {
    if (value === 'CONFIRMED_BY_SOURCE_STATUS_AND_DATE') return 'Источник показывает приём заявок, а опубликованный срок ещё не истёк.';
    if (value === 'CONFIRMED') return 'Карточка источника подтверждает приём заявок.';
    if (value === 'CONFIRMED_BY_PUBLICATION_DATES') return 'По опубликованному периоду срок ещё не истёк; перепроверьте статус в источнике.';
    if (value === 'CONFIRMED_BY_SOURCE_STATUS') return 'Источник показывает статус приёма заявок; перепроверьте его перед участием.';
    return 'Возможность подать заявку не подтверждена.';
  }
  function renderLot(lot) {
    const url = safeUrl(lot?.url);
    if (!url || typeof lot.title !== 'string') return null;
    const card = el('article', null, 'ai-card');
    card.append(el('h3', lot.title.slice(0, 180)));
    const meta = el('div', null, 'ai-card-meta');
    meta.append(el('span', sourceNames[lot.source] || String(lot.source || 'Источник не указан')));
    meta.append(el('span', `Проверено: ${checkedTime(lot.checked_at)}`));
    card.append(meta);
    if (lot.category) card.append(el('p', `Вид имущества: ${String(lot.category).slice(0, 100)}`));
    if (lot.procedure_type) card.append(el('p', `Процедура: ${String(lot.procedure_type).slice(0, 100)}`));
    if (lot.region || lot.region_code) card.append(el('p', `Регион: ${String(lot.region || `код ${lot.region_code}`).slice(0, 100)}`));
    if (Number.isFinite(lot.price_rub)) card.append(el('p', `${lot.price_meaning || 'Цена в публикации'}: ${new Intl.NumberFormat('ru-RU').format(lot.price_rub)} ₽`));
    if (lot.application_deadline) card.append(el('p', `Приём заявок до: ${checkedTime(lot.application_deadline)}`));
    if (lot.summary) card.append(el('p', String(lot.summary).slice(0, 320)));
    card.append(el('p', applicationState(lot.accepting_applications), 'ai-lot-state'));
    const actions = el('div', null, 'ai-card-actions');
    const sourceLink = el('a', 'Открыть карточку лота ↗');
    sourceLink.href = url;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.setAttribute('aria-label', `Открыть первоисточник: ${lot.title.slice(0, 100)}`);
    const verify = el('a', 'Получить карту проверки');
    verify.href = '/proverka-lota/#lot-check-form';
    actions.append(sourceLink, verify);
    card.append(actions);
    return card;
  }
  function renderResponse(data) {
    cards.replaceChildren();
    let count = 0;
    for (const lot of data.lots.slice(0, 10)) {
      const card = renderLot(lot);
      if (!card) continue;
      cards.append(card);
      count += 1;
    }
    results.hidden = false;
    const incomplete = !count && (INCOMPLETE.includes(data.reason) || data.status === 'TIMEOUT');
    resultTitle.textContent = count ? `Проверено актуальных карточек: ${count}` : incomplete ? 'Поиск не завершён' : 'Подтверждённых совпадений не найдено';
    resultCaption.textContent = `Ответ получен: ${checkedTime(data.retrieved_at)}. Откройте первоисточник перед любым решением.`;
    // Only a fixed, source-neutral caveat is shown; the API's technical coverage_note is not rendered.
    resultCoverage.textContent = DEFAULT_COVERAGE;
    resultCoverage.hidden = false;
    resultTitle.focus({ preventScroll: true });
    if (count) notice(`Результаты сформированы за ${Math.max(0, Math.round((Date.now() - startedAt) / 1000))} с. Условия нужно перепроверить в первоисточнике.`);
    else if (incomplete) notice('Сервис сейчас занят или время поиска исчерпано. Это не означает, что лотов нет: повторите запрос через минуту.', true);
    else notice('Актуальные совпадения не подтверждены. Измените формулировку или попробуйте позже.');
  }
  for (const example of document.querySelectorAll('.ai-example')) {
    example.addEventListener('click', () => {
      q.value = String(example.dataset.query || '').slice(0, 400);
      q.focus();
    });
  }
  cancel.addEventListener('click', () => { if (activeController) activeController.abort(); });
  // Enter sends the query (Shift+Enter inserts a line break); never while an IME composition is active.
  q.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });
  function failureMessage(status, code) {
    if (status === 429 || code === 'RATE_LIMITED') return 'Слишком много запросов. Подождите минуту и нажмите «Найти лоты» ещё раз. Текст запроса сохранён.';
    if (status === 413 || status === 400) return 'Запрос не принят: проверьте текст (от 12 до 400 символов) и повторите.';
    if (status === 403) return 'Запрос отклонён защитой сайта. Обновите страницу и повторите. Текст запроса сохранён.';
    if (status === 503 || status === 502 || status === 504 || code === 'NOT_ENABLED' || code === 'SERVICE_UNAVAILABLE') return 'Поиск временно недоступен или перезапускается. Подождите минуту и повторите; текст запроса сохранён.';
    return 'Сервис вернул неожиданный ответ. Повторите запрос; текст запроса сохранён.';
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (activeController) return; // no double submission while a search is running
    const query = q.value.trim();
    if (query.length < 12 || query.length > 400) { notice('Введите запрос от 12 до 400 символов.', true); q.focus(); return; }
    results.hidden = true;
    cards.replaceChildren();
    const controller = new AbortController();
    activeController = controller;
    timedOut = false;
    startedAt = Date.now();
    setBusy(true);
    setPhase('Думаю…');
    elapsedTimer = window.setInterval(updateElapsed, 1000);
    // Keep "Думаю…" on screen long enough to be seen before the more specific phase replaces it.
    const phaseTimer = window.setTimeout(() => { if (activeController === controller) setPhase('Ищу предложения и проверяю первоисточники'); }, 1500);
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 24_000);
    try {
      const response = await fetch('/api/ai-lot-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { notice(failureMessage(response.status, data && data.code), true); return; }
      if (data.ok !== true || !Array.isArray(data.lots)) { notice(failureMessage(0, ''), true); return; }
      setPhase('Формирую результаты');
      try { renderResponse(data); } catch { cards.replaceChildren(); results.hidden = true; notice('Не удалось показать результаты. Повторите запрос; текст запроса сохранён.', true); }
    } catch (error) {
      if (error?.name === 'AbortError') notice(timedOut ? 'Время ожидания истекло. Неполные данные не показаны как результат; нажмите «Найти лоты», чтобы повторить. Текст запроса сохранён.' : 'Поиск отменён. Текст запроса сохранён; можно запустить его снова.', true);
      else notice('Нет связи с сервером. Проверьте интернет и нажмите «Найти лоты» ещё раз; текст запроса сохранён.', true);
    } finally {
      window.clearTimeout(timeout);
      window.clearTimeout(phaseTimer);
      window.clearInterval(elapsedTimer);
      elapsedTimer = null;
      phase = '';
      activeController = null;
      setBusy(false);
    }
  });
  // Informational only: a failed or slow availability check never blocks typing or searching.
  (async () => {
    try {
      const probe = new AbortController();
      const t = window.setTimeout(() => probe.abort(), 5000);
      const response = await fetch('/api/ai-lot-search', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: probe.signal });
      window.clearTimeout(t);
      const data = await response.json().catch(() => ({}));
      if (data.enabled === false && !activeController) notice('Поиск сейчас может быть отключён администратором: запрос будет принят, когда сервис включится.');
    } catch { /* Ignored on purpose: the form stays usable. */ }
  })();
})();
