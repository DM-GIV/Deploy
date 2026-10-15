/* Pre-fills the lot-check form with the lot the visitor picked in the AI search.
 * Source: a same-origin, session-only hint written by /ai-poisk-lotov/ (no URL parameters, nothing is sent anywhere, nothing is submitted).
 * The value is re-validated here, only ever assigned to input.value, stays fully editable, and is used once. */
(function () {
  'use strict';
  var KEY = 'ta_prefill_lot';
  var TYPES = ['Недвижимость', 'Автомобиль', 'Спецтехника', 'Оборудование', 'Другое имущество'];
  function validUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 500) return null;
    try {
      var u = new URL(raw);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      if (u.hostname.indexOf('.') < 1 || /^[\d.]+$/.test(u.hostname) || u.hostname.indexOf(':') !== -1) return null;
      return u.href;
    } catch (e) { return null; }
  }
  function apply() {
    var field = document.getElementById('lot-url');
    if (!field) return;
    var hint = null;
    try { hint = JSON.parse(window.sessionStorage.getItem(KEY) || 'null'); window.sessionStorage.removeItem(KEY); } catch (e) { hint = null; }
    if (!hint || typeof hint !== 'object') return;
    var url = validUrl(hint.u);
    if (!url || field.value.trim()) return;
    field.value = url;
    var type = document.getElementById('asset-type');
    if (type && !type.value && TYPES.indexOf(hint.t) !== -1) type.value = hint.t;
    var note = document.createElement('p');
    note.className = 'tool-note prefill-note';
    note.setAttribute('role', 'status');
    note.textContent = 'Ссылка подставлена из результатов поиска — при необходимости измените её.';
    if (field.parentNode) field.parentNode.appendChild(note);
    if (window.location.hash === '#lot-check-form') {
      var wrap = document.getElementById('lot-check-form');
      if (wrap && wrap.scrollIntoView) wrap.scrollIntoView();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
