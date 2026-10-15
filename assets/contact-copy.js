/* Best-effort copy for confirmed contacts. Navigation remains the fallback. */
(function () {
  'use strict';
  function statusFor(node) {
    var panel = node.closest('.contact-panel, .contact-box, .contact');
    return panel ? panel.querySelector('[data-contact-status]') : null;
  }
  function announce(node, message) {
    var status = statusFor(node);
    if (status) status.textContent = message;
  }
  function copy(text, node, successMessage) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      announce(node, 'Копирование недоступно. Используйте действие выбранного приложения.');
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(text).then(function () {
      announce(node, successMessage || 'Контакт скопирован.');
      return true;
    }, function () {
      announce(node, 'Копирование не разрешено браузером. Используйте прямой переход.');
      return false;
    });
  }
  document.addEventListener('click', function (event) {
    var node = event.target && event.target.closest ? event.target.closest('[data-copy], [data-copy-before-nav]') : null;
    if (!node) return;
    var direct = node.getAttribute('data-copy');
    var beforeNav = node.getAttribute('data-copy-before-nav');
    var channel = node.getAttribute('data-channel') || 'contact';
    if (direct) {
      event.preventDefault();
      copy(direct, node, channel === 'max' ? 'Номер скопирован — найдите контакт в MAX.' : 'Контакт скопирован.');
    } else if (beforeNav) {
      copy(beforeNav, node, 'Контакт скопирован; открывается выбранное приложение.');
    }
    if (typeof window.auctionCROTrack === 'function') window.auctionCROTrack('funnel_contact_open', { channel: channel });
  });
})();
