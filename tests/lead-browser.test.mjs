import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = fs.readFileSync(new URL('../assets/lead-submit.js', import.meta.url), 'utf8');

function sandbox(config, handlers, fetches, appended) {
  return {
    window: { addEventListener: (type, fn) => { handlers[type] = fn; } },
    document: { head: { appendChild: node => appended.push(node) }, getElementById: () => null, createElement: () => ({}) },
    fetch: async url => { fetches.push(url); return { ok: true, json: async () => config }; },
    JSON, Promise, Object, Error
  };
}

test('disabled direct-lead configuration never loads the widget or inserts a form', async () => {
  const handlers = Object.create(null), fetches = [], appended = [];
  vm.runInNewContext(file, sandbox({enabled:false}, handlers, fetches, appended));
  assert.equal(typeof handlers['lead:draft-ready'], 'function');
  handlers['lead:draft-ready']({detail:{kind:'lot'}});
  handlers['lead:draft-ready']({detail:{kind:'search'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetches, ['/api/lead-config']);
  assert.deepEqual(appended, []);
});

test('mismatched consent version keeps the form hidden', async () => {
  const handlers = Object.create(null), fetches = [], appended = [];
  vm.runInNewContext(file, sandbox({enabled:true, consentVersion:'2026-10-11', altcha:{challengeUrl:'/api/altcha-challenge'}}, handlers, fetches, appended));
  handlers['lead:draft-ready']({detail:{kind:'lot'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(appended, []);
});

test('local ALTCHA contract, UUID receipt check, manual fallback, no external CAPTCHA', () => {
  assert.match(file, /\/assets\/vendor\/altcha\/altcha\.js/);
  assert.match(file, /altcha-widget/);
  assert.match(file, /challengeurl/);
  assert.match(file, /statechange/);
  assert.match(file, /randomUUID/);
  assert.match(file, /id:requestId/);
  assert.match(file, /altcha:token/);
  assert.match(file, /response\.status === 200/);
  assert.match(file, /body\.accepted === true/);
  assert.match(file, /body\.id === requestId/);
  assert.match(file, /body\.receipt === requestId/);
  assert.match(file, /CAPTCHA_REPLAY/);
  assert.match(file, /lead_direct_unconfirmed/);
  assert.match(file, /e-mail, ТГ или телефон/);
  assert.doesNotMatch(file.toLowerCase(), /turnstile|cloudflare|smartcaptcha|yandex|captchatoken/);
  assert.doesNotMatch(file, /https?:\/\//);
});

test('vendored widget has no hard-coded third-party fetch endpoints and carries its MIT license', () => {
  const widget = fs.readFileSync(new URL('../assets/vendor/altcha/altcha.js', import.meta.url), 'utf8');
  const hosts = new Set((widget.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map(h => h.toLowerCase()));
  for (const h of hosts) assert.match(h, /w3\.org|altcha\.org|svelte\.dev|mozilla\.org/, h);
  assert.doesNotMatch(file, /sentinel|spamfilter|verifyurl|customfetch|obfuscated/i);  // optional widget features stay unconfigured
  assert.match(fs.readFileSync(new URL('../assets/vendor/altcha/LICENSE.txt', import.meta.url), 'utf8'), /MIT License/);
});

test('goal events: success only after the verified 200/ACCEPTED/receipt branch, once; form-start once per form', () => {
  const successCalls = file.match(/auctionCROTrack\('lead_direct_accepted'/g) || [];
  assert.equal(successCalls.length, 1);
  assert.equal((file.match(/showSuccess\(/g) || []).length, 2); // one call + one definition
  const verified = file.indexOf("response.status === 200 && body && body.ok === true && body.code === 'ACCEPTED'");
  const call = file.indexOf('showSuccess(body.receipt);');
  const definition = file.indexOf('function showSuccess');
  assert.ok(verified > 0 && call > verified && definition > call);
  assert.match(file.slice(call, call + 60), /showSuccess\(body\.receipt\);\s*return;/);
  assert.equal((file.match(/auctionCROTrack\('lead_direct_started'/g) || []).length, 1);
  assert.match(file, /startedTracking/);
});
