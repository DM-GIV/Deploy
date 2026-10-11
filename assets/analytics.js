/* ТоргАтлас: подключение Яндекс Метрики с согласием посетителя.
 * Пока COUNTER_ID = 0 — ничего не загружается, баннер не показывается.
 * Чтобы включить: впишите номер счётчика владельца сайта (Метрика → Настройка → Счётчик).
 * Счётчик грузится только после нажатия «Принять». Вебвизор и запись форм выключены.
 * В Метрику уходят только имена событий воронки из funnel-events.js (без текстов, URL лотов,
 * контактов, бюджетов).
 */
(function () {
  'use strict';
  var COUNTER_ID = 0;
  var KEY = 'ta_analytics_consent';
  if (!COUNTER_ID) return;

  var queue = [];
  var ready = false;
  function store(v) { try { if (v) localStorage.setItem(KEY, v); return localStorage.getItem(KEY); } catch (e) { return null; } }
  function dnt() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  }
  function goal(name, params) {
    if (typeof window.ym === 'function') window.ym(COUNTER_ID, 'reachGoal', name, params || {});
  }
  function load() {
    if (ready) return;
    ready = true;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(COUNTER_ID, 'init', {
      clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false,
      trackHash: false, ecommerce: false
    });
    queue.splice(0).forEach(function (q) { goal(q.event, q.params); });
  }
  window.addEventListener('auction:funnel', function (e) {
    var d = e.detail || {};
    var name = d.event;
    if (!name) return;
    var params = {};
    Object.keys(d).forEach(function (k) { if (k !== 'event') params[k] = d[k]; });
    if (ready) goal(name, params); else if (queue.length < 30) queue.push({ event: name, params: params });
  });

  function banner() {
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Статистика посещений');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;background:#071c2e;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)';
    box.innerHTML = '<p style="margin:0 0 10px">Мы используем Яндекс Метрику, чтобы понимать, какие страницы полезны. Она использует cookie и не получает текст ваших обращений. <a href="/privacy/" style="color:#9fd0ff">Подробнее</a></p>' +
      '<button type="button" data-a="1" style="min-height:44px;padding:0 18px;border:0;border-radius:8px;background:#f5b942;color:#071c2e;font-weight:700;cursor:pointer">Принять</button> ' +
      '<button type="button" data-a="0" style="min-height:44px;padding:0 18px;border:1px solid #6b7f92;border-radius:8px;background:transparent;color:#fff;cursor:pointer">Отказаться</button>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      var yes = b.getAttribute('data-a') === '1';
      store(yes ? 'yes' : 'no');
      box.remove();
      if (yes) load();
    });
    document.body.appendChild(box);
  }
  function start() {
    if (dnt()) return;
    var c = store();
    if (c === 'yes') load();
    else if (c !== 'no') banner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();