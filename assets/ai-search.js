(() => {
  'use strict';
  const form = document.getElementById('ai-lot-form');
  if (!form) return;

  const q = document.getElementById('ai-query');
  const source = document.getElementById('ai-source');
  const limit = document.getElementById('ai-limit');
  const status = document.getElementById('ai-status');
  const button = document.getElementById('ai-submit');
  const links = document.getElementById('ai-links');
  const results = document.getElementById('ai-results');
  const resultTitle = document.getElementById('ai-results-title');
  const resultCaption = document.getElementById('ai-results-caption');
  const resultCoverage = document.getElementById('ai-results-coverage');
  const cards = document.getElementById('ai-cards');
  const allowedHosts = ['fedresurs.ru', 'bankrot.fedresurs.ru', 'torgi.gov.ru', 'lot-online.ru', 'm-ets.ru'];
  const sourceNames = { 'gis-torgi': 'ГИС Торги', efrsb: 'ЕФРСБ', mets: 'МЭТС', rad: 'РАД / Lot-online' };
  let searchReady = false;

  function safeUrl(raw) {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
    } catch {
      return null;
    }
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

  function setBusy(busy) {
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.disabled = busy || !searchReady;
    button.textContent = busy ? 'Исследуем публичный источник…' : searchReady ? 'Найти предварительные публикации' : 'Автоматический поиск недоступен';
  }

  function setSearchReady(ready) {
    searchReady = ready;
    for (const control of [q, source, limit]) control.disabled = !ready;
    setBusy(false);
  }

  function renderLinks(text) {
    const items = [
      ['ЕФРСБ — официальный реестр', 'https://bankrot.fedresurs.ru/'],
      ['ГИС Торги — официальный реестр', 'https://torgi.gov.ru/']
    ];
    if (text) {
      items.push(['Поиск по ЕФРСБ в Яндексе — непроверенные результаты', `https://yandex.ru/search/?text=${encodeURIComponent(`site:bankrot.fedresurs.ru ${text}`)}`]);
      items.push(['Поиск по ГИС Торги в Яндексе — непроверенные результаты', `https://yandex.ru/search/?text=${encodeURIComponent(`site:torgi.gov.ru ${text}`)}`]);
    }
    links.replaceChildren();
    for (const [name, url] of items) {
      const anchor = el('a', `${name} ↗`);
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      links.append(anchor);
    }
  }

  function checkedTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'время не подтверждено';
  }

  function applicationState(value) {
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
    if (lot.region || lot.region_code) card.append(el('p', `Регион: ${String(lot.region || `код ${lot.region_code}`).slice(0, 100)}`));
    if (Number.isFinite(lot.price_rub)) card.append(el('p', `Цена в публикации: ${new Intl.NumberFormat('ru-RU').format(lot.price_rub)} ₽`));
    if (lot.application_deadline) card.append(el('p', `Срок по публикации: ${String(lot.application_deadline).slice(0, 80)}`));
    if (lot.summary) card.append(el('p', String(lot.summary).slice(0, 320)));
    card.append(el('p', applicationState(lot.accepting_applications), 'ai-lot-state'));
    const actions = el('div', null, 'ai-card-actions');
    const sourceLink = el('a', 'Открыть первоисточник ↗');
    sourceLink.href = url;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
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
    resultTitle.textContent = count ? `Найдено публикаций: ${count}` : 'В проверенной части источника совпадений нет';
    resultCaption.textContent = `Ответ получен: ${checkedTime(data.retrieved_at)}. Данные предварительные; откройте первоисточник перед любым решением.`;
    resultCoverage.textContent = data.coverage_note || '';
    resultCoverage.hidden = !data.coverage_note;
    resultTitle.focus({ preventScroll: true });
    if (count) notice('Подборка сформирована. Перед участием проверьте статус, документы и условия в первоисточнике.');
    else if (data.reason === 'SOURCE_BLOCKED') notice('Источник ограничил доступ. Попробуйте позже или откройте его вручную.', true);
    else if (data.status === 'TIMEOUT') notice('Лимит времени исследования исчерпан. Показан только доступный частичный результат.', true);
    else notice('Нет подтверждаемых кандидатов в проверенной части источника. Это не означает, что их нет во всём каталоге.');
  }

  q.addEventListener('input', () => renderLinks(q.value.trim().slice(0, 400)));
  for (const example of document.querySelectorAll('.ai-example')) {
    example.addEventListener('click', () => {
      q.value = String(example.dataset.query || '').slice(0, 400);
      renderLinks(q.value);
      if (searchReady) q.focus();
      else notice('Пример подставлен только для перехода к первоисточникам; автоматическая отправка выключена.');
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = q.value.trim();
    if (!searchReady) {
      notice('Автоматический поиск не включён. Используйте первоисточники ниже.', true);
      return;
    }
    if (query.length < 12 || query.length > 400) {
      notice('Введите запрос от 12 до 400 символов.', true);
      q.focus();
      return;
    }
    renderLinks(query);
    results.hidden = true;
    cards.replaceChildren();
    setBusy(true);
    notice('Запрос принят. Сервер исследует ограниченный набор публичных страниц выбранного источника.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch('/api/ai-lot-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, source: source.value, limit: Number(limit.value) }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || !Array.isArray(data.lots)) {
        throw new Error('Автоматический поиск пока не подключён. Откройте источники ниже.');
      }
      renderResponse(data);
    } catch (error) {
      if (error?.name === 'AbortError') notice('Время поиска истекло. Откройте первоисточники ниже.', true);
      else if (error?.name === 'TypeError') notice('Сервис недоступен. Откройте первоисточники ниже.', true);
      else notice(error?.message || 'Сервис недоступен.', true);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  });

  async function checkAvailability() {
    try {
      const response = await fetch('/api/ai-lot-search', { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (data.enabled === true) {
        setSearchReady(true);
        notice('Автоматический поиск включён. Введите только публичные критерии; результаты предварительные и требуют проверки.');
        return;
      }
    } catch {
      // Fail closed: a missing API must never enable query submission.
    }
    setSearchReady(false);
    notice('Автоматический поиск пока не включён. Можно искать в первоисточниках ниже; текст запроса не отправляется.');
  }

  checkAvailability();
})();
