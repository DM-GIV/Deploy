/* ТоргАтлас: Yandex Metrika, consent-gated and disabled by default.
 * COUNTER_ID = 0 means: no provider script, no consent UI, no storage writes, no goals.
 * Activation is a separate reviewed release after the owner supplies the counter ID.
 */
(function () {
  'use strict';

  var COUNTER_ID = 0;
  var CONSENT_KEY = 'ta_analytics_consent';
  var ALLOWED_GOALS = {
    lot_check_complete: true,
    search_brief_complete: true,
    lead_handoff_opened: true,
    funnel_contact_open: true,
    lead_direct_accepted: true
  };
  var queue = [];
  var ready = false;

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

  function isAllowedGoal(name) {
    return typeof name === 'string' && ALLOWED_GOALS[name] === true;
  }

  function goal(name) {
    if (!COUNTER_ID || !ready || privacySignalEnabled() || !isAllowedGoal(name)) return;
    if (typeof window.ym === 'function') window.ym(COUNTER_ID, 'reachGoal', name);
  }

  function flushQueue() {
    queue.splice(0).forEach(goal);
  }

  function loadMetrika() {
    if (!COUNTER_ID || ready || privacySignalEnabled()) return;
    ready = true;

    window.ym = window.ym || function () {
      (window.ym.a = window.ym.a || []).push(arguments);
    };
    window.ym.l = Date.now();

    if (!document.querySelector('script[data-torgatlas-metrika]')) {
      var script = document.createElement('script');
      script.async = true;
      script.src = 'https://mc.yandex.ru/metrika/tag.js';
      script.setAttribute('data-torgatlas-metrika', '1');
      document.head.appendChild(script);
    }

    window.ym(COUNTER_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
      trackHash: false,
      ecommerce: false
    });
    flushQueue();
  }

  function handleFunnel(event) {
    if (!COUNTER_ID || privacySignalEnabled()) return;
    var name = event && event.detail && event.detail.event;
    if (!isAllowedGoal(name)) return;
    if (ready) goal(name);
    else if (queue.length < 30) queue.push(name);
  }

  function renderConsentBanner() {
    if (!COUNTER_ID || readConsent() || privacySignalEnabled()) return;

    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Статистика посещений');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;background:#071c2e;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)';
    box.innerHTML = '<p style="margin:0 0 10px">Мы используем Яндекс Метрику, чтобы понимать, какие страницы полезны. Она использует cookie и не получает текст ваших обращений. <a href="/privacy/" style="color:#9fd0ff">Подробнее</a></p>' +
      '<button type="button" data-analytics-accept style="min-height:44px;padding:0 18px;border:0;border-radius:8px;background:#f5b942;color:#071c2e;font-weight:700;cursor:pointer">Принять</button> ' +
      '<button type="button" data-analytics-decline style="min-height:44px;padding:0 18px;border:1px solid #6b7f92;border-radius:8px;background:transparent;color:#fff;cursor:pointer">Отказаться</button>';

    box.querySelector('[data-analytics-accept]').addEventListener('click', function () {
      writeConsent('accepted');
      box.remove();
      loadMetrika();
    });
    box.querySelector('[data-analytics-decline]').addEventListener('click', function () {
      writeConsent('declined');
      box.remove();
    });
    document.body.appendChild(box);
  }

  if (!COUNTER_ID) return;

  window.addEventListener('auction:funnel', handleFunnel);

  if (privacySignalEnabled()) return;
  if (readConsent() === 'accepted') loadMetrika();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderConsentBanner, { once: true });
  } else {
    renderConsentBanner();
  }
})();
