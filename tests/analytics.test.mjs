import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const original = fs.readFileSync(new URL('../assets/analytics.js', import.meta.url), 'utf8');
const SITE_ID = 'cf28be6b-9c2d-42de-ba95-8c4818e19435';

function harness({websiteId=SITE_ID, consent=null, gpc=false, dnt='0', directLeads=false}={}) {
  const listeners = new Map();
  const scripts = [];
  const storage = new Map();
  let storageGets = 0;
  let storageSets = 0;
  if (consent !== null) storage.set('ta_analytics_consent', consent);

  function element(tag) {
    const handlers = {};
    return {
      tagName: tag.toUpperCase(), style: {}, attrs: {}, innerHTML: '', removed: false,
      setAttribute(k,v){ this.attrs[k]=v; },
      addEventListener(type, fn){ handlers[type]=fn; },
      querySelector(sel){ return element(sel); },
      remove(){ this.removed=true; },
      _handlers: handlers
    };
  }

  const document = {
    readyState: 'complete',
    head: { appendChild(node){ scripts.push(node); } },
    body: { appendChild(){} },
    createElement: element,
    querySelector(sel) {
      if (sel === 'script[data-torgatlas-umami]') return scripts.find(s => s.attrs['data-torgatlas-umami'] === '1') || null;
      return null;
    },
    addEventListener(type, fn){ listeners.set('document:'+type, fn); }
  };
  const tracked = []; const trackedData = [];
  const window = {
    doNotTrack: dnt,
    location: { origin: 'https://torgatlas.ru', href: 'https://torgatlas.ru/proverka-lota/?q=secret#x' },
    localStorage: {
      getItem(k){ storageGets++; return storage.has(k) ? storage.get(k) : null; },
      setItem(k,v){ storageSets++; storage.set(k,String(v)); }
    },
    addEventListener(type, fn){ listeners.set(type, fn); },
    umami: { track(name, data){ tracked.push(name); trackedData.push(data); } }
  };
  const navigator = { globalPrivacyControl:gpc, doNotTrack:dnt };
  let code = original.replace(/var WEBSITE_ID = '[^']*';/, "var WEBSITE_ID = '"+websiteId+"';");
  if (directLeads) code = code.replace('DIRECT_LEADS_ENABLED = false', 'DIRECT_LEADS_ENABLED = true');
  vm.runInNewContext(code, {window, document, navigator, URL, Date, console, setTimeout, clearTimeout});
  const fireLoad = () => scripts[0]._handlers.load();
  return {window, document, listeners, scripts, storage, tracked, trackedData, fireLoad, get storageGets(){return storageGets;}, get storageSets(){return storageSets;}};
}

test('disabled website id performs no analytics work', () => {
  const h = harness({websiteId:''});
  assert.equal(h.scripts.length, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.storageGets, 0);
  assert.equal(h.storageSets, 0);
});

test('no consent: no tracker script (zero requests)', () => {
  const h = harness({consent:null});
  assert.equal(h.scripts.length, 0);
  assert.equal(h.storageSets, 0);
});

test('declined consent: no tracker script', () => {
  assert.equal(harness({consent:'declined'}).scripts.length, 0);
});

test('GPC and DNT block tracker even with prior consent', () => {
  assert.equal(harness({consent:'accepted', gpc:true}).scripts.length, 0);
  assert.equal(harness({consent:'accepted', dnt:'1'}).scripts.length, 0);
});

test('accepted consent loads same-origin tracker once with privacy attributes', () => {
  const h = harness({consent:'accepted'});
  assert.equal(h.scripts.length, 1);
  const a = h.scripts[0];
  assert.equal(a.src, '/ta/s.js');
  assert.equal(a.attrs['data-website-id'], SITE_ID);
  assert.equal(a.attrs['data-host-url'], 'https://torgatlas.ru/ta');
  assert.equal(a.attrs['data-do-not-track'], 'true');
  assert.equal(a.attrs['data-exclude-search'], 'true');
  assert.equal(a.attrs['data-exclude-hash'], 'true');
});

