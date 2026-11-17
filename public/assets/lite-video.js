(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-video-load]') : null;
    if (!button) return;
    var block = button.closest('.lite-video');
    var url = block && block.getAttribute('data-video-url');
    var title = block && block.getAttribute('data-video-title');
    if (!url || !/^https:\/\//.test(url)) return;
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.title = title || 'Видеопояснение';
    frame.loading = 'lazy';
    frame.allow = 'fullscreen; picture-in-picture';
    frame.setAttribute('allowfullscreen', '');
    button.parentNode.replaceChild(frame, button);
    frame.focus();
  });
})();
