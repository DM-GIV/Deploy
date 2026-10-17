import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/metrika.js', import.meta.url), 'utf8');
const disabledSource = source.replace('METRIKA_ENABLED = true', 'METRIKA_ENABLED = false');

function harness({ code = source, consent = null, gpc = false, dnt = '0', url = 'https://torgatlas.ru/proverka-lota/?lot=https%3A%2F%2Fx.ru%2F1&phone=79990000000#a', referrer = 'https://yandex.ru/search?text=secret' } = {}) {
  const listeners = new Map();
  const inserted = [];
  const storage = new Map();
  if (consent !== null) storage.set('ta_metrika_consent', consent);
  let storageTouched = 0;
  const anchor = { parentNode: { insertBefore(node) { inserted.push(node); } } };
  const document = {
    referrer, scripts: [],
    createElement: tag => ({ tagName: tag.toUpperCase() }),
    getElementsByTagName: () => [anchor]
  };
  const window = {
    location: new URL(url), document,
    localStorage: { getItem(k) { storageTouched++; return storage.has(k) ? storage.get(k) : null; }, setItem(k, v) { storageTouched++; storage.set(k, v); } },
    addEventListener(type, fn) { listeners.set(type, fn); }
  };
  const navigator = { globalPrivacyControl: gpc, doNotTrack: dnt };
  vm.runInNewContext(code, { window, document, navigator, URL, Object, Date });
  const calls = () => (window.ym && window.ym.a ? window.ym.a.map(a => Array.from(a)) : []);
  const fire = name => listeners.get('auction:funnel')?.({ detail: { event: name, channel: 'email', source: 'x', contact: 'a@b.ru' } });
  return { window, inserted, storage, calls, fire, listeners, touched: () => storageTouched };
}

test('disabled by default: no listeners, banner, storage or requests', () => {
  const h = harness({ code: disabledSource, consent: 'accepted' });
  assert.equal(h.listeners.size, 0);
  assert.equal(h.touched(), 0);
  assert.equal(h.window.ym, undefined);
  assert.equal(h.inserted.length, 0);
});

test('enabled without consent: no ym, no tag, goals ignored', () => {
  const h = harness();
  assert.equal(h.window.ym, undefined);
  h.fire('lead_direct_accepted');
  assert.equal(h.inserted.length, 0);
  assert.equal(h.window.ym, undefined);
});

test('GPC and DNT: nothing happens even with stored consent', () => {
  for (const o of [{ gpc: true }, { dnt: '1' }]) {
    const h = harness({ ...o, consent: 'accepted' });
    assert.equal(h.window.ym, undefined);
    assert.equal(h.inserted.length, 0);
  }
});

test('declined consent: no tag', () => {
  const h = harness({ consent: 'declined' });
  assert.equal(h.window.ym, undefined);
});

test('accepted: single init with sanitized url/referrer, no webvisor/ecommerce/trackLinks', () => {
  const h = harness({ consent: 'accepted' });
  assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0].src, 'https://mc.yandex.ru/metrika/tag.js?id=113657048');
  const [init] = h.calls();
  assert.equal(JSON.stringify(init.slice(0, 2)), JSON.stringify([113657048, 'init']));
  const p = init[2];
  assert.equal(p.url, 'https://torgatlas.ru/proverka-lota/');
  assert.equal(p.referrer, 'https://yandex.ru/');
  assert.equal(p.trackLinks, false);
  assert.equal(p.webvisor, undefined);
  assert.equal(p.ecommerce, undefined);
  assert.equal(h.calls().length, 1);
});

test('consent event from the banner starts exactly once; withdrawn state does not start', () => {
  const h = harness();
  h.storage.set('ta_metrika_consent', 'accepted');
  h.listeners.get('ta:metrika-consent')();
  h.listeners.get('ta:metrika-consent')();
  assert.equal(h.inserted.length, 1);
  assert.equal(h.calls().length, 1);
  const n = harness();
  n.storage.set('ta_metrika_consent', 'declined');
  n.listeners.get('ta:metrika-consent')();
  assert.equal(n.inserted.length, 0);
});

test('goal mapping: exact identifiers, no params, unknown events dropped', () => {
  const h = harness({ consent: 'accepted' });
  const map = {
    ai_search_start: 'ai_search_submit', ai_search_results: 'ai_search_results', ai_source_click: 'lot_source_click',
    lead_direct_started: 'lead_form_start', lead_direct_accepted: 'lead_submit_success', funnel_contact_open: 'contact_click'
  };
  for (const k of Object.keys(map)) h.fire(k);
  for (const k of ['lead_direct_unconfirmed', 'funnel_page_open', 'ai_search_empty', 'lot_check_complete']) h.fire(k);
  const goals = h.calls().slice(1);
  assert.equal(JSON.stringify(goals), JSON.stringify(Object.values(map).map(g => [113657048, 'reachGoal', g])));
  assert.ok(goals.every(g => g.length === 3), 'no params / PII');
});
