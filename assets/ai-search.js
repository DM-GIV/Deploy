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
  const allowedHosts = ['fedresurs.ru', 'bankrot.fedresurs.ru', 'torgi.gov.ru', 'lot-online.ru', 'm-ets.ru', 'meetings.m-ets.ru', 'bankrupt.utpl.ru'];
  const sourceNames = { utpl: 'Объединённая торговая площадка', 'gis-torgi': 'ГИС Торги', efrsb: 'ЕФРСБ', mets: 'МЭТС', rad: 'РАД / Lot-online' };
  let searchReady = false;
  let activeController = null;
  let elapsedTimer = null;
  let phase = '';
  let startedAt = 0;

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
    button.disabled = busy || !searchReady;
    cancel.hidden = !busy;
    button.textContent = busy ? 'Поиск выполняется…' : searchReady ? 'Найти лоты' : 'Поиск временно недоступен';
  }
  function setSearchReady(ready) { searchReady = ready; q.disabled = !ready; setBusy(false); }
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
    resultTitle.textContent = count ? `Проверено актуальных карточек: ${count}` : 'Подтверждённых совпадений не найдено';
    resultCaption.textContent = `Ответ получен: ${checkedTime(data.retrieved_at)}. Откройте первоисточник перед любым решением.`;
    resultCoverage.textContent = data.coverage_note || '';
    resultCoverage.hidden = !data.coverage_note;
    resultTitle.focus({ preventScroll: true });
    if (count) notice(`Результаты сформированы за ${Math.max(0, Math.round((Date.now() - startedAt) / 1000))} с. Условия нужно перепроверить в первоисточнике.`);
    else notice('В проверенной части доступных каталогов актуальные совпадения не подтверждены. Измените формулировку или попробуйте позже.');
  }
  for (const example of document.querySelectorAll('.ai-example')) {
    example.addEventListener('click', () => {
      q.value = String(example.dataset.query || '').slice(0, 400);
      if (searchReady) q.focus();
      else notice('Пример подставлен, но сервер поиска пока выключен; запрос не отправлен.');
    });
  }
  cancel.addEventListener('click', () => { if (activeController) activeController.abort(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = q.value.trim();
    if (!searchReady) { notice('Публичный поиск пока не включён; запрос не отправлен.', true); return; }
    if (query.length < 12 || query.length > 400) { notice('Введите запрос от 12 до 400 символов.', true); q.focus(); return; }
    results.hidden = true;
    cards.replaceChildren();
    activeController = new AbortController();
    startedAt = Date.now();
    setBusy(true);
    setPhase('Думаю…');
    elapsedTimer = window.setInterval(updateElapsed, 1000);
    await Promise.resolve();
    setPhase('Ищу предложения и проверяю первоисточники');
    const timeout = window.setTimeout(() => activeController?.abort(), 58_000);
    try {
      const response = await fetch('/api/ai-lot-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: activeController.signal,
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || !Array.isArray(data.lots)) throw new Error('SEARCH_UNAVAILABLE');
      setPhase('Формирую результаты');
      renderResponse(data);
    } catch (error) {
      if (error?.name === 'AbortError') notice('Поиск отменён или достиг лимита времени. Неполные данные не показаны как подтверждённый результат.', true);
      else notice('Поиск временно недоступен. Запрос не сохранён; попробуйте позже.', true);
    } finally {
      window.clearTimeout(timeout);
      window.clearInterval(elapsedTimer);
      elapsedTimer = null;
      phase = '';
      activeController = null;
      setBusy(false);
    }
  });
  async function checkAvailability() {
    try {
      const response = await fetch('/api/ai-lot-search', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (data.enabled === true) {
        setSearchReady(true);
        notice('Публичный поиск включён. Не вводите личные данные; выдача ограничена доступными открытыми источниками.');
        return;
      }
    } catch { /* Fail closed. */ }
    setSearchReady(false);
    notice('Публичный поиск пока не включён. Текст запроса не отправляется.');
  }
  checkAvailability();
})();
