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
          /^[A-Za-z0-9_-]{10,60}$/.test(config.siteKey || '')
          ? config : {enabled:false};
      }).catch(function () { return {enabled:false}; });
    }
    return configRequest;
  }

  function loadCaptcha() {
    if (window.turnstile) return Promise.resolve();
    if (!scriptRequest) {
      scriptRequest = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
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
    active[kind] = true;
    loadCaptcha().then(function () {
      if (!window.turnstile) throw new Error('captcha unavailable');
      widgetId = window.turnstile.render(block.querySelector('.direct-lead-challenge'), {
        sitekey:config.siteKey,
        callback:function (value) { token = value; submit.disabled = false; status.textContent = ''; },
        'expired-callback':function () { token = ''; submit.disabled = true; status.textContent = 'Пройдите проверку от спама повторно.'; },
        'error-callback':function () { token = ''; submit.disabled = true; status.textContent = 'Проверка от спама недоступна. Можно отправить обращение по e-mail или через ТГ.'; }
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
      submit.disabled = true;
      status.textContent = 'Передаю заявку. Не закрывайте эту страницу до результата.';
      try {
        var response = await fetch('/api/lead', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          credentials:'same-origin', cache:'no-store',
          body:JSON.stringify({
            kind:kind, contact:contact.value.trim(), message:message,
            consent:true, privacyVersion:'2026-10-11',
            website:form.elements.namedItem('website').value,
            turnstileToken:token
          })
        });
        var body = await response.json().catch(function () { return null; });
        if (!response.ok || !body || body.ok !== true || body.code !== 'ACCEPTED') {
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
        if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
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
