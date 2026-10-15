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
  const understood = document.getElementById('ai-understood');
  const catalogCta = document.getElementById('ai-catalog-cta');
  const captchaBox = document.getElementById('ai-captcha');
  const captchaHint = document.getElementById('ai-captcha-hint');
  const allowedHosts = ['fedresurs.ru', 'bankrot.fedresurs.ru', 'torgi.gov.ru', 'lot-online.ru', 'm-ets.ru', 'meetings.m-ets.ru', 'bankrupt.utpl.ru', 'bankrupt.etpu.ru', 'bankrupt.centerr.ru'];
  const sourceNames = { utpl: 'Объединённая торговая площадка', etpu: 'Уральская ЭТП (УЭТП)', 'centerr-bankrupt': 'Центр реализации', 'gis-torgi': 'ГИС Торги', efrsb: 'ЕФРСБ', mets: 'МЭТС', rad: 'РАД / Lot-online' };
  let activeController = null;
  let elapsedTimer = null;
  let phase = '';
  let startedAt = 0;
  let timedOut = false;
  const DEFAULT_COVERAGE = 'Показаны не все возможные предложения: поиск ограничен открытыми сведениями и временем ответа. Отсутствие карточки не означает, что лота нет.';
  const CATALOGUE_COVERAGE = 'Показаны не все возможные предложения: каталог пополняется, а дата последней проверки указана в каждой карточке. Отсутствие карточки не означает, что лота нет.';
  const WIDGET_VERSION = '2.3.0';
  const CAPTCHA_URL = '/api/ai-lot-search?altcha=1';
  const CAPTCHA_STRINGS = JSON.stringify({ label: 'Я человек', verifying: 'Проверка…', verified: 'Проверка пройдена', error: 'Проверка не удалась. Нажмите ещё раз.', expired: 'Проверка устарела. Нажмите ещё раз.', waitAlert: 'Идёт проверка, подождите.', footer: 'Проверка выполняется на сайте, без внешних сервисов.', loading: 'Загрузка…', reload: 'Обновить', verify: 'Проверить', enterCode: 'Введите код', enterCodeAria: 'Введите код', getAudioChallenge: 'Аудио-проверка', ariaLinkLabel: 'ALTCHA' });
  let captchaToken = '';
  let captchaWidget = null;
  let captchaLoading = null;
  const INCOMPLETE = ['BUSY', 'RATE_LIMITED', 'TIME_BUDGET_EXHAUSTED', 'TIMEOUT', 'SOURCE_PACING_BUSY'];
  // The form never depends on a preliminary availability check: stale cached HTML may still carry `disabled`.
  q.disabled = false;
  button.disabled = false;
  window.__aiSearchReady = true;

  function safeUrl(raw, catalogue = false) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (catalogue) return url.hostname.includes('.') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':') ? url.href : null;
      return allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
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
    if (value === 'CONFIRMED_BY_CATALOGUE_DEADLINE') return 'По данным каталога приём заявок идёт, а срок ещё не истёк. Перепроверьте статус в первоисточнике.';
    if (value === 'NOT_CONFIRMED') return 'Срок приёма заявок или актуальность статуса не подтверждены. Проверьте в первоисточнике.';
    if (value === 'CONFIRMED_BY_SOURCE_STATUS_AND_DATE') return 'Источник показывает приём заявок, а опубликованный срок ещё не истёк.';
    if (value === 'CONFIRMED') return 'Карточка источника подтверждает приём заявок.';
    if (value === 'CONFIRMED_BY_PUBLICATION_DATES') return 'По опубликованному периоду срок ещё не истёк; перепроверьте статус в источнике.';
    if (value === 'CONFIRMED_BY_SOURCE_STATUS') return 'Источник показывает статус приёма заявок; перепроверьте его перед участием.';
    return 'Возможность подать заявку не подтверждена.';
  }
  function renderLot(lot, catalogue) {
    const url = safeUrl(lot?.url, catalogue);
    if (!url || typeof lot.title !== 'string') return null;
    const card = el('article', null, 'ai-card');
    card.append(el('h3', lot.title.slice(0, 180)));
    const meta = el('div', null, 'ai-card-meta');
    meta.append(el('span', sourceNames[lot.source] || String(lot.source || 'Источник не указан')));
    meta.append(el('span', `${catalogue ? 'Последняя проверка данных' : 'Проверено'}: ${checkedTime(lot.checked_at)}`));
    card.append(meta);
    if (lot.category) card.append(el('p', `Вид имущества: ${String(lot.category).slice(0, 100)}`));
    if (lot.procedure_type) card.append(el('p', `Процедура: ${String(lot.procedure_type).slice(0, 100)}`));
    if (lot.region || lot.region_code) card.append(el('p', `Регион: ${String(lot.region || `код ${lot.region_code}`).slice(0, 100)}`));
    if (Number.isFinite(lot.price_rub)) card.append(el('p', `${lot.price_meaning || 'Цена в публикации'}: ${new Intl.NumberFormat('ru-RU').format(lot.price_rub)} ₽`));
    else if (catalogue) card.append(el('p', 'Цена в каталоге не указана.'));
    if (lot.application_deadline) card.append(el('p', `Приём заявок до: ${checkedTime(lot.application_deadline)}`));
    if (lot.summary) card.append(el('p', String(lot.summary).slice(0, 320)));
    const stateText = catalogue && lot.status_label ? `${String(lot.status_label).slice(0, 200)}${lot.accepting_applications === 'CONFIRMED_BY_CATALOGUE_DEADLINE' ? ' Перепроверьте статус в первоисточнике.' : ' Проверьте статус в первоисточнике.'}` : applicationState(lot.accepting_applications);
    const state = el('p', stateText, 'ai-card-status');
    state.dataset.confirmed = lot.accepting_applications === 'CONFIRMED_BY_CATALOGUE_DEADLINE' ? 'true' : 'false';
    card.append(state);
    if (catalogue && Number.isInteger(lot.same_publication_count) && lot.same_publication_count > 0) card.append(el('p', `Ссылка ведёт на общую публикацию торгов: в ней ещё ${lot.same_publication_count} ${lot.same_publication_count === 1 ? 'лот' : 'лота/лотов'} из этого списка. Это один источник, а не несколько независимых.`, 'ai-note'));
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
  function renderUnderstood(data) {
    understood.replaceChildren();
    const items = Array.isArray(data.interpretation) ? data.interpretation.slice(0, 8) : [];
    const notes = Array.isArray(data.notes) ? data.notes.slice(0, 5) : [];
    const ignored = Array.isArray(data.ignored) ? data.ignored.slice(0, 6) : [];
    if (!items.length && !notes.length && !ignored.length) { understood.hidden = true; return; }
    understood.append(el('strong', 'Как понят запрос'));
    if (items.length) {
      const list = el('ul');
      for (const item of items) list.append(el('li', `${String(item.label).slice(0, 80)}: ${String(item.value).slice(0, 300)}`));
      understood.append(list);
    }
    for (const note of notes) understood.append(el('p', String(note).slice(0, 400), 'ai-note'));
    if (ignored.length) understood.append(el('p', `Не учтено в поиске: ${ignored.map(word => String(word).slice(0, 30)).join(', ')}. Если это важное условие, уточните запрос.`, 'ai-note'));
    understood.hidden = false;
  }
  function renderResponse(data) {
    cards.replaceChildren();
    const catalogue = typeof data.status === 'string' && data.status.startsWith('CORE_');
    let count = 0;
    for (const lot of data.lots.slice(0, 5)) {
      const card = renderLot(lot, catalogue);
      if (!card) continue;
      cards.append(card);
      count += 1;
    }
    results.hidden = false;
    renderUnderstood(data);
    if (data.status === 'NEEDS_CLARIFICATION') {
      resultTitle.textContent = 'Уточните запрос';
      resultCaption.textContent = String(data.clarification || 'Не удалось однозначно понять запрос.').slice(0, 400);
      resultCoverage.hidden = true;
      catalogCta.hidden = true;
      resultTitle.focus({ preventScroll: true });
      notice('Запрос не выполнен: нужно уточнение. Текст запроса сохранён — отредактируйте его и повторите.', true);
      return;
    }
    const incomplete = !count && (INCOMPLETE.includes(data.reason) || data.status === 'TIMEOUT');
    resultTitle.textContent = count ? `Подходящих предложений: ${count} (до 5)` : incomplete ? 'Поиск не завершён' : 'Подходящих предложений не найдено';
    resultCaption.textContent = `Ответ получен: ${checkedTime(data.retrieved_at)}. Откройте первоисточник перед любым решением.`;
    // Only a fixed, source-neutral caveat is shown; the API's technical coverage_note is not rendered.
    resultCoverage.textContent = catalogue ? CATALOGUE_COVERAGE : DEFAULT_COVERAGE;
    resultCoverage.hidden = false;
    catalogCta.hidden = incomplete;
    resultTitle.focus({ preventScroll: true });
    if (count) notice(`Результаты сформированы за ${Math.max(0, Math.round((Date.now() - startedAt) / 1000))} с. Условия нужно перепроверить в первоисточнике.`);
    else if (incomplete) notice('Сервис сейчас занят или время поиска исчерпано. Это не означает, что лотов нет: повторите запрос через минуту.', true);
    else notice('Подходящих предложений с подтверждённым приёмом заявок не найдено. Измените условия (регион, цену, тип) или попробуйте позже.');
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
  function setCaptchaState(state, hint) {
    captchaBox.dataset.state = state;
    if (hint) captchaHint.textContent = hint;
  }
  function loadCaptchaWidget() {
    if (window.customElements && window.customElements.get('altcha-widget')) return Promise.resolve();
    if (!captchaLoading) {
      captchaLoading = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/assets/vendor/altcha/altcha.css?v=${WIDGET_VERSION}`;
        document.head.appendChild(link);
        const script = document.createElement('script');
        script.src = `/assets/vendor/altcha/altcha.js?v=${WIDGET_VERSION}`;
        script.type = 'module';
        script.async = true;
        script.onload = () => (window.customElements && window.customElements.get('altcha-widget') ? resolve() : reject(new Error('widget')));
        script.onerror = () => reject(new Error('script'));
        document.head.appendChild(script);
      }).catch(error => { captchaLoading = null; throw error; });
    }
    return captchaLoading;
  }
  function mountCaptcha() {
    // The text field never waits for this: it only prepares the "Я человек" check that precedes the search button.
    loadCaptchaWidget().then(() => {
      if (captchaWidget) return;
      const widget = document.createElement('altcha-widget');
      widget.setAttribute('challengeurl', CAPTCHA_URL);
      widget.setAttribute('workerurl', `/assets/vendor/altcha/worker.js?v=${WIDGET_VERSION}`);
      widget.setAttribute('auto', 'off');
      widget.setAttribute('name', 'altcha');
      widget.setAttribute('expire', '240000');
      widget.setAttribute('hidelogo', '');
      widget.setAttribute('strings', CAPTCHA_STRINGS);
      widget.setAttribute('credentials', 'omit');
      widget.addEventListener('statechange', event => {
        const detail = event.detail || {};
        captchaToken = detail.state === 'verified' && typeof detail.payload === 'string' ? detail.payload : '';
        if (detail.state === 'verified') setCaptchaState('ok', 'Проверка пройдена. Можно искать.');
        else if (detail.state === 'error') setCaptchaState('error', 'Проверка «Я человек» не удалась. Нажмите на отметку ещё раз.');
        else if (detail.state === 'expired') setCaptchaState('error', 'Проверка устарела. Отметьте «Я человек» ещё раз.');
      });
      captchaWidget = widget;
      captchaBox.append(widget);
    }).catch(() => setCaptchaState('error', 'Не загрузилась проверка «Я человек». Обновите страницу или проверьте блокировщики и сеть; введённый текст сохранится в поле.'));
  }
  function resetCaptcha() {
    captchaToken = '';
    if (captchaWidget && typeof captchaWidget.reset === 'function') captchaWidget.reset();
    setCaptchaState('idle', 'Перед следующим поиском снова отметьте «Я человек».');
  }
  mountCaptcha();
  function failureMessage(status, code) {
    if (typeof code === 'string' && code.startsWith('CAPTCHA_')) return code === 'CAPTCHA_UNAVAILABLE' ? 'Проверка «Я человек» временно недоступна на сервере. Повторите позже; текст запроса сохранён.' : 'Проверка «Я человек» не принята или устарела. Отметьте её ещё раз и повторите поиск; текст запроса сохранён.';
    if (status === 429 || code === 'RATE_LIMITED') return 'Слишком много запросов. Подождите минуту и нажмите «Найти лоты» ещё раз. Текст запроса сохранён.';
    if (status === 413 || status === 400) return 'Запрос не принят: проверьте текст (от 12 до 400 символов) и повторите.';
    if (status === 403) return 'Запрос отклонён защитой сайта. Обновите страницу и повторите. Текст запроса сохранён.';
    if (code === 'SERVICE_UNAVAILABLE') return 'Поиск временно недоступен. Мы не подставляем неточные результаты; повторите позже. Текст запроса сохранён.';
    if (code === 'BUSY') return 'Сервис сейчас занят. Подождите немного и повторите; текст запроса сохранён.';
    if (code === 'TIMEOUT') return 'Каталог не успел ответить. Повторите поиск через минуту; текст запроса сохранён.';
    if (status === 503 || status === 502 || status === 504 || code === 'NOT_ENABLED' || code === 'SERVICE_UNAVAILABLE') return 'Поиск временно недоступен или перезапускается. Подождите минуту и повторите; текст запроса сохранён.';
    return 'Сервис вернул неожиданный ответ. Повторите запрос; текст запроса сохранён.';
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (activeController) return; // no double submission while a search is running
    const query = q.value.trim();
    if (query.length < 12 || query.length > 400) { notice('Введите запрос от 12 до 400 символов.', true); q.focus(); return; }
    if (!captchaToken) {
      if (!captchaWidget) mountCaptcha();
      setCaptchaState('error', 'Отметьте «Я человек» перед поиском.');
      notice('Сначала пройдите проверку «Я человек» — она над кнопкой «Найти лоты». Текст запроса сохранён.', true);
      captchaBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const box = captchaBox.querySelector('input[type="checkbox"]');
      if (box) box.focus();
      return;
    }
    const proof = captchaToken;
    results.hidden = true;
    understood.hidden = true;
    catalogCta.hidden = true;
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
        body: JSON.stringify({ query, altcha: proof }),
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
      resetCaptcha(); // one proof of work = one request; the next search needs a fresh "Я человек"
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
      // Honest description of the engine that is actually connected (the page copy is mode-neutral).
      const eyebrow = document.getElementById('ai-eyebrow');
      const modeNote = document.getElementById('ai-mode-note');
      if (data.mode === 'CORE_SEARCH' && eyebrow) eyebrow.textContent = 'Поиск по каталогу ТоргАтлас';
      if (data.mode === 'PUBLIC_WEB_RESEARCH_MINI' && modeNote) { modeNote.textContent = 'Упрощённый режим: быстрый просмотр открытых страниц. Точность по региону и типу имущества ограничена, часть результатов может не соответствовать запросу — проверяйте каждую карточку.'; modeNote.hidden = false; }
      if (data.mode === 'CORE_UNAVAILABLE' && modeNote) { modeNote.textContent = 'Сервис каталога сейчас недоступен, поиск временно не работает. Мы не подменяем его неточным поиском; текст запроса можно ввести и отправить позже.'; modeNote.hidden = false; }
      if (data.mode === 'UNAVAILABLE_CORE_REQUIRED' && modeNote) { modeNote.textContent = 'Поиск временно недоступен: сервис каталога не подключён. Мы не подменяем его неточным поиском.'; modeNote.hidden = false; }
      if (data.enabled === false && !activeController) notice('Поиск сейчас может быть отключён администратором: запрос будет принят, когда сервис включится.');
    } catch { /* Ignored on purpose: the form stays usable. */ }
  })();
})();
