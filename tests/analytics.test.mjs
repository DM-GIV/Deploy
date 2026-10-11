import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const original = fs.readFileSync(new URL('../assets/analytics.js', import.meta.url), 'utf8');

function harness({counterId=0, consent=null, gpc=false, dnt='0'}={}) {
  const listeners = new Map();
  const scripts = [];
  const storage = new Map();
  let storageGets = 0;
  let storageSets = 0;
  if (consent !== null) storage.set('ta_analytics_consent', consent);

  function element(tag) {
    const handlers = {};
    return {
      tagName: tag.toUpperCase(),
      style: {},
      attrs: {},
      innerHTML: '',
      removed: false,
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
      if (sel === 'script[data-torgatlas-metrika]') {
        return scripts.find(s => s.attrs?.['data-torgatlas-metrika'] === '1') || null;
      }
      return null;
    },
    addEventListener(type, fn){ listeners.set('document:'+type, fn); }
  };
  const window = {
    doNotTrack: dnt,
    localStorage: {
      getItem(k){ storageGets++; return storage.has(k) ? storage.get(k) : null; },
      setItem(k,v){ storageSets++; storage.set(k,String(v)); }
    },
    addEventListener(type, fn){ listeners.set(type, fn); }
  };
  const navigator = { globalPrivacyControl:gpc, doNotTrack:dnt };
  const code = original.replace('var COUNTER_ID = 0;', 'var COUNTER_ID = '+String(counterId)+';');
  vm.runInNewContext(code, {window, document, navigator, Date, console, setTimeout, clearTimeout});

  return {window, document, navigator, listeners, scripts, storage, get storageGets(){return storageGets;}, get storageSets(){return storageSets;}};
}

test('disabled counter performs no analytics work', () => {
  const h=harness({counterId:0});
  assert.equal(h.scripts.length,0);
  assert.equal(h.listeners.size,0);
  assert.equal(h.storageGets,0);
  assert.equal(h.storageSets,0);
  assert.equal(h.window.ym,undefined);
});

test('GPC blocks provider even with prior consent', () => {
  const h=harness({counterId:123,consent:'accepted',gpc:true});
  assert.equal(h.scripts.length,0);
  assert.equal(h.window.ym,undefined);
});

test('accepted consent loads provider once with webvisor disabled', () => {
  const h=harness({counterId:123,consent:'accepted'});
  assert.equal(h.scripts.length,1);
  assert.equal(h.scripts[0].src,'https://mc.yandex.ru/metrika/tag.js');
  const calls=h.window.ym.a || [];
  const init=calls.find(args => args[1] === 'init');
  assert.ok(init);
  assert.equal(init[0],123);
  assert.equal(init[2].webvisor,false);
});

test('allowed goal sends only goal name and no arbitrary detail params', () => {
  const h=harness({counterId:123,consent:'accepted'});
  const before=(h.window.ym.a || []).length;
  h.listeners.get('auction:funnel')({detail:{event:'funnel_contact_open',channel:'email',contact:'secret@example.com',budget:'999999'}});
  const calls=h.window.ym.a || [];
  assert.equal(calls.length,before+1);
  const call=calls.at(-1);
  assert.deepEqual(Array.from(call),[123,'reachGoal','funnel_contact_open']);
});

test('unknown goal is ignored', () => {
  const h=harness({counterId:123,consent:'accepted'});
  const before=(h.window.ym.a || []).length;
  h.listeners.get('auction:funnel')({detail:{event:'free_text_event',contact:'secret@example.com'}});
  assert.equal((h.window.ym.a || []).length,before);
});

test('without consent provider is not loaded', () => {
  const h=harness({counterId:123,consent:null});
  assert.equal(h.scripts.length,0);
  assert.equal(h.window.ym,undefined);
});
