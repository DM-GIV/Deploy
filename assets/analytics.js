/* ТоргАтлас: self-hosted Umami and the single consent banner (Umami + Yandex.Metrika, independent choices), consent-gated and disabled by default.
 * WEBSITE_ID = '' means: no tracker script, no consent UI, no storage reads/writes, no events.
 * The tracker is loaded from our own origin (/ta/s.js) only AFTER the visitor accepts; no consent, GPC or DNT = zero requests.
 * Only pageview (path, no query/hash) and the allowlisted funnel events are sent; never form data, contacts or free text.
 */
(function () {
  'use strict';

  var WEBSITE_ID = 'cf28be6b-9c2d-42de-ba95-8c4818e19435';
  var ENDPOINT_BASE = '/ta';
  var CONSENT_KEY = 'ta_analytics_consent';
  var DIRECT_LEADS_ENABLED = true; // flip together with the P3 direct-lead release
  var ALLOWED_EVENTS = {
    lot_check_complete: true,
    search_brief_complete: true,
    lead_handoff_opened: true,
    funnel_contact_open: true
  };
  // Only the contact channel may travel with an event, and only from this closed list (no URLs, numbers, addresses or text).
  var CHANNEL_EVENTS = { funnel_contact_open: true, lead_handoff_opened: true };
  var ALLOWED_CHANNELS = { email: true, telegram: true, phone: true };
  var queue = [];
  var loaded = false;
  var loading = false;

  function privacySignalEnabled() {
    return navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === '1' ||
      window.doNotTrack === '1';
  }

  function readConsent() {
    try { return window.localStorage.getItem(CONSENT_KEY); }
    catch (_) { return null; }
  }

  function isAllowedEvent(name) {
    if (typeof name !== 'string') return false;
    if (name === 'lead_direct_accepted') return DIRECT_LEADS_ENABLED === true;
    return ALLOWED_EVENTS[name] === true;
  }

  // Last line of defence, called by the tracker before every send: drop anything not allowlisted,
  // strip event data, query string and hash; keep only the origin of the referrer.
  window.taUmamiBeforeSend = function (type, payload) {
    if (!payload || privacySignalEnabled() || readConsent() !== 'accepted') return null;
    if (type !== 'event') return null; // no identify / performance payloads
    if (payload.name !== undefined && payload.name !== null && !isAllowedEvent(payload.name)) return null;
    var channel = payload.data && payload.data.channel;
    delete payload.data;
    if (payload.name && CHANNEL_EVENTS[payload.name] === true && typeof channel === 'string' && ALLOWED_CHANNELS[channel] === true) {
      payload.data = { channel: channel };
    }
    payload.title = '';
    try {
      payload.url = new URL(payload.url, window.location.href).pathname;
    } catch (_) { payload.url = '/'; }
    try {
      payload.referrer = payload.referrer ? new URL(payload.referrer, window.location.href).origin : '';
    } catch (_) { payload.referrer = ''; }
    return payload;
  };

  function safeChannel(name, channel) {
    return CHANNEL_EVENTS[name] === true && typeof channel === 'string' && ALLOWED_CHANNELS[channel] === true ? channel : null;
  }

  function track(name, channel) {
    if (!WEBSITE_ID || !loaded || privacySignalEnabled() || !isAllowedEvent(name)) return;
    if (!window.umami || typeof window.umami.track !== 'function') return;
    var safe = safeChannel(name, channel);
    if (safe) window.umami.track(name, { channel: safe });
    else window.umami.track(name);
  }

  function flushQueue() {
    queue.splice(0).forEach(function (item) { track(item.name, item.channel); });
  }

  function loadUmami() {
    if (!WEBSITE_ID || loaded || loading || privacySignalEnabled()) return;
    loading = true;
    if (document.querySelector('script[data-torgatlas-umami]')) return;
    var script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = ENDPOINT_BASE + '/s.js';
    script.setAttribute('data-torgatlas-umami', '1');
    script.setAttribute('data-website-id', WEBSITE_ID);
    script.setAttribute('data-host-url', window.location.origin + ENDPOINT_BASE);
    script.setAttribute('data-do-not-track', 'true');
    script.setAttribute('data-exclude-search', 'true');
    script.setAttribute('data-exclude-hash', 'true');
    script.setAttribute('data-before-send', 'taUmamiBeforeSend');
    script.addEventListener('load', function () {
      loaded = true;
      loading = false;
      flushQueue();
    });
    script.addEventListener('error', function () { loading = false; });
    document.head.appendChild(script);
  }

  function handleFunnel(event) {
    if (!WEBSITE_ID || privacySignalEnabled()) return;
    var name = event && event.detail && event.detail.event;
    if (!isAllowedEvent(name)) return;
    var channel = event.detail.channel;
    if (loaded) track(name, channel);
    else if (readConsent() === 'accepted' && queue.length < 30) queue.push({ name: name, channel: channel });
  }

  // Single banner for two independent services: Umami (own server) and Yandex.Metrika (third party, cookies).
  // Metrika is visually preselected if no preference exists, but no tracking starts until a separate affirmative click; each service has its own key.
  var METRIKA_KEY = 'ta_metrika_consent';
  var banner = null;

  function readKey(key) {
    try { return window.localStorage.getItem(key); }
    catch (_) { return null; }
  }

  function writeKey(key, value) {
    try { window.localStorage.setItem(key, value); }
    catch (_) {}
  }

  function clearMetrikaCookies() {
    try {
      var host = window.location.hostname || '';
      var parts = host.split('.');
      var domains = ['', host];
      if (parts.length > 2) domains.push(parts.slice(-2).join('.'));
      if (parts.length > 1) domains.push('.' + parts.slice(-2).join('.'));
      (document.cookie || '').split(';').forEach(function (item) {
        var name = item.split('=')[0].trim();
        if (name.indexOf('_ym') !== 0) return;
        domains.forEach(function (d) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
        });
      });
    } catch (_) {}
  }

  function clearMetrikaStorage() {
    // Identifiers the counter keeps in the visitor's browser on our origin (names per Yandex's cookie-usage description).
    [window.localStorage, window.sessionStorage].forEach(function (store) {
      try {
        Object.keys(store).forEach(function (key) {
          if (key.indexOf('_ym') === 0 || key.indexOf('ytm_') === 0 || key === 'zz') store.removeItem(key);
        });
      } catch (_) {}
    });
  }

  // Local record of the choice (what was shown, when). It stays in this browser: it is not a server-side proof of consent.
  var BANNER_VERSION = '2026-10-17.3';
  function writeRecord(umami, metrika) {
    writeKey('ta_analytics_consent_record', JSON.stringify({ banner: BANNER_VERSION, at: new Date().toISOString(), umami: umami, metrika: metrika }));
  }

  function saveChoice(umami, metrika) {
    var hadUmami = readKey(CONSENT_KEY) === 'accepted';
    var hadMetrika = readKey(METRIKA_KEY) === 'accepted';
    writeKey(CONSENT_KEY, umami ? 'accepted' : 'declined');
    writeKey(METRIKA_KEY, metrika ? 'accepted' : 'declined');
    writeRecord(umami, metrika);
    if (banner) { banner.remove(); banner = null; }
    if ((hadUmami && !umami) || (hadMetrika && !metrika)) {
      // Withdrawal: tags already running on this page cannot be unloaded, so stop further collection: remove the Metrika cookies and
      // local identifiers reachable from this site and reload without the tag. Data Yandex already received is not deleted by this.
      if (hadMetrika && !metrika) { clearMetrikaCookies(); clearMetrikaStorage(); }
      try { window.location.reload(); } catch (_) {}
      return;
    }
    if (umami) loadUmami();
    if (metrika && !hadMetrika) {
      try { window.dispatchEvent(new CustomEvent('ta:metrika-consent')); } catch (_) {}
    }
  }

  // Calm, neutral banner. Colours (WCAG AA, checked in tests/metrika_static_test.py): text #1f2933 / #3e4c59 on #f6f7f9 and #fff,
  // accent #3e5c76 with white text, links #2f5d8a. System fonts only; the stylesheet lives inside the banner node.
  var BANNER_CSS = '.ta-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:620px;margin:0 auto;box-sizing:border-box;background:#f6f7f9;color:#1f2933;border:1px solid #cbd2d9;border-radius:10px;padding:14px 16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 2px 12px rgba(31,41,51,.12);max-height:88vh;overflow:auto}' +
    '.ta-consent *{box-sizing:border-box}.ta-consent p{margin:0 0 10px}.ta-consent a{color:#2f5d8a;text-decoration:underline}' +
    '.ta-consent label{display:flex;gap:10px;align-items:flex-start;margin:8px 0;padding:8px 10px;border:1px solid #d9dee3;border-radius:8px;background:#fff;cursor:pointer}' +
    '.ta-consent input[type=checkbox]{flex:none;width:20px;height:20px;margin:1px 0 0;accent-color:#3e5c76}' +
    '.ta-consent .ta-name{display:block;font-weight:600}.ta-consent .ta-note{display:block;color:#3e4c59}' +
    '.ta-consent .ta-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
    '.ta-consent button{min-height:44px;padding:0 16px;border-radius:8px;border:1px solid #52606d;background:#fff;color:#1f2933;font:inherit;cursor:pointer}' +
    '.ta-consent button:hover{background:#e4e7eb}.ta-consent button.ta-primary{background:#3e5c76;border-color:#3e5c76;color:#fff}.ta-consent button.ta-primary:hover{background:#334e68}' +
    '.ta-consent :focus-visible{outline:3px solid #1d4e89;outline-offset:2px}' +
    '@media (max-width:480px){.ta-consent{left:8px;right:8px;bottom:8px;padding:12px;font-size:13px}.ta-consent .ta-actions button{flex:1 1 100%}}';

  function renderConsentBanner(force) {
    if (!WEBSITE_ID || privacySignalEnabled() || banner) return;
    if (!force && readKey(CONSENT_KEY) && readKey(METRIKA_KEY)) return;

    var box = document.createElement('div');
    box.className = 'ta-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Настройки аналитики');
    box.setAttribute('tabindex', '-1');
    box.innerHTML = '<style>' + BANNER_CSS + '</style>' +
      '<p><strong>Статистика посещений.</strong> Оператор сайта — ИП Иванов Д. Г. До подтверждения выбора аналитика не запускается. Яндекс Метрика предварительно отмечена, но вы можете снять галочку либо полностью отказаться; сайт работает и при отказе. Контакты и тексты заявок в статистику не передаём. Выбор можно изменить в любой момент кнопкой «Настройки аналитики» внизу страницы. <a href="/privacy/#analytics">Подробная политика (раздел 9)</a></p>' +
      '<label><input type="checkbox" data-consent-umami><span><span class="ta-name">Umami</span><span class="ta-note">Наша статистика на нашем сервере, без cookie и без передачи третьим лицам.</span></span></label>' +
      '<label><input type="checkbox" data-consent-metrika><span><span class="ta-name">Яндекс Метрика</span><span class="ta-note">Сервис ООО «Яндекс», обрабатывает данные по поручению оператора: cookie и идентификаторы в браузере, сведения о страницах, источнике перехода и устройстве, IP-адрес. Запись экрана (Вебвизор) не ведётся.</span></span></label>' +
      '<div class="ta-actions">' +
      '<button type="button" class="ta-primary" data-analytics-save>Принять выбранное</button>' +
      '<button type="button" data-analytics-all>Принять всё</button>' +
      '<button type="button" data-analytics-none>Отказаться от всего</button></div>';

    var cu = box.querySelector('[data-consent-umami]');
    var cm = box.querySelector('[data-consent-metrika]');
    cu.checked = readKey(CONSENT_KEY) === 'accepted';
    cm.checked = readKey(METRIKA_KEY) !== 'declined';
    box.querySelector('[data-analytics-all]').addEventListener('click', function () { saveChoice(true, true); });
    box.querySelector('[data-analytics-none]').addEventListener('click', function () { saveChoice(false, false); });
    box.querySelector('[data-analytics-save]').addEventListener('click', function () { saveChoice(cu.checked === true, cm.checked === true); });
    if (force) {
      // Opened by the visitor from "Настройки аналитики": move focus into the dialog, Escape closes it without changing the choice.
      var opener = document.activeElement;
      box.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        box.remove(); banner = null;
        if (opener && typeof opener.focus === 'function') opener.focus();
      });
    }
    banner = box;
    document.body.appendChild(box);
    if (force && typeof box.focus === 'function') box.focus();
  }

  function addSettingsLink() {
    try {
      if (privacySignalEnabled() || document.querySelector('[data-analytics-settings]')) return;
      var footer = document.querySelector('footer .wrap') || document.querySelector('footer');
      if (!footer || typeof footer.appendChild !== 'function') return;
      var link = document.createElement('button');
      link.setAttribute('type', 'button');
      link.setAttribute('data-analytics-settings', '');
      link.textContent = 'Настройки аналитики';
      link.style.cssText = 'margin-left:12px;background:none;border:0;padding:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer';
      footer.appendChild(link);
    } catch (_) {}
  }

  if (!WEBSITE_ID) return;

  window.addEventListener('auction:funnel', handleFunnel);

  if (privacySignalEnabled()) return;
  document.addEventListener('click', function (event) {
    var t = event && event.target;
    if (t && typeof t.closest === 'function' && t.closest('[data-analytics-settings]')) renderConsentBanner(true);
  });
  if (readConsent() === 'accepted') loadUmami();

  function onReady() { renderConsentBanner(false); addSettingsLink(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})();