test('allowlisted event is sent by name only; others ignored', () => {
  const h = harness({consent:'accepted'});
  h.fireLoad();
  h.listeners.get('auction:funnel')({detail:{event:'funnel_contact_open', contact:'secret@example.com', budget:'999'}});
  h.listeners.get('auction:funnel')({detail:{event:'free_text_event'}});
  h.listeners.get('auction:funnel')({detail:{event:'lead_direct_accepted'}});
  assert.deepEqual(h.tracked, ['funnel_contact_open']);
});

test('events before tracker load are queued then flushed', () => {
  const h = harness({consent:'accepted'});
  h.listeners.get('auction:funnel')({detail:{event:'lot_check_complete'}});
  assert.deepEqual(h.tracked, []);
  h.fireLoad();
  assert.deepEqual(h.tracked, ['lot_check_complete']);
});

test('lead_direct_accepted only when direct leads flag is on', () => {
  const h = harness({consent:'accepted', directLeads:true});
  h.fireLoad();
  h.listeners.get('auction:funnel')({detail:{event:'lead_direct_accepted'}});
  assert.deepEqual(h.tracked, ['lead_direct_accepted']);
});

test('before-send sanitises pageview and blocks bad payloads', () => {
  const h = harness({consent:'accepted'});
  const bs = h.window.taUmamiBeforeSend;
  const pv = bs('event', {url:'https://torgatlas.ru/proverka-lota/?lot=https://x/y&email=a@b.ru#h', referrer:'https://yandex.ru/search?q=foo', title:'T', data:{a:1}});
  assert.equal(pv.url, '/proverka-lota/');
  assert.equal(pv.referrer, 'https://yandex.ru');
  assert.equal(pv.title, '');
  assert.equal(pv.data, undefined);
  assert.equal(bs('event', {name:'email_typed', url:'/'}), null);
  assert.equal(bs('identify', {url:'/'}), null);
  assert.equal(bs('performance', {url:'/'}), null);
  assert.equal(bs('event', {name:'lot_check_complete', url:'/p/?x=1', data:{contact:'c'}}).data, undefined);
});

test('before-send blocks everything without consent', () => {
  const h = harness({consent:'declined'});
  assert.equal(h.window.taUmamiBeforeSend('event', {url:'/'}), null);
});

test('contact channel travels only from the closed list and only for contact events', () => {
  const h = harness({consent:'accepted'});
  h.fireLoad();
  const fire = d => h.listeners.get('auction:funnel')({detail:d});
  fire({event:'funnel_contact_open', channel:'telegram', contact:'+79990000000'});
  fire({event:'funnel_contact_open', channel:'+79990000000'});
  fire({event:'lead_handoff_opened', channel:'email', source:'lot_check'});
  fire({event:'lot_check_complete', channel:'email'});
  assert.deepEqual(h.tracked, ['funnel_contact_open','funnel_contact_open','lead_handoff_opened','lot_check_complete']);
  assert.equal(JSON.stringify(h.trackedData), JSON.stringify([{channel:'telegram'}, null, {channel:'email'}, null]));
});

test('queued contact events keep the safe channel after tracker load', () => {
  const h = harness({consent:'accepted'});
  h.listeners.get('auction:funnel')({detail:{event:'funnel_contact_open', channel:'phone'}});
  h.fireLoad();
  assert.equal(JSON.stringify(h.trackedData), JSON.stringify([{channel:'phone'}]));
});

test('before-send keeps only a safe channel in data', () => {
  const h = harness({consent:'accepted'});
  const bs = h.window.taUmamiBeforeSend;
  assert.equal(JSON.stringify(bs('event', {name:'funnel_contact_open', url:'/', data:{channel:'email', contact:'a@b.ru'}}).data), '{"channel":"email"}');
  assert.equal(bs('event', {name:'funnel_contact_open', url:'/', data:{channel:'a@b.ru'}}).data, undefined);
  assert.equal(bs('event', {name:'lot_check_complete', url:'/', data:{channel:'email'}}).data, undefined);
});
