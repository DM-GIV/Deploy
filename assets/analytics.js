/* ТоргАтлас: self-hosted Umami, consent-gated and disabled by default.
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

  function writeConsent(value) {
    try { window.localStorage.setItem(CONSENT_KEY, value); }
    catch (_) {}
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

  function renderConsentBanner() {
    if (!WEBSITE_ID || readConsent() || privacySignalEnabled()) return;

    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Статистика посещений');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;background:#071c2e;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)';
    box.innerHTML = '<p style="margin:0 0 10px">С вашего согласия собираем статистику посещений через Umami на нашем сервере, без cookie и передачи третьим лицам. Контакты и тексты заявок не передаём. <a href="/privacy/" style="color:#9fd0ff">Подробнее</a></p>' +
      '<button type="button" data-analytics-accept style="min-height:44px;padding:0 18px;border:0;border-radius:8px;background:#f5b942;color:#071c2e;font-weight:700;cursor:pointer">Принять</button> ' +
      '<button type="button" data-analytics-decline style="min-height:44px;padding:0 18px;border:1px solid #6b7f92;border-radius:8px;background:transparent;color:#fff;cursor:pointer">Отказаться</button>';

    if (window.matchMedia && window.matchMedia('(max-width: 600px)').matches) { box.style.cssText += ';padding:10px 12px;font-size:12px;line-height:1.4;bottom:8px;left:8px;right:8px'; }

    box.querySelector('[data-analytics-accept]').addEventListener('click', function () {
      writeConsent('accepted');
      box.remove();
      loadUmami();
    });
    box.querySelector('[data-analytics-decline]').addEventListener('click', function () {
      writeConsent('declined');
      box.remove();
    });
    document.body.appendChild(box);
  }

  if (!WEBSITE_ID) return;

  window.addEventListener('auction:funnel', handleFunnel);

  if (privacySignalEnabled()) return;
  if (readConsent() === 'accepted') loadUmami();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderConsentBanner, { once: true });
  } else {
    renderConsentBanner();
  }
})();
