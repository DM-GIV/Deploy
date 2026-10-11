/* Копирование номера для MAX: ссылки на профиль нет, посетитель находит контакт в MAX по номеру. */
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    var text = b.getAttribute('data-copy');
    var val = b.querySelector('.contact-value');
    var old = val ? val.textContent : '';
    function done(ok) {
      if (val) { val.textContent = ok ? 'Номер скопирован — найдите нас в MAX' : 'Скопируйте вручную: ' + text; setTimeout(function () { val.textContent = old; }, 2500); }
      if (typeof window.auctionCROTrack === 'function') window.auctionCROTrack('funnel_contact_open', { channel: 'max' });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });
})();
