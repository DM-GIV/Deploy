/* Direct-lead UI: progressive enhancement. Completely hidden unless the
 * server confirms a working backend (local ALTCHA + durable SQLite) and the
 * same consent version as this script. Nothing is sent without an explicit
 * form submission. The anti-spam widget is self-hosted under /assets/vendor/altcha
 * (ALTCHA 2.3.0, MIT); there are no third-party CAPTCHA, CDN or API requests.
 */
(function () {
  'use strict';
  var CONSENT_VERSION = '2026-10-12.2';
  var WIDGET_VERSION = '2.3.0';
  var configRequest = null;
  var widgetRequest = null;
  var active = Object.create(null);

  function getConfiguration() {
    if (!configRequest) {
      configRequest = fetch('/api/lead-config', {
        method:'GET', cache:'no-store', credentials:'omit',
        headers:{ 'Accept':'application/json' }
      }).then(function (response) {
        if (!response.ok) return {enabled:false};
        return response.json();
      }).then(function (config) {
        return config && config.enabled === true && config.consentVersion === CONSENT_VERSION &&
          config.altcha && config.altcha.challengeUrl === '/api/altcha-challenge'
          ? config : {enabled:false};
      }).catch(function () { return {enabled:false}; });
    }
    return configRequest;
  }

  function loadWidget() {
    if (window.customElements && window.customElements.get('altcha-widget')) return Promise.resolve();
    if (!widgetRequest) {
      widgetRequest = new Promise(function (resolve, reject) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/assets/vendor/altcha/altcha.css?v=' + WIDGET_VERSION;
        document.head.appendChild(link);
        var script = document.createElement('script');
        script.src = '/assets/vendor/altcha/altcha.js?v=' + WIDGET_VERSION;
        script.type = 'module';
        script.async = true;
        script.onload = function () {
          if (window.customElements && window.customElements.get('altcha-widget')) resolve();
          else reject(new Error('ALTCHA widget unavailable'));
        };
        script.onerror = function () { reject(new Error('ALTCHA script unavailable')); };
        document.head.appendChild(script);
      });
    }
    return widgetRequest;
  }

  var STRINGS = JSON.stringify({
    label: 'Я не робот (локальная проверка)',
    verifying: 'Проверка…',
    verified: 'Проверка пройдена',
    error: 'Проверка не удалась. Нажмите ещё раз.',
    expired: 'Проверка устарела. Нажмите ещё раз.',
    waitAlert: 'Идёт проверка, подождите.',
    footer: 'Проверка выполняется на сайте, без внешних сервисов.',
    loading: 'Загрузка…',
    reload: 'Обновить',
    verify: 'Проверить',
    enterCode: 'Введите код',
    enterCodeAria: 'Введите код',
    getAudioChallenge: 'Аудио-проверка',
    ariaLinkLabel: 'ALTCHA'
  });

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'text') node.textContent = props[key];
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function showDirectForm(kind, config) {
    var preview = document.getElementById(kind + '-handoff-preview');
    var textarea = document.getElementById(kind + '-handoff-text');
    if (!preview || !textarea || !config.enabled || active[kind]) return;
    active[kind] = true;
    var source = kind === 'lot' ? 'lot_check' : 'search_brief';
    var block = document.createElement('div');
    block.className = 'direct-lead';
    block.innerHTML =
      '<h4>Отправить заявку напрямую</h4>' +
      '<p>Заявка сохраняется на сервере ТоргАтлас после нажатия кнопки. Если прямая отправка не сработает, воспользуйтесь e-mail, Telegram или телефоном выше.</p>' +
      '<form class="direct-lead-form" novalidate>' +
      '<label>Контакт для ответа *<input name="contact" type="text" minlength="5" maxlength="180" required autocomplete="email" placeholder="Телефон, ТГ, MAX или e-mail"></label>' +
      '<div class="direct-lead-trap" aria-hidden="true"><label>Ваш сайт<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<label class="direct-lead-consent"><input type="checkbox" name="consent" required> Согласен на обработку контактных данных и текста заявки для получения ответа. <a href="/privacy/consent/" target="_blank" rel="noopener">Текст отдельного согласия</a> · <a href="/privacy/" target="_blank" rel="noopener">Политика</a></label>' +
      '<div class="direct-lead-challenge" aria-label="Проверка защиты от спама"></div>' +
      '<button class="button button-primary" type="submit" disabled>Отправить заявку</button>' +
      '<div class="form-status direct-lead-status" role="status" aria-live="polite"></div>' +
      '</form>';
    preview.appendChild(block);
    var form = block.querySelector('form');
    var startedTracking = false;
    form.addEventListener('focusin', function (event) {
      if (startedTracking || !event.target || (event.target.name !== 'contact' && event.target.name !== 'consent')) return;
      startedTracking = true;
      if (typeof window.auctionCROTrack === 'function') window.auctionCROTrack('lead_direct_started', {source:source});
    });
    var contact = form.elements.namedItem('contact');
    var consent = form.elements.namedItem('consent');
    var prevContact = document.getElementById(kind === 'lot' ? 'contact' : 'search-contact');
    if (prevContact && prevContact.value.trim()) contact.value = prevContact.value.trim().slice(0, 180);
    var status = block.querySelector('.direct-lead-status');
    var submit = form.querySelector('[type="submit"]');
    var challenge = block.querySelector('.direct-lead-challenge');
    var token = '';
    var widget = null;
    var requestId = '';
    var snapshot = '';
    var busy = false;

    function sync() { submit.disabled = busy || !token || !consent.checked; }
    function say(text) { status.textContent = text; }
    function resetCaptcha() {
      token = '';
      if (widget && typeof widget.reset === 'function') widget.reset();
      sync();
    }
    consent.addEventListener('change', sync);

    loadWidget().then(function () {
      widget = document.createElement('altcha-widget');
      widget.setAttribute('challengeurl', config.altcha.challengeUrl);
      widget.setAttribute('workerurl', '/assets/vendor/altcha/worker.js?v=' + WIDGET_VERSION);
      widget.setAttribute('auto', 'off');
      widget.setAttribute('name', 'altcha');
      widget.setAttribute('expire', '540000');
      widget.setAttribute('hidelogo', '');
      widget.setAttribute('strings', STRINGS);
      widget.setAttribute('credentials', 'omit');
      widget.addEventListener('statechange', function (event) {
        var detail = event.detail || {};
        token = detail.state === 'verified' && typeof detail.payload === 'string' ? detail.payload : '';
        if (detail.state === 'error' || detail.state === 'expired') {
          say('Проверка от спама не пройдена или устарела. Нажмите на отметку проверки ещё раз либо используйте e-mail или ТГ.');
        } else if (detail.state === 'verified') {
          say('');
        }
        sync();
      });
      challenge.appendChild(widget);
    }).catch(function () {
      say('Прямая отправка пока недоступна: не загрузилась проверка от спама. Используйте e-mail, ТГ или телефон.');
      submit.disabled = true;
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy || !token || !consent.checked || !form.reportValidity()) return;
      var message = textarea.value.trim();
      if (message.length < 40 || message.length > 6000) {
        say('Длина сообщения должна быть от 40 до 6000 символов. При необходимости сократите текст.');
        return;
      }
      var now = kind + '\u0000' + contact.value.trim() + '\u0000' + message;
      if (!requestId || snapshot !== now) {
        if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
          say('Безопасная отправка недоступна в этом браузере. Используйте e-mail или ТГ.');
          return;
        }
        requestId = window.crypto.randomUUID();
        snapshot = now;
      }
      busy = true;
      sync();
      say('Передаю заявку. Не закрывайте эту страницу до результата.');
      var failure = '';
      try {
        var response = await fetch('/api/lead', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          credentials:'same-origin', cache:'no-store',
          body:JSON.stringify({
            id:requestId, kind:kind, contact:contact.value.trim(), message:message,
            consent:true, privacyVersion:CONSENT_VERSION,
            website:form.elements.namedItem('website').value,
            altcha:token
          })
        });
        var body = await response.json().catch(function () { return null; });
        if (response.status === 200 && body && body.ok === true && body.code === 'ACCEPTED' &&
            body.accepted === true && body.id === requestId && body.receipt === requestId) {
          showSuccess(body.receipt);
          return;
        }
        var code = body && body.code;
        if (code === 'CAPTCHA_FAILED' || code === 'CAPTCHA_REPLAY') {
          failure = 'Проверка от спама не принята или устарела. Пройдите её ещё раз и повторите отправку.';
          resetCaptcha();
        } else if (code === 'ID_CONFLICT') {
          requestId = '';
          failure = 'Данные заявки изменились. Нажмите «Отправить заявку» ещё раз.';
        } else if (code === 'INVALID_INPUT') {
          failure = 'Проверьте контакт, текст и отметку согласия: данные не приняты.';
        } else if (code === 'RATE_LIMITED') {
          failure = 'Слишком много попыток. Подождите минуту и повторите либо используйте e-mail или ТГ.';
        } else if (code === 'NOT_CONFIGURED') {
          failure = 'Прямая отправка сейчас отключена. Используйте e-mail, ТГ или телефон.';
        } else {
          failure = 'Не удалось подтвердить приём заявки. Ваш текст сохранён на странице: повторите попытку или используйте e-mail, ТГ или телефон.';
        }
      } catch (_) {
        failure = 'Нет связи с сервером: приём заявки не подтверждён. Повторите попытку (повтор безопасен) или используйте e-mail, ТГ или телефон.';
      } finally {
        busy = false;
        sync();
      }
      say(failure);
      if (typeof window.auctionCROTrack === 'function') {
        window.auctionCROTrack('lead_direct_unconfirmed', {source:source});
      }
    });

    function showSuccess(receipt) {
      var done = el('div', {'class':'direct-lead-done', role:'status'}, [
        el('h4', {text:'Заявка принята и сохранена'}),
        el('p', {text:'Номер подтверждения (сохраните его):'}),
        el('p', {'class':'direct-lead-receipt', text:receipt}),
        el('p', {text:'Ответим по указанному контакту. Для срочных вопросов можно написать на e-mail или в Telegram.'})
      ]);
      block.replaceChild(done, form);
      if (typeof window.auctionCROTrack === 'function') {
        window.auctionCROTrack('lead_direct_accepted', {source:source});
      }
    }
  }

  window.addEventListener('lead:draft-ready', function (event) {
    var kind = event.detail && event.detail.kind;
    if (kind !== 'lot' && kind !== 'search') return;
    getConfiguration().then(function (config) {
      if (config.enabled) showDirectForm(kind, config);
    });
  });
})();
