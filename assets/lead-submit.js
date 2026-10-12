/* Direct-lead UI: progressive enhancement. Completely hidden unless the
 * server confirms that recipient, consent and anti-spam are configured.
 * Nothing is sent from this script without explicit form submission.
 */
(function () {
  'use strict';
  var configRequest = null;
  var scriptRequest = null;
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
        return config && config.enabled === true &&
          /^[A-Za-z0-9_-]{10,160}$/.test(config.siteKey || '')
          ? config : {enabled:false};
      }).catch(function () { return {enabled:false}; });
    }
    return configRequest;
  }

  function loadCaptcha() {
    if (window.smartCaptcha) return Promise.resolve();
    if (!scriptRequest) {
      scriptRequest = new Promise(function (resolve, reject) {
        var callbackName = 'torgatlasSmartCaptchaReady';
        var script = document.createElement('script');
        window[callbackName] = function () { resolve(); };
        script.src = 'https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=' + callbackName;
        script.async = true;
        script.onload = function () {
          if (window.smartCaptcha) resolve();
          else reject(new Error('SmartCaptcha API unavailable'));
        };
        script.onerror = function () { reject(new Error('SmartCaptcha script unavailable')); };
        document.head.appendChild(script);
      });
    }
    return scriptRequest;
  }

  function showDirectForm(kind, config) {
    var preview = document.getElementById(kind + '-handoff-preview');
    var textarea = document.getElementById(kind + '-handoff-text');
    if (!preview || !textarea || !config.enabled || active[kind]) return;
    var block = document.createElement('div');
    block.className = 'direct-lead';
    block.innerHTML =
      '<h4>Отправить заявку напрямую</h4>' +
      '<p>После подтверждения заявка поступит обработчику. Отправка только по нажатию кнопки.</p>' +
      '<form class="direct-lead-form">' +
      '<label>Контакт для ответа *<input name="contact" type="text" minlength="5" maxlength="180" required autocomplete="email" placeholder="Телефон, ТГ, MAX или e-mail"></label>' +
      '<div class="direct-lead-trap" aria-hidden="true"><label>Ваш сайт<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<label class="direct-lead-consent"><input type="checkbox" name="consent" required> Согласен на обработку контактных данных и текста заявки для получения ответа. <a href="/privacy/" target="_blank" rel="noopener">Информация об обработке данных</a></label>' +
      '<div class="direct-lead-challenge" aria-label="Проверка защиты от спама"></div>' +
      '<button class="button button-primary" type="submit" disabled>Отправить заявку</button>' +
      '<div class="form-status direct-lead-status" role="status" aria-live="polite"></div>' +
      '</form>';
    preview.appendChild(block);
    var form = block.querySelector('form');
    var contact = form.elements.namedItem('contact');
    var prevContact = document.getElementById(kind === 'lot' ? 'contact' : 'search-contact');
    if (prevContact && prevContact.value.trim()) contact.value = prevContact.value.trim().slice(0,180);
    var status = block.querySelector('.direct-lead-status');
    var submit = form.querySelector('[type="submit"]');
    var token = '';
    var widgetId = null;
    var requestId = '';
    active[kind] = true;
    loadCaptcha().then(function () {
      if (!window.smartCaptcha || typeof window.smartCaptcha.subscribe !== 'function') throw new Error('captcha unavailable');
      widgetId = window.smartCaptcha.render(block.querySelector('.direct-lead-challenge'), {
        sitekey: config.siteKey,
        callback: function (value) { token = value; submit.disabled = !value; status.textContent = ''; }
      });
      window.smartCaptcha.subscribe(widgetId, 'token-expired', function () {
        token = ''; submit.disabled = true;
        status.textContent = '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043e\u0442 \u0441\u043f\u0430\u043c\u0430 \u0438\u0441\u0442\u0435\u043a\u043b\u0430. \u041f\u0440\u043e\u0439\u0434\u0438\u0442\u0435 \u0435\u0451 \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e.';
      });
      window.smartCaptcha.subscribe(widgetId, 'network-error', function () {
        token = ''; submit.disabled = true;
        status.textContent = '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043e\u0442 \u0441\u043f\u0430\u043c\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u0422\u0413, MAX \u0438\u043b\u0438 e-mail.';
      });
    }).catch(function () {
      status.textContent = 'Прямая отправка пока недоступна: не загрузилась проверка от спама. Сохраните обращение через ТГ или e-mail.';
      submit.disabled = true;
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!token || !form.reportValidity()) return;
      var message = textarea.value.trim();
      if (message.length < 40 || message.length > 6000) {
        status.textContent = 'Длина сообщения должна быть от 40 до 6000 символов. При необходимости сократите текст.';
        return;
      }
      if (!requestId) {
        if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
          status.textContent = '\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u0430\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u0422\u0413, MAX \u0438\u043b\u0438 e-mail.';
          return;
        }
        requestId = window.crypto.randomUUID();
      }
      submit.disabled = true;
      status.textContent = 'Передаю заявку. Не закрывайте эту страницу до результата.';
      try {
        var response = await fetch('/api/lead', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          credentials:'same-origin', cache:'no-store',
          body:JSON.stringify({
            id:requestId, kind:kind, contact:contact.value.trim(), message:message,
            consent:true, privacyVersion:'2026-10-11',
            website:form.elements.namedItem('website').value,
            captchaToken:token
          })
        });
        var body = await response.json().catch(function () { return null; });
        if (!response.ok || !body || body.ok !== true || body.code !== 'ACCEPTED' ||
            body.accepted !== true || body.id !== requestId || body.receipt !== requestId) {
          throw new Error('delivery not confirmed');
        }
        status.textContent = 'Заявка принята обработчиком. Номер подтверждения: ' + body.receipt + '. Сохраните его.';
        form.querySelectorAll('input').forEach(function (el) { el.disabled = true; });
        if (typeof window.auctionCROTrack === 'function') {
          window.auctionCROTrack('lead_direct_accepted', {source:kind === 'lot' ? 'lot_check' : 'search_brief'});
        }
      } catch (_) {
        status.textContent = 'Не удалось подтвердить приём заявки. Ваш текст сохранён на странице; используйте e-mail или ТГ, либо повторите попытку.';
        if (typeof window.auctionCROTrack === 'function') {
          window.auctionCROTrack('lead_direct_unconfirmed', {source:kind === 'lot' ? 'lot_check' : 'search_brief'});
        }
        token = '';
        if (widgetId !== null && window.smartCaptcha) window.smartCaptcha.reset(widgetId);
      } finally {
        if (!status.textContent.includes('Заявка принята')) submit.disabled = !token;
      }
    });
  }

  window.addEventListener('lead:draft-ready', function (event) {
    var kind = event.detail && event.detail.kind;
    if (kind !== 'lot' && kind !== 'search') return;
    getConfiguration().then(function (config) {
      if (config.enabled) showDirectForm(kind, config);
    });
  });
})();
