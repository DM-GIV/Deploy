/* ТоргАтлас: Яндекс Метрика (счётчик 113657048), disabled by default and consent-gated.
 * The tag is loaded only AFTER the visitor accepts Metrika in the single analytics banner (assets/analytics.js, own key ta_metrika_consent,
 * independent from Umami); no consent, GPC or DNT = zero requests. METRIKA_ENABLED = false is the kill switch (no listeners, no storage reads).
 * Based on the official snippet from the counter settings, adapted for privacy: page URL and referrer are sent without query/hash
 * (lot links and prefilled forms live in the query), link tracking is off, Webvisor and ecommerce are not enabled.
 * Before the tag starts the address bar loses its query and non-anchor fragment, because click-map and goal hits send the real address.
 * The official <noscript><img> pixel is intentionally NOT used: it would call mc.yandex.ru without consent.
 * Goals are fed only from the site's closed funnel event bus ('auction:funnel'); no parameters, contacts or free text are ever sent.
 */
(function () {
  'use strict';

  var METRIKA_ENABLED = true;
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

  function cleanUrl(value) {
    try {
      var u = new URL(value, window.location.href);
      return u.origin + u.pathname;
    } catch (_) { return window.location.origin + '/'; }
  }

  // The counter reads the real address for click-map and goal hits (page-url / page-ref), ignoring the sanitised init url.
  // The site itself never reads query parameters, so before the counter starts drop the query and any fragment that is not an
  // in-page anchor (an element id) from the address bar. Known anchors such as #lot-check-form stay.
  function sanitizeAddress() {
    try {
      var loc = window.location;
      var hash = loc.hash || '';
      var keepHash = hash.length > 1 && /^#[A-Za-z0-9_-]{1,64}$/.test(hash) && !!document.getElementById(hash.slice(1));
      if (loc.search || (hash && !keepHash)) window.history.replaceState(window.history.state, '', loc.pathname + (keepHash ? hash : ''));
    } catch (_) {}
  }

  function startMetrika() {
    if (started || privacySignalEnabled()) return;
    started = true;
    sanitizeAddress();
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

  if (!METRIKA_ENABLED || privacySignalEnabled()) return;

  window.addEventListener('auction:funnel', onFunnel);
  // Fired by the banner right after the visitor accepts (the choice is already stored).
  window.addEventListener('ta:metrika-consent', function () { if (readConsent() === 'accepted') startMetrika(); });
  if (readConsent() === 'accepted') startMetrika();
})();
