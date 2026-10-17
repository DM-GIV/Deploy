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
  // Nothing is pre-ticked; every service is stored under its own key; assets/metrika.js starts only on 'ta:metrika-consent'.
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

  function saveChoice(umami, metrika) {
    var hadUmami = readKey(CONSENT_KEY) === 'accepted';
    var hadMetrika = readKey(METRIKA_KEY) === 'accepted';
    writeKey(CONSENT_KEY, umami ? 'accepted' : 'declined');
    writeKey(METRIKA_KEY, metrika ? 'accepted' : 'declined');
    if (banner) { banner.remove(); banner = null; }
    if ((hadUmami && !umami) || (hadMetrika && !metrika)) {
      // Withdrawal: tags already running on this page cannot be unloaded, so remove Metrika cookies and reload without them.
      if (hadMetrika && !metrika) clearMetrikaCookies();
      try { window.location.reload(); } catch (_) {}
      return;
    }
    if (umami) loadUmami();
    if (metrika && !hadMetrika) {
      try { window.dispatchEvent(new CustomEvent('ta:metrika-consent')); } catch (_) {}
    }
  }

  function renderConsentBanner(force) {
    if (!WEBSITE_ID || privacySignalEnabled() || banner) return;
    if (!force && readKey(CONSENT_KEY) && readKey(METRIKA_KEY)) return;

    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Настройки аналитики');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:600px;margin:0 auto;background:#071c2e;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3);max-height:88vh;overflow:auto';
    var btn = 'min-height:44px;padding:0 16px;border-radius:8px;cursor:pointer;margin:4px 6px 0 0;';
    box.innerHTML = '<p style="margin:0 0 8px"><strong>Статистика посещений.</strong> Выберите, какие сервисы разрешить. Сайт работает и при отказе. Контакты и тексты заявок в статистику не передаём. <a href="/privacy/" style="color:#9fd0ff">Подробнее</a></p>' +
      '<label style="display:block;margin:6px 0"><input type="checkbox" data-consent-umami> Umami — наша статистика на нашем сервере, без cookie и без передачи третьим лицам</label>' +
      '<label style="display:block;margin:6px 0"><input type="checkbox" data-consent-metrika> Яндекс Метрика — сервис ООО «Яндекс»: cookie и сведения о посещённых страницах и обращениях; запись экрана (Вебвизор) не ведётся</label>' +
      '<button type="button" data-analytics-all style="' + btn + 'border:0;background:#f5b942;color:#071c2e;font-weight:700">Принять всё</button>' +
      '<button type="button" data-analytics-save style="' + btn + 'border:1px solid #9fd0ff;background:transparent;color:#fff">Сохранить выбор</button>' +
      '<button type="button" data-analytics-none style="' + btn + 'border:1px solid #6b7f92;background:transparent;color:#fff">Отказаться от всего</button>';

    if (window.matchMedia && window.matchMedia('(max-width: 600px)').matches) { box.style.cssText += ';padding:10px 12px;font-size:12px;line-height:1.4;bottom:8px;left:8px;right:8px'; }

    var cu = box.querySelector('[data-consent-umami]');
    var cm = box.querySelector('[data-consent-metrika]');
    cu.checked = readKey(CONSENT_KEY) === 'accepted';
    cm.checked = readKey(METRIKA_KEY) === 'accepted';
    box.querySelector('[data-analytics-all]').addEventListener('click', function () { saveChoice(true, true); });
    box.querySelector('[data-analytics-none]').addEventListener('click', function () { saveChoice(false, false); });
    box.querySelector('[data-analytics-save]').addEventListener('click', function () { saveChoice(cu.checked === true, cm.checked === true); });
    banner = box;
    document.body.appendChild(box);
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
