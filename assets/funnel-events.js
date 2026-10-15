/* Auction site: privacy-conscious funnel event hooks.
 * No cookies, IDs, local storage or network requests.
 * Events remain in dataLayer / DOM until an analytics provider is configured.
 */
(function () {
  'use strict';
  var routes = {
    '/':'home',
    '/proverka-lota/':'lot_check',
    '/poisk-imushchestva/':'property_search',
    '/ai-poisk-lotov/':'ai_lot_search',
    '/soprovozhdenie-torgov/':'auction_support',
    '/pokupka-imushchestva/':'purchase',
    '/primery-lotov/':'examples',
    '/formaty-raboty/':'service_formats',
    '/blog/kak-proverit-lot-pered-torgami/':'guide',
    '/blog/kak-uchastvovat-v-torgah-po-bankrotstvu/':'guide',
    '/blog/publichnoe-predlozhenie-bankrotstvo/':'guide',
    '/blog/zadatok-na-torgah-po-bankrotstvu/':'guide'
  };
  var stage = routes[window.location.pathname] || 'other';
  var propsAllowed = {
    source:true, channel:true, asset_type:true, goal:true, concern:true,
    reason:true, destination:true
  };
  function safeValue(value) {
    if (typeof value !== 'string') return null;
    // Only predefined field names, no free-text, URLs, phone numbers or budgets.
    if (value.length > 80 || /[:\/\\@?&#=\d]/.test(value)) return null;
    return value;
  }
  function track(name, props) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{1,55}$/.test(name)) return;
    var details = { page_type:stage };
    Object.keys(props || {}).forEach(function (key) {
      if (!propsAllowed[key]) return;
      var value = safeValue(props[key]);
      if (value !== null) details[key] = value;
    });
    var event = Object.assign({ event:name }, details);
    if (typeof window.gtag === 'function') {
      window.gtag('event',name,details);
    } else {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(event);
    }
    if (typeof window.plausible === 'function') window.plausible(name, { props:details });
    try {
      window.dispatchEvent(new CustomEvent('auction:funnel', { detail:event }));
    } catch (e) {}
  }
  window.auctionCROTrack = track;
  window.auctionFunnelStage = stage;
  track('funnel_page_open');
  document.addEventListener('click', function(e) {
    var link = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    var label = link.getAttribute('data-track');
    if (label) track(label);
    var dest = href.split('#')[0].split('?')[0];
    if (routes[dest] && dest !== window.location.pathname) {
      track('funnel_page_route', { destination:routes[dest] });
    }
    if (/^mailto:/i.test(href)) track('funnel_contact_open', { channel:'email' });
    else if (/^tel:/i.test(href)) track('funnel_contact_open', { channel:'phone' });
    else if (/^https:\/\/t\.me\//i.test(href)) track('funnel_contact_open', { channel:'telegram' });
  });
})();
