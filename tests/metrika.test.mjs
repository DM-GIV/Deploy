import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/metrika.js', import.meta.url), 'utf8');
const enabledSource = source.replace('METRIKA_ENABLED = false', 'METRIKA_ENABLED = true');

function harness({ code = enabledSource, consent = null, gpc = false, dnt = '0', url = 'https://torgatlas.ru/proverka-lota/?lot=https%3A%2F%2Fx.ru%2F1&phone=79990000000#a', referrer = 'https://yandex.ru/search?text=secret' } = {}) {
  const listeners = new Map();
  const inserted = [];
  const storage = new Map();
  if (consent !== null) storage.set('ta_metrika_consent', consent);
  let storageTouched = 0;
  const buttons = {};
  const element = tag => ({
    tagName: tag.toUpperCase(), attrs: {}, style: {}, innerHTML: '', removed: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this._h = this._h || {}; this._h[type] = fn; },
    querySelector(sel) { return buttons[sel] = buttons[sel] || element(sel); },
    remove() { this.removed = true; },
    parentNode: { insertBefore(node) { inserted.push(node); } }
  });
  const banner = [];
  const document = {
    readyState: 'complete', referrer, scripts: [],
    createElement: element,
    getElementsByTagName: () => [element('script')],
    body: { appendChild(n) { banner.push(n); } },
    addEventListener() {}
  };
  const win = {
    location: new URL(url), navigator: { globalPrivacyControl: gpc, doNotTrack: dnt }, document,
    localStorage: { getItem(k) { storageTouched++; return storage.has(k) ? storage.get(k) : null; }, setItem(k, v) { storageTouched++; storage.set(k, v); } },
    addEventListener(type, fn) { listeners.set(type, fn); }, CustomEvent: class {},
  };
  win.window = win;
  const ctx = vm.createContext({ ...win, URL, Object, Date, navigator: win.navigator, document, window: win });
  win.URL = URL;
  vm.runInContext(code, ctx);
  const calls = () => (win.ym && win.ym.a ? win.ym.a.map(a => Array.from(a)) : []);
  const fire = name => listeners.get('auction:funnel')?.({ detail: { event: name, channel: 'email', source: 'x' } });
  return { win, inserted, banner, buttons, storage, calls, fire, listeners, touched: () => storageTouched };
}

test('disabled by default: no listeners, banner, storage or requests', () => {
  const h = harness({ code: source, consent: 'accepted' });
  assert.equal(h.listeners.size, 0);
  assert.equal(h.banner.length, 0);
  assert.equal(h.touched(), 0);
  assert.equal(h.win.ym, undefined);
  assert.equal(h.inserted.length, 0);
});

test('enabled without consent: banner only, no ym, goals ignored', () => {
  const h = harness();
  assert.equal(h.banner.length, 1);
  assert.equal(h.win.ym, undefined);
  h.fire('lead_direct_accepted');
  assert.equal(h.inserted.length, 0);
});

test('GPC and DNT: nothing happens even with stored consent', () => {
  for (const o of [{ gpc: true }, { dnt: '1' }]) {
    const h = harness({ ...o, consent: 'accepted' });
    assert.equal(h.win.ym, undefined);
    assert.equal(h.banner.length, 0);
    assert.equal(h.inserted.length, 0);
  }
});

test('declined consent: no tag', () => {
  const h = harness({ consent: 'declined' });
  assert.equal(h.win.ym, undefined);
  assert.equal(h.banner.length, 0);
});

test('accepted: single init with sanitized url/referrer, no webvisor/ecommerce/trackLinks', () => {
  const h = harness({ consent: 'accepted' });
  assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0].src, 'https://mc.yandex.ru/metrika/tag.js?id=113657048');
  const [init] = h.calls();
  assert.deepEqual(init.slice(0, 2), [113657048, 'init']);
  const p = init[2];
  assert.equal(p.url, 'https://torgatlas.ru/proverka-lota/');
  assert.equal(p.referrer, 'https://yandex.ru/');
  assert.equal(p.trackLinks, false);
  assert.equal(p.webvisor, undefined);
  assert.equal(p.ecommerce, undefined);
  assert.equal(h.calls().length, 1);
});

test('clicking accept starts exactly once and stores consent', () => {
  const h = harness();
  h.buttons['[data-metrika-accept]']._h.click();
  assert.equal(h.storage.get('ta_metrika_consent'), 'accepted');
  assert.equal(h.inserted.length, 1);
  h.buttons['[data-metrika-accept]']._h.click();
  assert.equal(h.inserted.length, 1);
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
  assert.deepEqual(goals, Object.values(map).map(g => [113657048, 'reachGoal', g]));
  assert.ok(goals.every(g => g.length === 3), 'no params / PII');
});
