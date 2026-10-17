import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const copyCode = fs.readFileSync('assets/contact-copy.js', 'utf8');
const funnelCode = fs.readFileSync('assets/funnel-events.js', 'utf8');

// Both real scripts on one page: a click on `attrs` (an <a href> or a <button>) must produce exactly one funnel_contact_open.
function click(attrs, { withCopy = true } = {}) {
  const listeners = [];
  const events = [];
  const node = {
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
    closest(selector) {
      const wanted = selector.split(',').map(x => x.trim());
      if (wanted.includes('a')) return attrs.href !== undefined ? this : null;
      if (wanted.some(w => w === '[data-copy]' || w === '[data-copy-before-nav]')) return ('data-copy' in attrs || 'data-copy-before-nav' in attrs) ? this : null;
      if (selector.includes('.contact-panel')) return { querySelector: () => ({ textContent: '' }) };
      return null;
    }
  };
  const window = {
    location: { pathname: '/', origin: 'https://torgatlas.ru' },
    dispatchEvent(e) { events.push(e.detail); return true; }
  };
  const sandbox = {
    window, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { addEventListener(type, fn) { if (type === 'click') listeners.push(fn); } },
    navigator: { clipboard: { writeText: () => Promise.resolve() } }, Object, Array, String
  };
  vm.runInNewContext(funnelCode, sandbox);
  if (withCopy) vm.runInNewContext(copyCode, sandbox);
  events.length = 0; // ignore funnel_page_open
  for (const fn of listeners) fn({ target: node, preventDefault() {} });
  return events.filter(e => e.event === 'funnel_contact_open');
}

test('tel link with copy-before-nav: one click, one event, channel phone', () => {
  const e = click({ href: 'tel:+79800512327', 'data-copy-before-nav': '+79800512327', 'data-channel': 'phone' });
  assert.equal(e.length, 1);
  assert.equal(e[0].channel, 'phone');
});

test('mailto link with copy-before-nav: one event, channel email', () => {
  const e = click({ href: 'mailto:dmitry.g.iv@yandex.ru', 'data-copy-before-nav': 'x', 'data-channel': 'email' });
  assert.equal(e.length, 1);
  assert.equal(e[0].channel, 'email');
});

test('MAX copy button keeps its own semantics: one event, channel max', () => {
  const e = click({ 'data-copy': '+79800512327', 'data-channel': 'max' });
  assert.equal(e.length, 1);
  assert.equal(e[0].channel, 'max'); // the closed Umami list drops it later; the semantic difference is kept on the bus
});

test('plain t.me, mailto and tel links without copy attributes are still reported once by funnel-events', () => {
  assert.equal(click({ href: 'https://t.me/torgatlas' }).length, 1);
  assert.equal(click({ href: 'mailto:a@b.ru' }).length, 1);
  assert.equal(click({ href: 'tel:+7000' }).length, 1);
  assert.equal(click({ href: '/blog/' }).length, 0);
});
