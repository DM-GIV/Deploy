/* ТоргАтлас: Яндекс Метрика (счётчик 113657048), disabled by default and consent-gated.
 * METRIKA_ENABLED = false means: no banner, no storage reads/writes, no listeners, no requests to mc.yandex.ru.
 * When enabled, the tag is loaded only AFTER the visitor accepts (own consent key, separate from Umami); no consent, GPC or DNT = zero requests.
 * Based on the official snippet from the counter settings, adapted for privacy: page URL and referrer are sent without query/hash
 * (lot links and prefilled forms live in the query), link tracking is off, Webvisor and ecommerce are not enabled.
 * The official <noscript><img> pixel is intentionally NOT used: it would call mc.yandex.ru without consent.
 * Goals are fed only from the site's closed funnel event bus ('auction:funnel'); no parameters, contacts or free text are ever sent.
 */
(function () {
  'use strict';

  var METRIKA_ENABLED = false; // owner decision: flip together with the privacy-policy update (see docs/METRIKA_001_RELEASE.md)
  var COUNTER_ID = 113657048;
  var TAG_URL = 'https://mc.yandex.ru/metrika/tag.js?id=' + COUNTER_ID;
  var CONSENT_KEY = 'ta_metrika_consent';
  // Funnel event on the site bus -> Metrika goal identifier. Anything not listed is never sent.
  var GOALS = {
    ai_search_start: 'ai_search_submit',
    ai_search_results: 'ai_search_results',
    ai_source_click: 'lot_source_click',
    lead_direct_started: 'lead_form_start',
    lead_direct_accepted: 'lead_submit_success',
    funnel_contact_open: 'contact_click'
  };
  var started = false;

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

  function cleanUrl(value) {
    try {
      var u = new URL(value, window.location.href);
      return u.origin + u.pathname;
    } catch (_) { return window.location.origin + '/'; }
  }

  function startMetrika() {
    if (started || privacySignalEnabled()) return;
    started = true;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
      k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', TAG_URL, 'ym');

    var referrer = '';
    try { referrer = document.referrer ? new URL(document.referrer).origin + '/' : ''; } catch (_) {}
    window.ym(COUNTER_ID, 'init', {
      ssr: true,
      clickmap: true,
      referrer: referrer,
      url: cleanUrl(window.location.href),
      accurateTrackBounce: true,
      trackLinks: false
    });
  }

  function onFunnel(event) {
    if (!started || privacySignalEnabled() || readConsent() !== 'accepted') return;
    var name = event && event.detail && event.detail.event;
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(GOALS, name)) return;
    window.ym(COUNTER_ID, 'reachGoal', GOALS[name]);
  }

  function renderConsentBanner() {
    if (readConsent() || privacySignalEnabled()) return;
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Яндекс Метрика');
    box.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:9999;max-width:560px;margin:0 auto;background:#071c2e;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)';
    box.innerHTML = '<p style="margin:0 0 10px">С вашего согласия измеряем посещения и обращения с помощью сервиса Яндекс Метрика (ООО «Яндекс»): используются cookie и данные о просмотренных страницах. Контакты и тексты заявок не передаём, запись экрана не ведётся. <a href="/privacy/" style="color:#9fd0ff">Подробнее</a></p>' +
      '<button type="button" data-metrika-accept style="min-height:44px;padding:0 18px;border:0;border-radius:8px;background:#f5b942;color:#071c2e;font-weight:700;cursor:pointer">Принять</button> ' +
      '<button type="button" data-metrika-decline style="min-height:44px;padding:0 18px;border:1px solid #6b7f92;border-radius:8px;background:transparent;color:#fff;cursor:pointer">Отказаться</button>';
    box.querySelector('[data-metrika-accept]').addEventListener('click', function () {
      writeConsent('accepted');
      box.remove();
      startMetrika();
    });
    box.querySelector('[data-metrika-decline]').addEventListener('click', function () {
      writeConsent('declined');
      box.remove();
    });
    document.body.appendChild(box);
  }

  if (!METRIKA_ENABLED || privacySignalEnabled()) return;

  window.addEventListener('auction:funnel', onFunnel);
  if (readConsent() === 'accepted') startMetrika();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderConsentBanner, { once: true });
  } else {
    renderConsentBanner();
  }
})();
