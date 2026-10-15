/* Progressive enhancement for long articles. Without JavaScript every section is still a native <details> whose full text is in the HTML. */
(function () {
  'use strict';
  var sections = Array.prototype.slice.call(document.querySelectorAll('details.art-sec'));
  if (!sections.length) return;
  var tools = document.querySelector('[data-art-tools]');
  if (tools) tools.hidden = false;
  function setAll(open) { sections.forEach(function (d) { d.open = open; }); }
  var expand = document.querySelector('[data-expand-all]');
  var collapse = document.querySelector('[data-collapse-all]');
  if (expand) expand.addEventListener('click', function () { setAll(true); });
  if (collapse) collapse.addEventListener('click', function () { setAll(false); });
  // A plan link or a hash in the URL opens the section it points to.
  function openFromHash() {
    var id = decodeURIComponent((window.location.hash || '').slice(1));
    var target = id ? document.getElementById(id) : null;
    if (target && target.tagName === 'DETAILS') { target.open = true; target.scrollIntoView(); }
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
})();
